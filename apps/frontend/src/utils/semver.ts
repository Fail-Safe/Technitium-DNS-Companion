export const normalizeVersion = (value: string): string => {
  return value.trim().replace(/^v/i, "");
};

export const compareVersions = (first: string, second: string): number => {
  const a = normalizeVersion(first)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(second)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
};
