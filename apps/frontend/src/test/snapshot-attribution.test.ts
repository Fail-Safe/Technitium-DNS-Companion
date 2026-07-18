import { describe, expect, it } from "vitest";
import { formatSnapshotCreator } from "../components/common/snapshotDrawerShared";

describe("snapshot attribution", () => {
  it("shows the Technitium username for an attributed snapshot", () => {
    expect(
      formatSnapshotCreator({ createdBy: "alice", createdByType: "user" }),
    ).toBe("alice");
  });

  it("labels background snapshots as system-created", () => {
    expect(formatSnapshotCreator({ createdByType: "system" })).toBe(
      "Companion system",
    );
  });

  it("keeps pre-attribution snapshots visibly distinct", () => {
    expect(formatSnapshotCreator({})).toBe("Unknown (legacy snapshot)");
  });
});
