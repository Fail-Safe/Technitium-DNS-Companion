import { AuthRequestContext } from "../auth/auth-request-context";
import type { SnapshotAttribution } from "./technitium.types";

export function getSnapshotAttribution(): SnapshotAttribution {
  const username = AuthRequestContext.getSession()?.user.trim();

  if (username) {
    return { createdBy: username, createdByType: "user" };
  }

  return { createdByType: "system" };
}
