export interface TechnitiumVersion {
  major: number;
  minor: number;
}

export const FUTURE_MINIMUM_TECHNITIUM_VERSION = "15.3";

export function parseTechnitiumVersion(
  value: string | undefined,
): TechnitiumVersion | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?/i.exec(value?.trim() ?? "");
  if (!match) {
    return undefined;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
  };
}

export function isDeprecatedTechnitiumVersion(
  value: string | undefined,
): boolean {
  const version = parseTechnitiumVersion(value);
  return version !== undefined && version.major < 15;
}
