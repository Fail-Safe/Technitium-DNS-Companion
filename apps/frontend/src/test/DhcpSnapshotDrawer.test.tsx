import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DhcpSnapshotDrawer } from "../components/dhcp/DhcpSnapshotDrawer";
import type { DhcpSnapshot, DhcpSnapshotMetadata } from "../types/dhcp";

const pushToast = vi.fn();
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ pushToast }) }));

type DrawerMocks = {
  listSnapshots?: ReturnType<typeof vi.fn>;
  createSnapshot?: ReturnType<typeof vi.fn>;
  restoreSnapshot?: ReturnType<typeof vi.fn>;
  setSnapshotPinned?: ReturnType<typeof vi.fn>;
  getSnapshotDetail?: ReturnType<typeof vi.fn>;
  deleteSnapshot?: ReturnType<typeof vi.fn>;
  updateSnapshotNote?: ReturnType<typeof vi.fn>;
};

const baseSnapshot: DhcpSnapshotMetadata = {
  id: "snap-1",
  nodeId: "node-1",
  createdAt: "2024-01-01T00:00:00.000Z",
  scopeCount: 2,
  origin: "manual",
};

const detailedSnapshot: DhcpSnapshot = {
  metadata: { ...baseSnapshot, note: "Existing note" },
  scopes: [
    {
      enabled: true,
      scope: {
        name: "Scope A",
        startingAddress: "10.0.0.10",
        endingAddress: "10.0.0.50",
        subnetMask: "255.255.255.0",
      },
    },
  ],
};

const renderDrawer = (overrides: DrawerMocks = {}) => {
  const listSnapshots =
    overrides.listSnapshots ?? vi.fn().mockResolvedValue([baseSnapshot]);
  const createSnapshot = overrides.createSnapshot ?? vi.fn();
  const restoreSnapshot =
    overrides.restoreSnapshot ??
    vi
      .fn()
      .mockResolvedValue({ snapshot: baseSnapshot, restored: 2, deleted: 1 });
  const setSnapshotPinned = overrides.setSnapshotPinned ?? vi.fn();
  const getSnapshotDetail =
    overrides.getSnapshotDetail ?? vi.fn().mockResolvedValue(detailedSnapshot);
  const deleteSnapshot = overrides.deleteSnapshot ?? vi.fn();
  const updateSnapshotNote =
    overrides.updateSnapshotNote ??
    vi.fn().mockResolvedValue({ ...baseSnapshot, note: "Saved note" });

  const utils = render(
    <DhcpSnapshotDrawer
      isOpen
      nodeId="node-1"
      nodeName="Node One"
      nodeScopeCount={2}
      onClose={vi.fn()}
      listSnapshots={listSnapshots}
      createSnapshot={createSnapshot}
      restoreSnapshot={restoreSnapshot}
      setSnapshotPinned={setSnapshotPinned}
      getSnapshotDetail={getSnapshotDetail}
      deleteSnapshot={deleteSnapshot}
      updateSnapshotNote={updateSnapshotNote}
    />,
  );

  return {
    listSnapshots,
    createSnapshot,
    restoreSnapshot,
    setSnapshotPinned,
    getSnapshotDetail,
    deleteSnapshot,
    updateSnapshotNote,
    ...utils,
  };
};

describe("DhcpSnapshotDrawer", () => {
  beforeEach(() => {
    pushToast.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2024-01-02T00:00:00.000Z").getTime(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows an empty state when no snapshots are returned", async () => {
    const listSnapshots = vi.fn().mockResolvedValue([]);
    renderDrawer({ listSnapshots });

    await waitFor(() => expect(listSnapshots).toHaveBeenCalled());

    expect(
      await screen.findByText(/No snapshots yet/i, { selector: "strong" }),
    ).toBeInTheDocument();
  });

  it("renders an error state when listing snapshots fails", async () => {
    const listSnapshots = vi.fn().mockRejectedValue(new Error("network down"));
    renderDrawer({ listSnapshots });

    expect(await screen.findByText(/Could not load snapshots/i)).not.toBeNull();
    expect(screen.getByText("network down")).not.toBeNull();
  });

  it("loads and displays snapshot details when View is clicked", async () => {
    const getSnapshotDetail = vi.fn().mockResolvedValue(detailedSnapshot);
    renderDrawer({ getSnapshotDetail });

    const item = await screen.findByText(/snap-1/i);
    const viewButton = within(
      item.closest(".snapshot-drawer__item")!,
    ).getByRole("button", { name: /view/i });
    await userEvent.click(viewButton);

    expect(await screen.findByText(/Snapshot details/i)).not.toBeNull();
    const scopes = await screen.findAllByText(/Scope A/);
    expect(scopes.length).toBeGreaterThan(0);
    expect(getSnapshotDetail).toHaveBeenCalledWith("node-1", baseSnapshot.id);
  });

  it("restores a snapshot with the selected keep extras option", async () => {
    const listSnapshots = vi.fn().mockResolvedValue([baseSnapshot]);
    const restoreSnapshot = vi
      .fn()
      .mockResolvedValue({ snapshot: baseSnapshot, restored: 1, deleted: 0 });
    renderDrawer({ listSnapshots, restoreSnapshot });

    const restoreButton = await screen.findByRole("button", {
      name: /restore/i,
    });
    await userEvent.click(restoreButton);

    const dialog = screen.getByRole("dialog", { name: /restore snapshot/i });
    const checkbox = within(dialog).getByLabelText(
      /Scopes not in the snapshot should be kept/i,
    );
    await userEvent.click(checkbox);

    const confirm = within(dialog).getByRole("button", { name: /restore$/i });
    await userEvent.click(confirm);

    expect(confirm.textContent).toMatch(/Restoring/i);

    await waitFor(() =>
      expect(restoreSnapshot).toHaveBeenCalledWith("node-1", baseSnapshot.id, {
        keepExtras: false,
      }),
    );
    expect(listSnapshots).toHaveBeenCalledTimes(2); // initial load + refresh after restore
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Restored") }),
    );
  });

  it("allows adding and saving a note", async () => {
    const updateSnapshotNote = vi
      .fn()
      .mockResolvedValue({ ...baseSnapshot, note: "Saved note" });
    renderDrawer({ updateSnapshotNote });

    const noteButton = await screen.findByRole("button", { name: /add note/i });
    await userEvent.click(noteButton);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  Saved note  ");

    const saveButton = screen.getByRole("button", { name: /save note/i });
    await userEvent.click(saveButton);

    await waitFor(() =>
      expect(updateSnapshotNote).toHaveBeenCalledWith(
        "node-1",
        baseSnapshot.id,
        "Saved note",
      ),
    );
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Note saved", tone: "success" }),
    );
    expect(await screen.findByText("Saved note")).not.toBeNull();
  });
});
