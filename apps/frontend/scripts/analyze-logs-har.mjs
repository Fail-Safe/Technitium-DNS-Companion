#!/usr/bin/env node

import { readFileSync } from "node:fs";

const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
};
const rounded = (value) => (value === null ? null : Math.round(value));
const timingSummary = (values) => ({
  samples: values.length,
  minimumMs: rounded(values.length ? Math.min(...values) : null),
  medianMs: rounded(percentile(values, 0.5)),
  p90Ms: rounded(percentile(values, 0.9)),
  maximumMs: rounded(values.length ? Math.max(...values) : null),
});
const roundedOneDecimal = (value) => Math.round(value * 10) / 10;
const percentageChange = (before, after) =>
  before === 0 ? null : roundedOneDecimal((after / before - 1) * 100);

const analyzeHar = (harPath) => {
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries.filter((entry) => {
    const url = new URL(entry.request.url);
    return url.pathname === "/api/nodes/logs/combined/stored";
  });

  const isWorkboxFetch = (entry) =>
    JSON.stringify(entry._initiator ?? {}).includes("/workbox-");
  const workboxFetches = entries.filter(isWorkboxFetch);
  const browserFetches = entries.filter((entry) => !isWorkboxFetch(entry));
  const completedNetworkFetches =
    workboxFetches.length > 0 ? workboxFetches : browserFetches;
  const completedTimings = completedNetworkFetches
    .filter((entry) => entry.response.status > 0)
    .map((entry) => entry.time);

  const started = entries
    .map((entry) => Date.parse(entry.startedDateTime))
    .filter(Number.isFinite);
  const routing =
    workboxFetches.length === 0
      ? "direct"
      : browserFetches.length === workboxFetches.length
        ? "service-worker"
        : "mixed";
  return {
    completedNetworkFetches,
    result: {
      source: {
        captureStartedAt:
          started.length > 0
            ? new Date(Math.min(...started)).toISOString()
            : null,
        observationSeconds:
          started.length > 1
            ? Math.round((Math.max(...started) - Math.min(...started)) / 1000)
            : 0,
      },
      storedLogs: {
        routing,
        harEntries: entries.length,
        browserFetches: browserFetches.length,
        workboxNetworkFetches: workboxFetches.length,
        browserCancelled: browserFetches.filter(
          (entry) => entry.response.status === 0,
        ).length,
        completedNetworkFetches: completedNetworkFetches.filter(
          (entry) => entry.response.status > 0,
        ).length,
        httpErrors: completedNetworkFetches.filter(
          (entry) => entry.response.status >= 400,
        ).length,
        cancelledButWorkboxContinued: browserFetches.filter(
          (entry) =>
            entry.response.status === 0 &&
            workboxFetches.some(
              (candidate) =>
                candidate.request.method === entry.request.method &&
                candidate.request.url === entry.request.url &&
                Math.abs(
                  Date.parse(candidate.startedDateTime) -
                    Date.parse(entry.startedDateTime),
                ) <= 20,
            ),
        ).length,
        timing: timingSummary(completedTimings),
        fastUnder100Ms: completedTimings.filter((value) => value < 100).length,
        slowAtLeast100Ms: completedTimings.filter((value) => value >= 100)
          .length,
      },
    },
  };
};

const groupTimingsByUrl = (entries) => {
  const grouped = new Map();
  for (const entry of entries) {
    const current = grouped.get(entry.request.url) ?? [];
    current.push(entry.time);
    grouped.set(entry.request.url, current);
  }
  return grouped;
};

const compareHarAnalyses = (before, after) => {
  const beforeResult = before.result.storedLogs;
  const afterResult = after.result.storedLogs;
  const beforeSeconds = before.result.source.observationSeconds;
  const afterSeconds = after.result.source.observationSeconds;
  const perMinute = (count, seconds) =>
    seconds > 0 ? (count / seconds) * 60 : null;

  const beforeGrouped = groupTimingsByUrl(before.completedNetworkFetches);
  const afterGrouped = groupTimingsByUrl(after.completedNetworkFetches);
  const matchedUrls = [...beforeGrouped.keys()].filter((url) =>
    afterGrouped.has(url),
  );
  const representativeBefore = matchedUrls.map((url) =>
    percentile(beforeGrouped.get(url), 0.5),
  );
  const representativeAfter = matchedUrls.map((url) =>
    percentile(afterGrouped.get(url), 0.5),
  );
  const beforeMatched = timingSummary(representativeBefore);
  const afterMatched = timingSummary(representativeAfter);
  const beforeBrowserRateRaw = perMinute(
    beforeResult.browserFetches,
    beforeSeconds,
  );
  const afterBrowserRateRaw = perMinute(
    afterResult.browserFetches,
    afterSeconds,
  );
  const beforeNetworkRateRaw = perMinute(
    beforeResult.completedNetworkFetches,
    beforeSeconds,
  );
  const afterNetworkRateRaw = perMinute(
    afterResult.completedNetworkFetches,
    afterSeconds,
  );

  return {
    requestRatesPerMinute: {
      browserFetches: {
        before: roundedOneDecimal(beforeBrowserRateRaw),
        after: roundedOneDecimal(afterBrowserRateRaw),
        changePercent: percentageChange(
          beforeBrowserRateRaw,
          afterBrowserRateRaw,
        ),
      },
      completedNetworkFetches: {
        before: roundedOneDecimal(beforeNetworkRateRaw),
        after: roundedOneDecimal(afterNetworkRateRaw),
        changePercent: percentageChange(
          beforeNetworkRateRaw,
          afterNetworkRateRaw,
        ),
      },
    },
    allCompletedLatency: {
      before: beforeResult.timing,
      after: afterResult.timing,
      changePercent: {
        median: percentageChange(
          beforeResult.timing.medianMs,
          afterResult.timing.medianMs,
        ),
        p90: percentageChange(
          beforeResult.timing.p90Ms,
          afterResult.timing.p90Ms,
        ),
        maximum: percentageChange(
          beforeResult.timing.maximumMs,
          afterResult.timing.maximumMs,
        ),
      },
    },
    matchedExactQueryLatency: {
      queries: matchedUrls.length,
      before: beforeMatched,
      after: afterMatched,
      changePercent: {
        median: percentageChange(beforeMatched.medianMs, afterMatched.medianMs),
        p90: percentageChange(beforeMatched.p90Ms, afterMatched.p90Ms),
        maximum: percentageChange(
          beforeMatched.maximumMs,
          afterMatched.maximumMs,
        ),
      },
    },
  };
};

const beforePath = process.argv[2];
const afterPath = process.argv[3];
if (!beforePath) {
  console.error(
    "Usage: node scripts/analyze-logs-har.mjs /path/to/before.har [/path/to/after.har]",
  );
  process.exitCode = 1;
} else {
  const before = analyzeHar(beforePath);
  if (!afterPath) {
    console.log(JSON.stringify(before.result, null, 2));
  } else {
    const after = analyzeHar(afterPath);

    console.log(
      JSON.stringify(
        {
          before: before.result,
          after: after.result,
          comparison: compareHarAnalyses(before, after),
        },
        null,
        2,
      ),
    );
  }
}
