const ABORTABLE_API_PATHS = [
  /^\/api\/domain-lists\/[^/]+\/(?:all-domains|check)$/i,
  /^\/api\/nodes\/(?:logs\/combined(?:\/stored)?|[^/]+\/logs(?:\/stored)?)$/i,
];

export function shouldBypassApiRuntimeCache(pathname: string): boolean {
  return ABORTABLE_API_PATHS.some((pattern) => pattern.test(pathname));
}
