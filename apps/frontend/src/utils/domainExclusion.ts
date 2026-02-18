export interface DomainExclusionMatcher {
  pattern: string;
  regex: RegExp;
}

const normalizeDomain = (value: string): string => {
  return value.trim().toLowerCase().replace(/\.+$/, "");
};

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const buildRegexForPattern = (pattern: string): RegExp => {
  const escaped = escapeRegex(pattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
};

export const parseDomainExclusionPatterns = (rawValue: string): string[] => {
  const unique = new Set<string>();
  rawValue
    .split(/[\n,]/)
    .map((value) => normalizeDomain(value))
    .filter((value) => value.length > 0)
    .forEach((value) => unique.add(value));

  return Array.from(unique);
};

export const buildDomainExclusionMatchers = (
  rawValue: string,
): DomainExclusionMatcher[] => {
  return parseDomainExclusionPatterns(rawValue).map((pattern) => ({
    pattern,
    regex: buildRegexForPattern(pattern),
  }));
};

export const isDomainExcluded = (
  domain: string | undefined,
  matchers: DomainExclusionMatcher[],
): boolean => {
  if (!domain || matchers.length === 0) {
    return false;
  }

  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain.length === 0) {
    return false;
  }

  return matchers.some((matcher) => matcher.regex.test(normalizedDomain));
};
