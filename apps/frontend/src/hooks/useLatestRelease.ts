import { useCallback, useEffect, useMemo, useState } from "react";
import { compareVersions, normalizeVersion } from "../utils/semver";

const CACHE_KEY = "technitium.latestRelease";
const RELEASES_API_URL =
  "https://api.github.com/repos/Fail-Safe/Technitium-DNS-Companion/releases/latest";
const RELEASES_PAGE_URL =
  "https://github.com/Fail-Safe/Technitium-DNS-Companion/releases/latest";
const TWELVE_HOURS_MS = 1000 * 60 * 60 * 12;

type ReleaseSnapshot = {
  version: string;
  url: string;
  publishedAt?: string | null;
  fetchedAt: number;
};

type LatestReleaseState = {
  latestVersion: string | null;
  latestReleaseUrl: string | null;
  publishedAt: string | null;
  isChecking: boolean;
  error: string | null;
  isUpdateAvailable: boolean;
};

const staleSnapshot = (snapshot: ReleaseSnapshot, ttlMs: number) => {
  return Date.now() - snapshot.fetchedAt > ttlMs;
};

const readSnapshot = (): ReleaseSnapshot | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(CACHE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as ReleaseSnapshot;
    if (!parsed.version || !parsed.url || !parsed.fetchedAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const persistSnapshot = (snapshot: ReleaseSnapshot) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
};

export const useLatestRelease = (
  currentVersion: string,
  cacheTtlMs = TWELVE_HOURS_MS,
) => {
  const normalizedCurrent = useMemo(
    () => normalizeVersion(currentVersion),
    [currentVersion],
  );

  const [state, setState] = useState<LatestReleaseState>({
    latestVersion: null,
    latestReleaseUrl: null,
    publishedAt: null,
    isChecking: true,
    error: null,
    isUpdateAvailable: false,
  });

  const emitSnapshot = useCallback(
    (snapshot: ReleaseSnapshot, forceChecking: boolean) => {
      const isUpdateAvailable =
        compareVersions(snapshot.version, normalizedCurrent) > 0;

      setState({
        latestVersion: snapshot.version,
        latestReleaseUrl: snapshot.url,
        publishedAt: snapshot.publishedAt ?? null,
        isChecking: forceChecking,
        error: null,
        isUpdateAvailable,
      });
    },
    [normalizedCurrent],
  );

  const fetchLatest = useCallback(async () => {
    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });

      if (!response.ok) {
        throw new Error(`GitHub responded with ${response.status}`);
      }

      const payload = await response.json();
      const version = normalizeVersion(payload.tag_name || payload.name || "");

      if (!version) {
        throw new Error("Latest release tag is unavailable");
      }

      const snapshot: ReleaseSnapshot = {
        version,
        url: payload.html_url || RELEASES_PAGE_URL,
        publishedAt: payload.published_at || null,
        fetchedAt: Date.now(),
      };

      persistSnapshot(snapshot);
      emitSnapshot(snapshot, false);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error:
          error instanceof Error ?
            error.message
          : "Failed to check for updates",
      }));
    }
  }, [emitSnapshot]);

  useEffect(() => {
    const cachedSnapshot = readSnapshot();

    if (cachedSnapshot) {
      const expired = staleSnapshot(cachedSnapshot, cacheTtlMs);
      emitSnapshot(cachedSnapshot, expired);
      if (!expired) {
        return;
      }
    } else {
      setState((prev) => ({ ...prev, isChecking: true }));
    }

    fetchLatest();
  }, [cacheTtlMs, emitSnapshot, fetchLatest]);

  return { ...state, refresh: fetchLatest };
};
