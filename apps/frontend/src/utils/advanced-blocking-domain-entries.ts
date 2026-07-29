import type { AdvancedBlockingConfig } from "../types/advancedBlocking";

export type AdvancedBlockingDomainType =
  | "blocked"
  | "allowed"
  | "blockedRegex"
  | "allowedRegex";

export function isRegexDomainType(
  domainType: AdvancedBlockingDomainType,
): domainType is "blockedRegex" | "allowedRegex" {
  return domainType === "blockedRegex" || domainType === "allowedRegex";
}

export function getNewRegexEntryCandidate(
  input: string,
  domainType: "blockedRegex" | "allowedRegex",
  config: AdvancedBlockingConfig | null | undefined,
): string | null {
  const candidate = input.trim();
  if (!candidate) return null;

  const exists = config?.groups.some((group) =>
    (group[domainType] ?? []).includes(candidate),
  );

  return exists ? null : candidate;
}
