export type BuildChannelKind =
  | "stable"
  | "beta"
  | "preview"
  | "development";

export interface BuildChannelDetails {
  kind: BuildChannelKind;
  badge: string | null;
  statusLabel: string | null;
}

export const describeBuildChannel = (
  rawChannel: string,
): BuildChannelDetails => {
  const channel = rawChannel.trim().toLowerCase();

  switch (channel) {
    case "stable":
      return { kind: "stable", badge: null, statusLabel: null };
    case "beta":
      return {
        kind: "beta",
        badge: "BETA",
        statusLabel: "Running beta preview",
      };
    case "development":
      return {
        kind: "development",
        badge: "DEV",
        statusLabel: "Development build",
      };
    default:
      return {
        kind: "preview",
        badge: "PREVIEW",
        statusLabel: "Running preview build",
      };
  }
};

export const formatBuildChannelStatus = (
  details: BuildChannelDetails,
  latestStableVersion: string | null,
  stableCheckUnavailable: boolean,
): string | null => {
  if (!details.statusLabel) {
    return null;
  }

  if (latestStableVersion) {
    return `${details.statusLabel} · Latest stable: v${latestStableVersion}`;
  }

  if (stableCheckUnavailable) {
    return `${details.statusLabel} · Stable release check unavailable`;
  }

  return details.statusLabel;
};
