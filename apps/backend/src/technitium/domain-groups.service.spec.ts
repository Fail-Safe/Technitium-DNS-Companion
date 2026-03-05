import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
  AdvancedBlockingMetrics,
  AdvancedBlockingSnapshot,
} from "./advanced-blocking.types";
import { CompanionDbService } from "./companion-db.service";
import { DomainGroupsService } from "./domain-groups.service";
import type { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import type { TechnitiumService } from "./technitium.service";

// --- Test helpers ---

function makeAbGroup(
  name: string,
  overrides: Partial<AdvancedBlockingGroup> = {},
): AdvancedBlockingGroup {
  return {
    name,
    blockingAddresses: [],
    allowed: [],
    blocked: [],
    allowListUrls: [],
    blockListUrls: [],
    allowedRegex: [],
    blockedRegex: [],
    regexAllowListUrls: [],
    regexBlockListUrls: [],
    adblockListUrls: [],
    ...overrides,
  };
}

function makeConfig(
  groups: AdvancedBlockingGroup[] = [],
): AdvancedBlockingConfig {
  return { localEndPointGroupMap: {}, networkGroupMap: {}, groups };
}

const emptyMetrics: AdvancedBlockingMetrics = {
  groupCount: 0,
  blockedDomainCount: 0,
  allowedDomainCount: 0,
  blockListUrlCount: 0,
  allowListUrlCount: 0,
  adblockListUrlCount: 0,
  allowedRegexCount: 0,
  blockedRegexCount: 0,
  regexAllowListUrlCount: 0,
  regexBlockListUrlCount: 0,
  localEndpointMappingCount: 0,
  networkMappingCount: 0,
  scheduledNodeCount: 0,
};

function makeSnapshot(
  nodeId: string,
  config?: AdvancedBlockingConfig,
  error?: string,
): AdvancedBlockingSnapshot {
  return {
    nodeId,
    baseUrl: `http://${nodeId}.test`,
    fetchedAt: new Date().toISOString(),
    metrics: emptyMetrics,
    config,
    error,
  };
}

// --- Spec ---

describe("DomainGroupsService", () => {
  let service: DomainGroupsService;
  let companionDb: CompanionDbService;
  let tempDir: string;
  let mockAdvancedBlocking: jest.Mocked<
    Pick<AdvancedBlockingService, "getSnapshot" | "setConfig">
  >;
  let mockTechnitium: jest.Mocked<Pick<TechnitiumService, "listNodes">>;
  let previousEnabled: string | undefined;

  beforeEach(() => {
    previousEnabled = process.env.DOMAIN_GROUPS_ENABLED;

    tempDir = mkdtempSync(join(tmpdir(), "domain-groups-"));
    process.env.DOMAIN_GROUPS_ENABLED = "true";
    process.env.COMPANION_DB_PATH = join(tempDir, "companion.sqlite");

    companionDb = new CompanionDbService();
    companionDb.onModuleInit();

    mockAdvancedBlocking = {
      getSnapshot: jest
        .fn()
        .mockResolvedValue(makeSnapshot("node-a", makeConfig())),
      setConfig: jest.fn().mockResolvedValue(undefined),
    };

    mockTechnitium = {
      listNodes: jest.fn().mockResolvedValue([]),
    };

    service = new DomainGroupsService(
      companionDb,
      mockAdvancedBlocking as unknown as AdvancedBlockingService,
      mockTechnitium as unknown as TechnitiumService,
      {
        saveSnapshot: jest.fn().mockResolvedValue(undefined),
      } as unknown as DnsFilteringSnapshotService,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    companionDb.onModuleDestroy();
    rmSync(tempDir, { recursive: true, force: true });

    if (previousEnabled === undefined) {
      delete process.env.DOMAIN_GROUPS_ENABLED;
    } else {
      process.env.DOMAIN_GROUPS_ENABLED = previousEnabled;
    }
    delete process.env.COMPANION_DB_PATH;
  });

  // ---------------------------------------------------------------------------
  // Group CRUD
  // ---------------------------------------------------------------------------

  describe("group management", () => {
    it("creates a group and returns details with empty entries and bindings", () => {
      const group = service.createDomainGroup({
        name: "YouTube",
        description: "Video services",
      });

      expect(group.id).toBeTruthy();
      expect(group.name).toBe("YouTube");
      expect(group.description).toBe("Video services");
      expect(group.entries).toEqual([]);
      expect(group.bindings).toEqual([]);
    });

    it("lists groups sorted alphabetically", () => {
      service.createDomainGroup({ name: "Streaming" });
      service.createDomainGroup({ name: "Analytics" });
      service.createDomainGroup({ name: "Gaming" });

      const names = service.listDomainGroups().map((g) => g.name);
      expect(names).toEqual(["Analytics", "Gaming", "Streaming"]);
    });

    it("throws NotFoundException for an unknown group id", () => {
      expect(() => service.getDomainGroup("no-such-id")).toThrow(
        NotFoundException,
      );
    });

    it("rejects duplicate group names case-insensitively", () => {
      service.createDomainGroup({ name: "YouTube" });

      expect(() => service.createDomainGroup({ name: "youtube" })).toThrow(
        ConflictException,
      );
      expect(() => service.createDomainGroup({ name: "YOUTUBE" })).toThrow(
        ConflictException,
      );
    });

    it("rejects an empty or whitespace-only group name", () => {
      expect(() => service.createDomainGroup({ name: "" })).toThrow(
        BadRequestException,
      );
    });

    it("updates group name and description", () => {
      const created = service.createDomainGroup({
        name: "Old Name",
        description: "Old desc",
      });
      const updated = service.updateDomainGroup(created.id, {
        name: "New Name",
        description: "New desc",
      });

      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("New desc");
      expect(service.listDomainGroups()[0]?.name).toBe("New Name");
    });

    it("deletes a group and returns { deleted: true }", () => {
      const group = service.createDomainGroup({ name: "Temporary" });

      const result = service.deleteDomainGroup(group.id);

      expect(result).toEqual({ deleted: true });
      expect(service.listDomainGroups()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Entry CRUD
  // ---------------------------------------------------------------------------

  describe("entry management", () => {
    let groupId: string;

    beforeEach(() => {
      groupId = service.createDomainGroup({ name: "Test Group" }).id;
    });

    it("adds an exact entry and normalizes it to lowercase without trailing dots", () => {
      const entry = service.addEntry(groupId, {
        matchType: "exact",
        value: "YouTube.COM.",
      });

      expect(entry.matchType).toBe("exact");
      expect(entry.value).toBe("youtube.com");
    });

    it("adds a regex entry preserving its original casing", () => {
      const entry = service.addEntry(groupId, {
        matchType: "regex",
        value: ".*\\.googlevideo\\.com$",
        note: "Video streams",
      });

      expect(entry.matchType).toBe("regex");
      expect(entry.value).toBe(".*\\.googlevideo\\.com$");
      expect(entry.note).toBe("Video streams");
    });

    it("rejects an exact entry containing a wildcard character", () => {
      expect(() =>
        service.addEntry(groupId, {
          matchType: "exact",
          value: "*.example.com",
        }),
      ).toThrow(BadRequestException);
    });

    it("rejects an invalid regex pattern", () => {
      expect(() =>
        service.addEntry(groupId, { matchType: "regex", value: "[invalid" }),
      ).toThrow(BadRequestException);
    });

    it("rejects a duplicate entry (same matchType and normalized value)", () => {
      service.addEntry(groupId, { matchType: "exact", value: "example.com" });

      expect(() =>
        service.addEntry(groupId, { matchType: "exact", value: "Example.com" }),
      ).toThrow(ConflictException);
    });

    it("allows the same value under different matchTypes", () => {
      service.addEntry(groupId, { matchType: "exact", value: "example.com" });

      expect(() =>
        service.addEntry(groupId, { matchType: "regex", value: "example.com" }),
      ).not.toThrow();
    });

    it("updates entry value and note", () => {
      const entry = service.addEntry(groupId, {
        matchType: "exact",
        value: "old.com",
        note: "old note",
      });
      const updated = service.updateEntry(groupId, entry.id, {
        value: "new.com",
        note: "new note",
      });

      expect(updated.value).toBe("new.com");
      expect(updated.note).toBe("new note");
    });

    it("removes an entry and throws NotFoundException on a second attempt", () => {
      const entry = service.addEntry(groupId, {
        matchType: "exact",
        value: "remove.me",
      });

      expect(service.removeEntry(groupId, entry.id)).toEqual({ deleted: true });
      expect(service.getDomainGroup(groupId).entries).toHaveLength(0);
      expect(() => service.removeEntry(groupId, entry.id)).toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Bindings
  // ---------------------------------------------------------------------------

  describe("bindings", () => {
    let groupId: string;

    beforeEach(() => {
      groupId = service.createDomainGroup({ name: "Kids Content" }).id;
    });

    it("adds an allow binding", () => {
      const binding = service.addBinding(groupId, {
        advancedBlockingGroupName: "Kids Devices",
        action: "allow",
      });

      expect(binding.advancedBlockingGroupName).toBe("Kids Devices");
      expect(binding.action).toBe("allow");
      expect(service.getDomainGroup(groupId).bindings).toHaveLength(1);
    });

    it("adds a block binding", () => {
      const binding = service.addBinding(groupId, {
        advancedBlockingGroupName: "Kids Devices",
        action: "block",
      });

      expect(binding.action).toBe("block");
    });

    it("rejects a duplicate binding (same AB group + action)", () => {
      service.addBinding(groupId, {
        advancedBlockingGroupName: "Kids Devices",
        action: "allow",
      });

      expect(() =>
        service.addBinding(groupId, {
          advancedBlockingGroupName: "Kids Devices",
          action: "allow",
        }),
      ).toThrow(ConflictException);
    });

    it("allows both allow and block bindings to the same AB group — conflict is detected at materialization time", () => {
      service.addBinding(groupId, {
        advancedBlockingGroupName: "Kids Devices",
        action: "allow",
      });

      // The storage layer permits it; getMaterializationPreview is responsible
      // for surfacing the conflict and blocking apply.
      expect(() =>
        service.addBinding(groupId, {
          advancedBlockingGroupName: "Kids Devices",
          action: "block",
        }),
      ).not.toThrow();
    });

    it("removes a binding", () => {
      const binding = service.addBinding(groupId, {
        advancedBlockingGroupName: "Kids Devices",
        action: "allow",
      });

      expect(service.removeBinding(groupId, binding.id)).toEqual({
        deleted: true,
      });
      expect(service.getDomainGroup(groupId).bindings).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Materialization preview
  // ---------------------------------------------------------------------------

  describe("getMaterializationPreview", () => {
    it("returns an empty preview when no groups exist", () => {
      const preview = service.getMaterializationPreview();

      expect(preview.hasConflicts).toBe(false);
      expect(preview.conflicts).toEqual([]);
      expect(preview.groups).toEqual([]);
      expect(preview.ownedPairs).toEqual([]);
      expect(preview.allBindings).toEqual([]);
    });

    it("routes entries to allowed or blocked lists based on the binding action", () => {
      const allowGroup = service.createDomainGroup({ name: "Allow List" });
      service.addEntry(allowGroup.id, {
        matchType: "exact",
        value: "safe.com",
      });
      service.addBinding(allowGroup.id, {
        advancedBlockingGroupName: "Default",
        action: "allow",
      });

      const blockGroup = service.createDomainGroup({ name: "Block List" });
      service.addEntry(blockGroup.id, { matchType: "exact", value: "bad.com" });
      service.addEntry(blockGroup.id, {
        matchType: "regex",
        value: ".*\\.ads\\.com$",
      });
      service.addBinding(blockGroup.id, {
        advancedBlockingGroupName: "Default",
        action: "block",
      });

      const preview = service.getMaterializationPreview();
      expect(preview.groups).toHaveLength(1);

      const compiled = preview.groups[0];
      expect(compiled.allowed).toEqual(["safe.com"]);
      expect(compiled.blocked).toEqual(["bad.com"]);
      expect(compiled.blockedRegex).toEqual([".*\\.ads\\.com$"]);
    });

    it("merges entries from multiple domain groups into the same AB group", () => {
      const groupA = service.createDomainGroup({ name: "Group A" });
      service.addEntry(groupA.id, { matchType: "exact", value: "alpha.com" });
      service.addBinding(groupA.id, {
        advancedBlockingGroupName: "Default",
        action: "allow",
      });

      const groupB = service.createDomainGroup({ name: "Group B" });
      service.addEntry(groupB.id, { matchType: "exact", value: "beta.com" });
      service.addBinding(groupB.id, {
        advancedBlockingGroupName: "Default",
        action: "allow",
      });

      const preview = service.getMaterializationPreview();
      expect(preview.groups).toHaveLength(1);
      expect(preview.groups[0]?.allowed).toEqual(["alpha.com", "beta.com"]);
    });

    it("detects a same-specificity allow/block conflict and excludes it from materialized output", () => {
      const allowGroup = service.createDomainGroup({ name: "Allow Group" });
      service.addEntry(allowGroup.id, {
        matchType: "exact",
        value: "contested.com",
      });
      service.addBinding(allowGroup.id, {
        advancedBlockingGroupName: "Default",
        action: "allow",
      });

      const blockGroup = service.createDomainGroup({ name: "Block Group" });
      service.addEntry(blockGroup.id, {
        matchType: "exact",
        value: "contested.com",
      });
      service.addBinding(blockGroup.id, {
        advancedBlockingGroupName: "Default",
        action: "block",
      });

      const preview = service.getMaterializationPreview();
      expect(preview.hasConflicts).toBe(true);
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0]?.value).toBe("contested.com");
      expect(preview.conflicts[0]?.actions).toEqual(["allow", "block"]);
      // The conflicting entry is excluded — no safe output is produced
      expect(preview.groups).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Apply materialization
  // ---------------------------------------------------------------------------

  describe("applyMaterialization", () => {
    const primaryNode = {
      id: "node-a",
      baseUrl: "http://node-a",
      isPrimary: true,
    };
    const secondaryNode = {
      id: "node-b",
      baseUrl: "http://node-b",
      isPrimary: false,
    };

    beforeEach(() => {
      // Seed one domain group with a binding so there is work to apply
      const group = service.createDomainGroup({ name: "YouTube" });
      service.addEntry(group.id, { matchType: "exact", value: "youtube.com" });
      service.addBinding(group.id, {
        advancedBlockingGroupName: "Adults",
        action: "allow",
      });
    });

    it("dry run computes the result but does not call setConfig", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig()),
      );

      const result = await service.applyMaterialization({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.nodes[0]?.updatedGroups).toContain("Adults");
      expect(mockAdvancedBlocking.setConfig).not.toHaveBeenCalled();
    });

    it("live apply calls setConfig and returns the node in appliedNodeIds", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig()),
      );

      const result = await service.applyMaterialization({ dryRun: false });

      expect(result.dryRun).toBe(false);
      expect(result.appliedNodeIds).toContain("node-a");
      expect(mockAdvancedBlocking.setConfig).toHaveBeenCalledTimes(1);

      const [, writtenConfig] = mockAdvancedBlocking.setConfig.mock
        .calls[0] as [string, AdvancedBlockingConfig];
      const adultsGroup = writtenConfig.groups.find((g) => g.name === "Adults");
      expect(adultsGroup?.allowed).toContain("youtube.com");
    });

    it("throws ConflictException when materialization has allow/block conflicts", async () => {
      // Create a conflict against the domain group seeded in beforeEach
      const conflictGroup = service.createDomainGroup({
        name: "Block YouTube",
      });
      service.addEntry(conflictGroup.id, {
        matchType: "exact",
        value: "youtube.com",
      });
      service.addBinding(conflictGroup.id, {
        advancedBlockingGroupName: "Adults",
        action: "block",
      });

      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);

      await expect(
        service.applyMaterialization({ dryRun: false }),
      ).rejects.toThrow(ConflictException);
      expect(mockAdvancedBlocking.setConfig).not.toHaveBeenCalled();
    });

    it("defaults to primary nodes only in cluster mode", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode, secondaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig()),
      );

      const result = await service.applyMaterialization({ dryRun: false });

      expect(result.appliedNodeIds).toEqual(["node-a"]);
      expect(result.skippedNodeIds).toContain("node-b");
      expect(mockAdvancedBlocking.setConfig).toHaveBeenCalledTimes(1);
    });

    it("applies to all nodes when no primary is designated", async () => {
      const plain1 = {
        id: "node-a",
        baseUrl: "http://node-a",
        isPrimary: false,
      };
      const plain2 = {
        id: "node-b",
        baseUrl: "http://node-b",
        isPrimary: false,
      };
      mockTechnitium.listNodes.mockResolvedValue([plain1, plain2]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig()),
      );

      const result = await service.applyMaterialization({ dryRun: false });

      expect(result.appliedNodeIds).toHaveLength(2);
      expect(mockAdvancedBlocking.setConfig).toHaveBeenCalledTimes(2);
    });

    it("rejects an explicit write to a non-primary node in cluster mode", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode, secondaryNode]);

      await expect(
        service.applyMaterialization({
          dryRun: false,
          nodeIds: [secondaryNode.id],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockAdvancedBlocking.setConfig).not.toHaveBeenCalled();
    });

    it("preserves pre-existing entries on first apply while adding DG entries (tracking model)", async () => {
      // On the first apply the tracking table is empty, so all existing entries
      // are treated as "manual" and are preserved alongside the DG-contributed ones.
      const existingGroup = makeAbGroup("Adults", {
        blockingAddresses: ["0.0.0.0"],
        allowed: ["pre-existing-allowed.com"],
        blocked: ["pre-existing-blocked.com"],
        allowListUrls: ["https://example.com/list.txt"],
      });
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig([existingGroup])),
      );

      await service.applyMaterialization({ dryRun: false });

      const [, writtenConfig] = mockAdvancedBlocking.setConfig.mock
        .calls[0] as [string, AdvancedBlockingConfig];
      const adultsGroup = writtenConfig.groups.find((g) => g.name === "Adults");

      // Pre-existing allowed entry treated as manual on first apply → preserved
      expect(adultsGroup?.allowed).toContain("pre-existing-allowed.com");
      // DG entry added alongside manual
      expect(adultsGroup?.allowed).toContain("youtube.com");

      // Blocked not owned → pre-existing entry preserved unchanged
      expect(adultsGroup?.blocked).toContain("pre-existing-blocked.com");

      // Structural settings preserved
      expect(adultsGroup?.blockingAddresses).toEqual(["0.0.0.0"]);
      expect(adultsGroup?.allowListUrls).toEqual([
        "https://example.com/list.txt",
      ]);
    });

    it("removes DG-tracked entries when removed from a DG after prior apply, preserving manual entries", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);

      // First apply: live config already has a manual entry.
      const initialConfig = makeConfig([
        makeAbGroup("Adults", { allowed: ["manual.com"] }),
      ]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", initialConfig),
      );
      await service.applyMaterialization({ dryRun: false });

      const [, firstConfig] = mockAdvancedBlocking.setConfig.mock.calls[0] as [
        string,
        AdvancedBlockingConfig,
      ];
      // After first apply both the manual entry and the DG entry are present.
      expect(
        firstConfig.groups.find((g) => g.name === "Adults")?.allowed,
      ).toContain("youtube.com");
      expect(
        firstConfig.groups.find((g) => g.name === "Adults")?.allowed,
      ).toContain("manual.com");

      // Remove youtube.com from the DG (binding still exists).
      const group = service
        .listDomainGroups()
        .find((g) => g.name === "YouTube")!;
      const detail = service.getDomainGroup(group.id);
      service.removeEntry(group.id, detail.entries[0].id);

      // Second apply: live config is the result of the first apply.
      mockAdvancedBlocking.setConfig.mockClear();
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", firstConfig),
      );
      await service.applyMaterialization({ dryRun: false });

      const [, secondConfig] = mockAdvancedBlocking.setConfig.mock.calls[0] as [
        string,
        AdvancedBlockingConfig,
      ];
      const adultsGroup = secondConfig.groups.find((g) => g.name === "Adults");

      // youtube.com was tracked as DG-contributed → removed when DG entry deleted
      expect(adultsGroup?.allowed).not.toContain("youtube.com");
      // manual.com was never in the tracking table → preserved
      expect(adultsGroup?.allowed).toContain("manual.com");
    });

    it("dry run does not update the tracking table", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig()),
      );

      await service.applyMaterialization({ dryRun: true });

      // Tracking table must remain empty after a dry run.
      const db = companionDb.db!;
      const rowsAfterDryRun = db
        .prepare("SELECT * FROM domain_group_applied_entries")
        .all();
      expect(rowsAfterDryRun).toHaveLength(0);

      // A live apply populates the tracking table.
      await service.applyMaterialization({ dryRun: false });
      const rowsAfterLive = db
        .prepare("SELECT * FROM domain_group_applied_entries")
        .all();
      expect(rowsAfterLive.length).toBeGreaterThan(0);
    });

    it("removes only DG-contributed entries when binding is removed and apply runs again", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);

      // First apply: establish tracking with a manual entry also present.
      const initialConfig = makeConfig([
        makeAbGroup("Adults", { allowed: ["manual.com"] }),
      ]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", initialConfig),
      );
      await service.applyMaterialization({ dryRun: false });

      const [, firstConfig] = mockAdvancedBlocking.setConfig.mock.calls[0] as [
        string,
        AdvancedBlockingConfig,
      ];

      // Remove the binding (DG still has its entries, but is no longer bound).
      const group = service
        .listDomainGroups()
        .find((g) => g.name === "YouTube")!;
      const detail = service.getDomainGroup(group.id);
      service.removeBinding(group.id, detail.bindings[0].id);

      // Second apply: live config = result of first apply.
      mockAdvancedBlocking.setConfig.mockClear();
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", firstConfig),
      );
      await service.applyMaterialization({ dryRun: false });

      const [, secondConfig] = mockAdvancedBlocking.setConfig.mock.calls[0] as [
        string,
        AdvancedBlockingConfig,
      ];
      const adultsGroup = secondConfig.groups.find((g) => g.name === "Adults");

      // youtube.com was DG-tracked → removed when binding deleted
      expect(adultsGroup?.allowed).not.toContain("youtube.com");
      // manual.com was never tracked → preserved
      expect(adultsGroup?.allowed).toContain("manual.com");
    });

    it("deduplicates ownedPairs when multiple DGs share the same (group, action)", () => {
      const groupB = service.createDomainGroup({ name: "Social" });
      service.addEntry(groupB.id, {
        matchType: "exact",
        value: "facebook.com",
      });
      service.addBinding(groupB.id, {
        advancedBlockingGroupName: "Adults",
        action: "allow",
      });

      const preview = service.getMaterializationPreview();
      const adultsAllowPairs = preview.ownedPairs.filter(
        (p) => p.advancedBlockingGroupName === "Adults" && p.action === "allow",
      );
      // Two DGs (YouTube + Social) both bound to Adults/allow → still one ownedPair entry
      expect(adultsAllowPairs).toHaveLength(1);
    });

    it("allBindings includes entries from all DGs joined with DG names", () => {
      const groupB = service.createDomainGroup({ name: "Social" });
      service.addBinding(groupB.id, {
        advancedBlockingGroupName: "Kids",
        action: "block",
      });

      const preview = service.getMaterializationPreview();
      const names = preview.allBindings.map((b) => b.domainGroupName).sort();
      expect(names).toContain("YouTube");
      expect(names).toContain("Social");

      const socialBinding = preview.allBindings.find(
        (b) => b.domainGroupName === "Social",
      );
      expect(socialBinding?.advancedBlockingGroupName).toBe("Kids");
      expect(socialBinding?.action).toBe("block");
      expect(socialBinding?.bindingId).toBeTruthy();
    });

    it("skips apply and reports an error when a node's snapshot config is unavailable", async () => {
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", undefined, "Connection refused"),
      );

      const result = await service.applyMaterialization({ dryRun: false });

      expect(result.nodes[0]?.error).toBeTruthy();
      expect(result.appliedNodeIds).toHaveLength(0);
      expect(mockAdvancedBlocking.setConfig).not.toHaveBeenCalled();
    });

    it("marks a group as skipped when materialized content is identical to what is already applied", async () => {
      // Pre-populate the AB group with exactly what materialization would produce
      const alreadyAppliedGroup = makeAbGroup("Adults", {
        allowed: ["youtube.com"],
      });
      mockTechnitium.listNodes.mockResolvedValue([primaryNode]);
      mockAdvancedBlocking.getSnapshot.mockResolvedValue(
        makeSnapshot("node-a", makeConfig([alreadyAppliedGroup])),
      );

      const result = await service.applyMaterialization({ dryRun: false });

      expect(result.nodes[0]?.skippedGroups).toContain("Adults");
      expect(result.nodes[0]?.updatedGroups).toHaveLength(0);
      // No change → setConfig should not be called
      expect(mockAdvancedBlocking.setConfig).not.toHaveBeenCalled();
    });
  });
});
