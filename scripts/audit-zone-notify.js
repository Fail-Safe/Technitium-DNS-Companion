#!/usr/bin/env node

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function usage() {
  console.log(`Usage:
  node scripts/audit-zone-notify.js --primary <node> --secondary <node> [options]

Options:
  --primary <node>                 Expected primary node id or display name
  --secondary <node>               Expected secondary node id or display name
  --primary-address <address>      Address the secondary should use as its master (repeatable)
  --secondary-address <address>    Address the primary should notify/transfer to (repeatable)
  --zones-from-log <path>          Audit only zones found in "for zone: ..." log lines
  --zone <name>                    Audit one zone (repeatable)
  --zone-regex <regex>             Audit zones matching a JavaScript regex
  --include-ok                     Include zones with no detected issues
  --json                           Output JSON instead of text

Auth:
  Uses TECHNITIUM_<NODE>_AUDIT_TOKEN first, then TECHNITIUM_AUDIT_TOKEN,
  then TECHNITIUM_<NODE>_TOKEN, then TECHNITIUM_BACKGROUND_TOKEN.
  Token values are never printed.
`);
}

function parseArgs(argv) {
  const args = {
    primaryAddresses: [],
    secondaryAddresses: [],
    zones: [],
    includeOk: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[index];
    };

    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--primary":
        args.primary = next();
        break;
      case "--secondary":
        args.secondary = next();
        break;
      case "--primary-address":
        args.primaryAddresses.push(next());
        break;
      case "--secondary-address":
        args.secondaryAddresses.push(next());
        break;
      case "--zones-from-log":
        args.zonesFromLog = next();
        break;
      case "--zone":
        args.zones.push(next());
        break;
      case "--zone-regex":
        args.zoneRegex = next();
        break;
      case "--include-ok":
        args.includeOk = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function envOrFile(name) {
  const fileName = process.env[`${name}_FILE`];
  if (fileName) {
    return fs.readFileSync(fileName, "utf8").trim();
  }
  return process.env[name];
}

function envKeyForNode(nodeId) {
  return nodeId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function loadNodes() {
  const rawNodes = process.env.TECHNITIUM_NODES;
  if (!rawNodes) {
    throw new Error("TECHNITIUM_NODES is not set.");
  }

  return rawNodes
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((id) => {
      const key = envKeyForNode(id);
      const baseUrl = process.env[`TECHNITIUM_${key}_BASE_URL`];
      const name = process.env[`TECHNITIUM_${key}_NAME`] || id;
      const nodeAuditToken = envOrFile(`TECHNITIUM_${key}_AUDIT_TOKEN`);
      const sharedAuditToken = envOrFile("TECHNITIUM_AUDIT_TOKEN");
      const nodeToken = envOrFile(`TECHNITIUM_${key}_TOKEN`);
      const backgroundToken = envOrFile("TECHNITIUM_BACKGROUND_TOKEN");
      const token =
        nodeAuditToken ||
        sharedAuditToken ||
        nodeToken ||
        backgroundToken ||
        "";
      let tokenSource = "none";
      if (nodeAuditToken) {
        tokenSource = `TECHNITIUM_${key}_AUDIT_TOKEN`;
      } else if (sharedAuditToken) {
        tokenSource = "TECHNITIUM_AUDIT_TOKEN";
      } else if (nodeToken) {
        tokenSource = `TECHNITIUM_${key}_TOKEN`;
      } else if (backgroundToken) {
        tokenSource = "TECHNITIUM_BACKGROUND_TOKEN";
      }

      if (!baseUrl) {
        throw new Error(`TECHNITIUM_${key}_BASE_URL is not set.`);
      }

      return {
        id,
        key,
        name,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        token,
        tokenSource,
      };
    });
}

function findNode(nodes, selector) {
  const wanted = selector.toLowerCase();
  const node = nodes.find(
    (candidate) =>
      candidate.id.toLowerCase() === wanted ||
      candidate.name.toLowerCase() === wanted ||
      candidate.key.toLowerCase() === wanted,
  );

  if (!node) {
    const available = nodes
      .map((candidate) => `${candidate.id} (${candidate.name})`)
      .join(", ");
    throw new Error(`Node "${selector}" not found. Available: ${available}`);
  }

  if (!node.token) {
    throw new Error(
      `No token available for node "${node.id}". Set TECHNITIUM_${node.key}_AUDIT_TOKEN, TECHNITIUM_AUDIT_TOKEN, TECHNITIUM_${node.key}_TOKEN, or TECHNITIUM_BACKGROUND_TOKEN.`,
    );
  }

  return node;
}

function redact(message) {
  return String(message)
    .replace(/([?&]token=)[^&\s]+/gi, "$1<redacted>")
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1<redacted>");
}

async function request(node, url, params = {}) {
  try {
    const response = await axios.request({
      baseURL: node.baseUrl,
      url,
      method: "GET",
      timeout: 30000,
      httpsAgent,
      params: { ...params, token: node.token },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const envelope = response.data;
    if (!envelope || typeof envelope !== "object") {
      throw new Error("unexpected non-object response");
    }
    if (envelope.status === "invalid-token") {
      throw new Error("invalid token");
    }
    if (envelope.status && envelope.status !== "ok") {
      throw new Error(
        envelope.errorMessage
          ? `${envelope.status}: ${envelope.errorMessage}`
          : envelope.status,
      );
    }

    return envelope.response ?? envelope;
  } catch (error) {
    throw new Error(`${node.id} ${url}: ${redact(error.message)}`);
  }
}

async function listZones(node) {
  const first = await request(node, "/api/zones/list");
  const zones = Array.isArray(first.zones) ? [...first.zones] : [];
  const totalPages =
    typeof first.totalPages === "number" && first.totalPages > 1
      ? first.totalPages
      : 1;

  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    const page = await request(node, "/api/zones/list", { pageNumber });
    if (Array.isArray(page.zones)) {
      zones.push(...page.zones);
    }
  }

  const byName = new Map();
  for (const zone of zones) {
    if (zone && typeof zone.name === "string") {
      byName.set(zone.name, zone);
    }
  }
  return byName;
}

async function getZoneOptions(node, zoneName) {
  return request(node, "/api/zones/options/get", { zone: zoneName });
}

function zonesFromLog(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return [...text.matchAll(/for zone:\s*([^\r\n]+)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function includesAny(values, expected) {
  if (expected.length === 0) return undefined;
  const lowerValues = values.map((value) => value.toLowerCase());
  return expected.some((value) => {
    const expectedLower = value.toLowerCase();
    return lowerValues.some(
      (candidate) =>
        candidate === expectedLower || candidate.includes(expectedLower),
    );
  });
}

function classifyZonePair(primarySummary, secondarySummary) {
  const primaryType = primarySummary?.type;
  const secondaryType = secondarySummary?.type;

  if (primarySummary?.internal || secondarySummary?.internal) {
    return "internal";
  }
  if (primaryType === "fetch-error" || secondaryType === "fetch-error") {
    return "unreadable";
  }
  if (!primarySummary || !secondarySummary) {
    return "missing";
  }
  if (primaryType === "Primary" && secondaryType === "Secondary") {
    return "primary-secondary";
  }
  if (primaryType === "Primary" && secondaryType === "Primary") {
    return "dual-primary";
  }
  if (primaryType === "Catalog" && secondaryType === "SecondaryCatalog") {
    return "catalog-secondary";
  }
  if (primaryType === "Forwarder" && secondaryType === "Forwarder") {
    return "dual-forwarder";
  }
  if (
    primaryType === "Forwarder" &&
    ["SecondaryForwarder", "Secondary Conditional Forwarder"].includes(
      secondaryType ?? "",
    )
  ) {
    return "forwarder-secondary";
  }
  return "other";
}

function summarizeZone(zone) {
  if (!zone) return null;
  return {
    type: zone.type || "",
    internal: Boolean(zone.internal),
    skippedInternal: Boolean(zone.__skippedInternal),
    notify: zone.notify || "",
    notifyNameServers: normalizeArray(zone.notifyNameServers),
    notifyFailed: Boolean(zone.notifyFailed),
    notifyFailedFor: normalizeArray(zone.notifyFailedFor),
    zoneTransfer: zone.zoneTransfer || "",
    zoneTransferNetworkACL: normalizeArray(zone.zoneTransferNetworkACL),
    primaryNameServerAddresses: normalizeArray(zone.primaryNameServerAddresses),
    syncFailed: Boolean(zone.syncFailed),
    soaSerial: typeof zone.soaSerial === "number" ? zone.soaSerial : null,
  };
}

function isActionableIssue(issue) {
  return issue.severity === "error" || issue.severity === "warn";
}

function isInternalZoneAccessError(message) {
  return String(message).includes(
    "Access was denied to manage internal DNS Server zone",
  );
}

function isKnownProtectedInternalZoneName(zoneName) {
  return [
    "0.in-addr.arpa",
    "127.in-addr.arpa",
    "255.in-addr.arpa",
    "localhost",
    "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa",
  ].includes(zoneName);
}

function shouldSkipZoneOptions(zoneName, ...zoneSummaries) {
  return (
    isKnownProtectedInternalZoneName(zoneName) ||
    zoneSummaries.some((zone) => zone?.internal === true)
  );
}

function analyzeZone({
  zoneName,
  primary,
  secondary,
  primarySummary,
  secondarySummary,
  primaryAddresses,
  secondaryAddresses,
}) {
  const issues = [];
  const pairClass = classifyZonePair(primarySummary, secondarySummary);

  if (pairClass === "internal") {
    issues.push({
      severity: "info",
      message:
        "Skipped protected internal DNS Server zone options to avoid Technitium API access-denied log entries.",
    });
  }

  if (!primarySummary) {
    issues.push({
      severity: "error",
      message: `Missing on expected primary ${primary.id}.`,
    });
  }

  if (!secondarySummary) {
    issues.push({
      severity: "warn",
      message: `Missing on expected secondary ${secondary.id}. If this zone should not replicate, remove ${secondary.id} from ${primary.id}'s notify path.`,
    });
  }

  if (pairClass === "dual-primary") {
    issues.push({
      severity: "error",
      message: `Both nodes are Primary for this zone. If ${secondary.id} should replicate from ${primary.id}, convert/recreate the ${secondary.id} zone as Secondary.`,
    });
  }

  if (
    pairClass === "other" &&
    primarySummary?.type !== "Forwarder" &&
    secondarySummary?.type !== "Forwarder"
  ) {
    issues.push({
      severity: "error",
      message: `Unexpected zone type pair: ${primary.id}=${primarySummary?.type || "unknown"}, ${secondary.id}=${secondarySummary?.type || "unknown"}.`,
    });
  }

  if (primarySummary?.notifyFailed) {
    const targets = primarySummary.notifyFailedFor.length
      ? ` (${primarySummary.notifyFailedFor.join(", ")})`
      : "";
    issues.push({
      severity: "warn",
      message: `Primary reports notifyFailed${targets}.`,
    });
  }

  if (
    primarySummary &&
    secondaryAddresses.length > 0 &&
    !["dual-forwarder", "forwarder-secondary"].includes(pairClass)
  ) {
    const notifyTargets = primarySummary.notifyNameServers;
    const transferAcl = primarySummary.zoneTransferNetworkACL;
    const failedTargets = primarySummary.notifyFailedFor;

    const failedForSecondary = includesAny(failedTargets, secondaryAddresses);
    if (failedForSecondary) {
      issues.push({
        severity: "error",
        message: `Primary notify failures include expected secondary address ${secondaryAddresses.join(" or ")}.`,
      });
    }

    if (
      primarySummary.notify === "SpecifiedNameServers" &&
      !includesAny(notifyTargets, secondaryAddresses)
    ) {
      issues.push({
        severity: "error",
        message: `Primary uses SpecifiedNameServers but notifyNameServers does not include ${secondaryAddresses.join(" or ")}.`,
      });
    }

    if (
      primarySummary.zoneTransfer &&
      ![
        "Allow",
        "AllowOnlyZoneNameServers",
        "AllowOnlySpecifiedNameServers",
        "UseSpecifiedNetworkACL",
      ].includes(primarySummary.zoneTransfer)
    ) {
      issues.push({
        severity: "warn",
        message: `Primary zoneTransfer is "${primarySummary.zoneTransfer}", which may not allow secondary transfers.`,
      });
    }

    if (
      ["AllowOnlySpecifiedNameServers", "UseSpecifiedNetworkACL"].includes(
        primarySummary.zoneTransfer,
      ) &&
      !includesAny(transferAcl, secondaryAddresses)
    ) {
      issues.push({
        severity: "error",
        message: `Primary zoneTransferNetworkACL does not include expected secondary address ${secondaryAddresses.join(" or ")}.`,
      });
    }
  }

  if (
    secondarySummary &&
    primaryAddresses.length > 0 &&
    ["primary-secondary", "catalog-secondary"].includes(pairClass)
  ) {
    const primaryMasters = secondarySummary.primaryNameServerAddresses;
    if (primaryMasters.length === 0 && pairClass === "primary-secondary") {
      issues.push({
        severity: secondarySummary.syncFailed ? "warn" : "info",
        message: secondarySummary.syncFailed
          ? `Secondary did not report primaryNameServerAddresses and syncFailed=true; verify ${secondary.id}'s master server manually.`
          : `Secondary did not report primaryNameServerAddresses, but syncFailed=false. This is common for catalog-managed secondary member zones.`,
      });
    } else if (!includesAny(primaryMasters, primaryAddresses)) {
      issues.push({
        severity: "error",
        message: `Secondary primaryNameServerAddresses does not include expected primary address ${primaryAddresses.join(" or ")}.`,
      });
    }
  }

  if (
    primarySummary &&
    secondarySummary &&
    primarySummary.soaSerial !== null &&
    secondarySummary.soaSerial !== null &&
    primarySummary.soaSerial !== secondarySummary.soaSerial
  ) {
    issues.push({
      severity: "warn",
      message: `SOA serial differs: ${primary.id}=${primarySummary.soaSerial}, ${secondary.id}=${secondarySummary.soaSerial}.`,
    });
  }

  return {
    zone: zoneName,
    pairClass,
    status: issues.some(isActionableIssue) ? "issue" : "ok",
    issues,
    primary: primarySummary,
    secondary: secondarySummary,
  };
}

function printText(report) {
  console.log(
    `Audited ${report.totalZones} zone(s): ${report.issueZones} with actionable issues, ${report.warningZones} warnings, ${report.infoZones} informational, ${report.okZones} ok.`,
  );
  console.log(
    `Primary: ${report.primary.id} (${report.primary.name}); Secondary: ${report.secondary.id} (${report.secondary.name})`,
  );
  if (report.primaryAddresses.length > 0) {
    console.log(
      `Expected primary address(es): ${report.primaryAddresses.join(", ")}`,
    );
  }
  if (report.secondaryAddresses.length > 0) {
    console.log(
      `Expected secondary address(es): ${report.secondaryAddresses.join(", ")}`,
    );
  }
  if (report.totalZones === 0) {
    console.log("");
    console.log(
      "No zones were returned. The token probably lacks Zones:View permission, or these node URLs are not the expected Technitium servers.",
    );
    console.log(
      "Use TECHNITIUM_AUDIT_TOKEN_FILE or TECHNITIUM_<NODE>_AUDIT_TOKEN_FILE with a temporary read-only token that can view zones.",
    );
  }
  console.log("");

  for (const result of report.results) {
    const hasActionableIssues = result.issues.some(isActionableIssue);
    const hasInfo = result.issues.some((issue) => issue.severity === "info");
    if (!hasActionableIssues && !report.includeOk) continue;

    const primaryType = result.primary?.type || "missing";
    const secondaryType = result.secondary?.type || "missing";
    console.log(
      `${hasActionableIssues ? "ISSUE" : hasInfo ? "INFO" : "OK"} ${result.zone}`,
    );
    console.log(`  class: ${result.pairClass}`);
    console.log(`  types: primary=${primaryType}, secondary=${secondaryType}`);

    if (result.primary) {
      console.log(
        `  primary notify=${result.primary.notify || "unset"}, failedFor=${result.primary.notifyFailedFor.join(", ") || "none"}, transfer=${result.primary.zoneTransfer || "unset"}`,
      );
    }
    if (result.secondary) {
      console.log(
        `  secondary masters=${result.secondary.primaryNameServerAddresses.join(", ") || "none"}, syncFailed=${result.secondary.syncFailed}`,
      );
    }

    for (const issue of result.issues) {
      console.log(`  - ${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    console.log("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!args.primary || !args.secondary) {
    usage();
    process.exitCode = 2;
    return;
  }

  const nodes = loadNodes();
  const primary = findNode(nodes, args.primary);
  const secondary = findNode(nodes, args.secondary);

  const [primaryZones, secondaryZones] = await Promise.all([
    listZones(primary),
    listZones(secondary),
  ]);

  let zoneNames = [];
  if (args.zonesFromLog) {
    zoneNames.push(...zonesFromLog(args.zonesFromLog));
  }
  zoneNames.push(...args.zones);

  if (zoneNames.length === 0) {
    zoneNames.push(...primaryZones.keys(), ...secondaryZones.keys());
  }

  zoneNames = uniqueSorted(zoneNames);

  if (args.zoneRegex) {
    const regex = new RegExp(args.zoneRegex);
    zoneNames = zoneNames.filter((zoneName) => regex.test(zoneName));
  }

  const results = [];
  for (const zoneName of zoneNames) {
    const primaryListSummary = primaryZones.get(zoneName);
    const secondaryListSummary = secondaryZones.get(zoneName);
    const skipOptions = shouldSkipZoneOptions(
      zoneName,
      primaryListSummary,
      secondaryListSummary,
    );
    const [primaryOptions, secondaryOptions] = await Promise.all([
      primaryListSummary
        ? skipOptions
          ? Promise.resolve({
              ...primaryListSummary,
              internal: true,
              __skippedInternal: true,
            })
          : getZoneOptions(primary, zoneName).catch((error) => ({
              __error: error.message,
            }))
        : Promise.resolve(null),
      secondaryListSummary
        ? skipOptions
          ? Promise.resolve({
              ...secondaryListSummary,
              internal: true,
              __skippedInternal: true,
            })
          : getZoneOptions(secondary, zoneName).catch((error) => ({
              __error: error.message,
            }))
        : Promise.resolve(null),
    ]);

    const primarySummary =
      primaryOptions && !primaryOptions.__error
        ? summarizeZone(primaryOptions)
        : primaryOptions?.__error
          ? {
              type: "fetch-error",
              notifyFailedFor: [],
              __error: primaryOptions.__error,
            }
          : null;
    const secondarySummary =
      secondaryOptions && !secondaryOptions.__error
        ? summarizeZone(secondaryOptions)
        : secondaryOptions?.__error
          ? {
              type: "fetch-error",
              primaryNameServerAddresses: [],
              __error: secondaryOptions.__error,
            }
          : null;

    const result = analyzeZone({
      zoneName,
      primary,
      secondary,
      primarySummary,
      secondarySummary,
      primaryAddresses: args.primaryAddresses,
      secondaryAddresses: args.secondaryAddresses,
    });

    if (primarySummary?.__error) {
      result.issues.push({
        severity: isInternalZoneAccessError(primarySummary.__error)
          ? "info"
          : "error",
        message: `Could not fetch primary zone options: ${primarySummary.__error}`,
      });
    }
    if (secondarySummary?.__error) {
      result.issues.push({
        severity: isInternalZoneAccessError(secondarySummary.__error)
          ? "info"
          : "error",
        message: `Could not fetch secondary zone options: ${secondarySummary.__error}`,
      });
    }

    result.status = result.issues.some(isActionableIssue) ? "issue" : "ok";
    results.push(result);
  }

  const filteredResults = args.includeOk
    ? results
    : results.filter((result) => result.issues.some(isActionableIssue));
  const issueZones = results.filter((result) =>
    result.issues.some((issue) => issue.severity === "error"),
  ).length;
  const warningZones = results.filter(
    (result) =>
      !result.issues.some((issue) => issue.severity === "error") &&
      result.issues.some((issue) => issue.severity === "warn"),
  ).length;
  const infoZones = results.filter(
    (result) =>
      !result.issues.some(isActionableIssue) &&
      result.issues.some((issue) => issue.severity === "info"),
  ).length;
  const okZones = results.filter((result) => result.issues.length === 0).length;
  const report = {
    primary: {
      id: primary.id,
      name: primary.name,
      baseUrl: primary.baseUrl,
      tokenSource: primary.tokenSource,
    },
    secondary: {
      id: secondary.id,
      name: secondary.name,
      baseUrl: secondary.baseUrl,
      tokenSource: secondary.tokenSource,
    },
    primaryAddresses: args.primaryAddresses,
    secondaryAddresses: args.secondaryAddresses,
    includeOk: args.includeOk,
    totalZones: results.length,
    issueZones,
    warningZones,
    infoZones,
    okZones,
    results: filteredResults,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }

  if (report.issueZones > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(redact(error.message));
  process.exitCode = 1;
});
