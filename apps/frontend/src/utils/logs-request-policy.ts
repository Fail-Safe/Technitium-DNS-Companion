export type LogsLoadingState = "idle" | "loading" | "refreshing" | "error";

export function isLogsRequestBusy(state: LogsLoadingState): boolean {
  return state === "loading" || state === "refreshing";
}

export function refreshSecondsForDisplayMode(
  displayMode: "paginated" | "tail",
  currentRefreshSeconds: number,
  tailDefaultRefreshSeconds: number,
): number {
  if (displayMode === "paginated") {
    return 0;
  }

  return currentRefreshSeconds > 0
    ? currentRefreshSeconds
    : tailDefaultRefreshSeconds;
}
