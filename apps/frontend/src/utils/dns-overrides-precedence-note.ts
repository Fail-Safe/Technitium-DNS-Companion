const PRECEDENCE_NOTE_DISMISSED_KEY =
  "dnsOverridesPrecedenceNoteDismissed";

export function isDnsOverridesPrecedenceNoteDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(PRECEDENCE_NOTE_DISMISSED_KEY) === "true";
  } catch (error) {
    console.warn("Failed to load precedence note dismissed state", error);
    return false;
  }
}

export function rememberDnsOverridesPrecedenceNoteDismissed(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PRECEDENCE_NOTE_DISMISSED_KEY, "true");
  } catch (error) {
    console.warn("Failed to save precedence note dismissed state", error);
  }
}
