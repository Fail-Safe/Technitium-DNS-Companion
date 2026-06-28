import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { isIP } from "node:net";
import {
  computeReverseZoneAndRecordName,
  toFqdn,
} from "./split-horizon-ptr/split-horizon-ptr.util";
import { DhcpDnsSyncStateService } from "./dhcp-dns-sync-state.service";
import type {
  DhcpDnsSyncAction,
  DhcpDnsSyncApplyRequest,
  DhcpDnsSyncApplyResponse,
  DhcpDnsSyncDefaultsResponse,
  DhcpDnsSyncPlannedRecord,
  DhcpDnsSyncPreviewRequest,
  DhcpDnsSyncPreviewResponse,
  DhcpDnsSyncScopeIssue,
  DhcpDnsSyncSourceScope,
  DhcpDnsSyncSummary,
} from "./dhcp-dns-sync.types";
import { TechnitiumService } from "./technitium.service";
import type {
  TechnitiumDhcpLease,
  TechnitiumDhcpScope,
  TechnitiumZoneRecord,
} from "./technitium.types";

const MANAGED_COMMENT_PREFIX = "TDC DHCP DNS sync";
const DEFAULT_TTL = 900;
const DEFAULT_STALE_GRACE_SECONDS = 24 * 60 * 60;
const DEFAULT_INCLUDE_REVERSE = true;

interface DesiredDhcpRecord {
  sourceNodeId: string;
  scopeName: string;
  hostname: string;
  hostnameFqdn: string;
  ip: string;
  hardwareAddress?: string;
  forwardZoneName: string;
  recordName: string;
  recordType: "A" | "AAAA";
}

interface ExistingRecordValue {
  value?: string;
  comments?: string;
  managed?: ManagedRecordComment;
}

interface ManagedRecordComment {
  sourceNodeId?: string;
  scopeName?: string;
  ip?: string;
  hostname?: string;
  mac?: string;
}

@Injectable()
export class DhcpDnsSyncService {
  private readonly logger = new Logger(DhcpDnsSyncService.name);

  constructor(
    private readonly technitiumService: TechnitiumService,
    private readonly stateService: DhcpDnsSyncStateService,
  ) {}

  getDefaults(): DhcpDnsSyncDefaultsResponse {
    return {
      includeReverse: DEFAULT_INCLUDE_REVERSE,
      ttl: DEFAULT_TTL,
      staleGraceSeconds: DEFAULT_STALE_GRACE_SECONDS,
    };
  }

  async preview(
    request: DhcpDnsSyncPreviewRequest,
  ): Promise<DhcpDnsSyncPreviewResponse> {
    const normalizedRequest = this.normalizeRequest(request);
    const targetNodeId = await this.selectTargetPrimaryNodeId();
    const zonesEnvelope = await this.technitiumService.listZones(targetNodeId);
    const existingZoneNames = new Map(
      (zonesEnvelope.data.zones ?? [])
        .map((zone) => (zone.name ?? "").trim())
        .filter(Boolean)
        .map((zoneName) => [zoneName.toLowerCase(), zoneName]),
    );

    const scopeIssues: DhcpDnsSyncScopeIssue[] = [];
    const desiredRecords: DesiredDhcpRecord[] = [];
    const sourceScopes = normalizedRequest.sourceScopes;

    for (const sourceScope of sourceScopes) {
      const scopeResult = await this.loadSourceScope(sourceScope);
      if (!scopeResult.scope) {
        scopeIssues.push({
          severity: "error",
          sourceNodeId: sourceScope.nodeId,
          scopeName: sourceScope.scopeName,
          message: scopeResult.error ?? "Failed to load DHCP scope.",
        });
        continue;
      }

      const scope = scopeResult.scope;
      if (scope.dnsUpdates === true) {
        scopeIssues.push({
          severity: "error",
          sourceNodeId: sourceScope.nodeId,
          scopeName: sourceScope.scopeName,
          message:
            "Native Technitium DHCP DNS updates are enabled for this scope. Disable dnsUpdates before Companion manages DNS records for it.",
        });
      }

      const forwardZoneName = this.normalizeZoneName(
        normalizedRequest.forwardZoneName || scope.domainName,
      );
      if (!forwardZoneName) {
        scopeIssues.push({
          severity: "error",
          sourceNodeId: sourceScope.nodeId,
          scopeName: sourceScope.scopeName,
          message:
            "No forward zone was provided and the DHCP scope has no domainName.",
        });
        continue;
      }

      if (!existingZoneNames.has(forwardZoneName.toLowerCase())) {
        scopeIssues.push({
          severity: "error",
          sourceNodeId: sourceScope.nodeId,
          scopeName: sourceScope.scopeName,
          message: `Forward zone "${forwardZoneName}" does not exist on primary node "${targetNodeId}".`,
        });
        continue;
      }

      const leasesResult = await this.loadSourceLeases(sourceScope.nodeId);
      if (!leasesResult.leases) {
        scopeIssues.push({
          severity: "error",
          sourceNodeId: sourceScope.nodeId,
          scopeName: sourceScope.scopeName,
          message: leasesResult.error ?? "Failed to load DHCP leases.",
        });
        continue;
      }

      const scopeLeases = leasesResult.leases.filter(
        (lease) =>
          this.normalizeScopeName(lease.scope) ===
          this.normalizeScopeName(sourceScope.scopeName),
      );

      for (const lease of scopeLeases) {
        const desired = this.leaseToDesiredRecord(
          sourceScope,
          scope,
          lease,
          forwardZoneName,
        );
        if (desired) {
          desiredRecords.push(desired);
        }
      }
    }

    const plannedRecords = await this.planRecords({
      targetNodeId,
      existingZoneNames,
      desiredRecords,
      sourceScopes,
      includeReverse: normalizedRequest.includeReverse,
      staleGraceSeconds: normalizedRequest.staleGraceSeconds,
    });

    return {
      fetchedAt: new Date().toISOString(),
      targetNodeId,
      sourceScopes,
      includeReverse: normalizedRequest.includeReverse,
      ttl: normalizedRequest.ttl,
      staleGraceSeconds: normalizedRequest.staleGraceSeconds,
      scopeIssues,
      plannedRecords,
      summary: this.summarize(plannedRecords, scopeIssues),
    };
  }

  async apply(
    request: DhcpDnsSyncApplyRequest,
  ): Promise<DhcpDnsSyncApplyResponse> {
    const dryRun = request.dryRun === true;
    const preview = await this.preview(request);
    const hardErrors = preview.scopeIssues.filter(
      (issue) => issue.severity === "error",
    );
    if (hardErrors.length > 0) {
      throw new BadRequestException(
        `DHCP DNS sync cannot apply while ${hardErrors.length} scope error(s) exist. Run preview for details.`,
      );
    }

    const mutableRecords = preview.plannedRecords.filter((record) =>
      ["create-record", "update-record", "delete-record"].includes(
        record.status,
      ),
    );
    const actions: DhcpDnsSyncAction[] = [];

    if (!dryRun && mutableRecords.length > 0) {
      const zoneNames = Array.from(
        new Set(mutableRecords.map((record) => record.zoneName)),
      );
      try {
        await this.technitiumService.createZoneSnapshot(
          preview.targetNodeId,
          zoneNames,
          "automatic",
          "Automatic snapshot before DHCP DNS Sync apply",
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create automatic zone snapshot before DHCP DNS sync apply: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    for (const record of preview.plannedRecords) {
      if (
        record.status !== "create-record" &&
        record.status !== "update-record" &&
        record.status !== "delete-record"
      ) {
        actions.push(this.toNoopAction(record));
        continue;
      }

      if (dryRun) {
        actions.push({
          kind: record.kind,
          status: record.status,
          ok: true,
          zoneName: record.zoneName,
          recordName: record.recordName,
          recordType: record.recordType,
          currentValue: record.currentValue,
          desiredValue: record.desiredValue,
          message: `Dry run: would ${record.status.replace("-record", "")} record.`,
        });
        continue;
      }

      actions.push(
        await this.applyRecord(preview.targetNodeId, preview.ttl, record),
      );
    }

    if (!dryRun) {
      this.stateService.markSeen(
        preview.plannedRecords
          .filter(
            (record) =>
              record.status !== "delete-record" &&
              record.kind === "forward" &&
              !!record.hostname &&
              !!record.ip,
          )
          .map((record) => ({
            sourceNodeId: record.sourceNodeId,
            scopeName: record.scopeName,
            ip: record.ip!,
            hostname: record.hostname!,
            hardwareAddress: record.hardwareAddress,
            forwardZoneName: record.zoneName,
          })),
        preview.fetchedAt,
      );

      for (const action of actions) {
        if (action.ok && action.status === "delete-record") {
          const planned = preview.plannedRecords.find(
            (record) =>
              record.zoneName === action.zoneName &&
              record.recordName === action.recordName &&
              record.recordType === action.recordType,
          );
          if (planned?.ip) {
            this.stateService.removeSeen(
              planned.sourceNodeId,
              planned.scopeName,
              planned.ip,
            );
          }
        }
      }
    }

    return {
      ...preview,
      dryRun,
      actions,
      summary: {
        ...preview.summary,
        errors:
          preview.summary.errors +
          actions.filter((action) => !action.ok).length,
      },
    };
  }

  private async planRecords(args: {
    targetNodeId: string;
    existingZoneNames: Map<string, string>;
    desiredRecords: DesiredDhcpRecord[];
    sourceScopes: DhcpDnsSyncSourceScope[];
    includeReverse: boolean;
    staleGraceSeconds: number;
  }): Promise<DhcpDnsSyncPlannedRecord[]> {
    const planned: DhcpDnsSyncPlannedRecord[] = [];
    const zonesToFetch = new Set<string>();
    const desiredForwardKeys = new Set<string>();
    const desiredReverseKeys = new Set<string>();

    for (const desired of args.desiredRecords) {
      zonesToFetch.add(desired.forwardZoneName);
      desiredForwardKeys.add(
        this.recordKey(
          desired.forwardZoneName,
          desired.recordName,
          desired.recordType,
        ),
      );

      if (args.includeReverse) {
        const reverse = computeReverseZoneAndRecordName(desired.ip);
        if (!("error" in reverse)) {
          const reverseZoneName = args.existingZoneNames.get(
            reverse.zoneName.toLowerCase(),
          );
          if (reverseZoneName) {
            zonesToFetch.add(reverseZoneName);
            desiredReverseKeys.add(
              this.recordKey(reverseZoneName, reverse.recordName, "PTR"),
            );
          }
        }
      }
    }

    for (const sourceScope of args.sourceScopes) {
      for (const seen of this.stateService.listSeenLeases(
        sourceScope.nodeId,
        sourceScope.scopeName,
      )) {
        if (!this.isStale(seen.lastSeenAt, args.staleGraceSeconds)) {
          continue;
        }

        if (seen.forwardZoneName) {
          zonesToFetch.add(seen.forwardZoneName);
        }

        if (args.includeReverse) {
          const reverse = computeReverseZoneAndRecordName(seen.ip);
          if (!("error" in reverse)) {
            const reverseZoneName = args.existingZoneNames.get(
              reverse.zoneName.toLowerCase(),
            );
            if (reverseZoneName) {
              zonesToFetch.add(reverseZoneName);
            }
          }
        }
      }
    }

    const recordsByZone = await this.fetchRecordsByZone(
      args.targetNodeId,
      Array.from(zonesToFetch),
    );

    for (const desired of args.desiredRecords) {
      planned.push(
        this.planForwardRecord(
          desired,
          recordsByZone.get(desired.forwardZoneName.toLowerCase()) ?? [],
        ),
      );

      if (args.includeReverse) {
        planned.push(
          this.planReverseRecord(
            desired,
            args.existingZoneNames,
            recordsByZone,
          ),
        );
      }
    }

    planned.push(
      ...this.planStaleDeletes({
        sourceScopes: args.sourceScopes,
        includeReverse: args.includeReverse,
        existingZoneNames: args.existingZoneNames,
        recordsByZone,
        desiredForwardKeys,
        desiredReverseKeys,
        staleGraceSeconds: args.staleGraceSeconds,
      }),
    );

    return planned.sort((a, b) =>
      [a.sourceNodeId, a.scopeName, a.hostname ?? "", a.ip ?? "", a.kind]
        .join("|")
        .localeCompare(
          [
            b.sourceNodeId,
            b.scopeName,
            b.hostname ?? "",
            b.ip ?? "",
            b.kind,
          ].join("|"),
        ),
    );
  }

  private planForwardRecord(
    desired: DesiredDhcpRecord,
    records: TechnitiumZoneRecord[],
  ): DhcpDnsSyncPlannedRecord {
    const existing = this.findExistingRecords(
      records,
      desired.forwardZoneName,
      desired.recordName,
      desired.recordType,
    );
    const desiredValue = desired.ip;
    const base = this.basePlannedRecord(desired, "forward", desired.recordName);

    return this.diffExisting(base, existing, desiredValue);
  }

  private planReverseRecord(
    desired: DesiredDhcpRecord,
    existingZoneNames: Map<string, string>,
    recordsByZone: Map<string, TechnitiumZoneRecord[]>,
  ): DhcpDnsSyncPlannedRecord {
    const reverse = computeReverseZoneAndRecordName(desired.ip);
    if ("error" in reverse) {
      return {
        ...this.basePlannedRecord(desired, "reverse", "@"),
        status: "skipped",
        zoneName: desired.forwardZoneName,
        recordName: "@",
        recordType: "PTR",
        desiredValue: desired.hostnameFqdn,
        message: reverse.error,
      };
    }

    const reverseZoneName = existingZoneNames.get(
      reverse.zoneName.toLowerCase(),
    );
    const base: DhcpDnsSyncPlannedRecord = {
      ...this.basePlannedRecord(desired, "reverse", reverse.recordName),
      zoneName: reverseZoneName ?? reverse.zoneName,
      recordName: reverse.recordName,
      recordType: "PTR",
      desiredValue: desired.hostnameFqdn,
    };

    if (!reverseZoneName) {
      return {
        ...base,
        status: "missing-zone",
        message: `Reverse zone "${reverse.zoneName}" does not exist on the primary node.`,
      };
    }

    const existing = this.findExistingRecords(
      recordsByZone.get(reverseZoneName.toLowerCase()) ?? [],
      reverseZoneName,
      reverse.recordName,
      "PTR",
    );

    return this.diffExisting(base, existing, desired.hostnameFqdn);
  }

  private planStaleDeletes(args: {
    sourceScopes: DhcpDnsSyncSourceScope[];
    includeReverse: boolean;
    existingZoneNames: Map<string, string>;
    recordsByZone: Map<string, TechnitiumZoneRecord[]>;
    desiredForwardKeys: Set<string>;
    desiredReverseKeys: Set<string>;
    staleGraceSeconds: number;
  }): DhcpDnsSyncPlannedRecord[] {
    const deletions: DhcpDnsSyncPlannedRecord[] = [];
    const seenDeleteKeys = new Set<string>();

    for (const sourceScope of args.sourceScopes) {
      const seenLeases = this.stateService.listSeenLeases(
        sourceScope.nodeId,
        sourceScope.scopeName,
      );
      for (const seen of seenLeases) {
        if (!this.isStale(seen.lastSeenAt, args.staleGraceSeconds)) {
          continue;
        }

        const recordType = isIP(seen.ip) === 6 ? "AAAA" : "A";
        const forwardRecordName = this.hostnameToRecordName(
          seen.hostname,
          seen.forwardZoneName,
        );
        const forwardKey = this.recordKey(
          seen.forwardZoneName,
          forwardRecordName,
          recordType,
        );
        if (!args.desiredForwardKeys.has(forwardKey)) {
          const existing = this.findExistingRecords(
            args.recordsByZone.get(seen.forwardZoneName.toLowerCase()) ?? [],
            seen.forwardZoneName,
            forwardRecordName,
            recordType,
          ).filter(
            (record) =>
              record.managed?.sourceNodeId === sourceScope.nodeId &&
              record.managed?.scopeName === sourceScope.scopeName &&
              record.managed?.ip === seen.ip,
          );

          if (existing.length === 1) {
            const deleteKey = `${forwardKey}|${seen.ip}`;
            if (!seenDeleteKeys.has(deleteKey)) {
              seenDeleteKeys.add(deleteKey);
              deletions.push({
                kind: "forward",
                status: "delete-record",
                sourceNodeId: sourceScope.nodeId,
                scopeName: sourceScope.scopeName,
                hostname: seen.hostname,
                ip: seen.ip,
                hardwareAddress: seen.hardwareAddress,
                zoneName: seen.forwardZoneName,
                recordName: forwardRecordName,
                recordType,
                currentValue: existing[0].value,
                message: "Previously managed DHCP lease is stale.",
              });
            }
          }
        }

        if (!args.includeReverse) {
          continue;
        }

        const reverse = computeReverseZoneAndRecordName(seen.ip);
        if ("error" in reverse) {
          continue;
        }
        const reverseZoneName = args.existingZoneNames.get(
          reverse.zoneName.toLowerCase(),
        );
        if (!reverseZoneName) {
          continue;
        }

        const reverseKey = this.recordKey(
          reverseZoneName,
          reverse.recordName,
          "PTR",
        );
        if (args.desiredReverseKeys.has(reverseKey)) {
          continue;
        }

        const existing = this.findExistingRecords(
          args.recordsByZone.get(reverseZoneName.toLowerCase()) ?? [],
          reverseZoneName,
          reverse.recordName,
          "PTR",
        ).filter(
          (record) =>
            record.managed?.sourceNodeId === sourceScope.nodeId &&
            record.managed?.scopeName === sourceScope.scopeName &&
            record.managed?.ip === seen.ip,
        );

        if (existing.length === 1) {
          const deleteKey = `${reverseKey}|${seen.ip}`;
          if (!seenDeleteKeys.has(deleteKey)) {
            seenDeleteKeys.add(deleteKey);
            deletions.push({
              kind: "reverse",
              status: "delete-record",
              sourceNodeId: sourceScope.nodeId,
              scopeName: sourceScope.scopeName,
              hostname: seen.hostname,
              ip: seen.ip,
              hardwareAddress: seen.hardwareAddress,
              zoneName: reverseZoneName,
              recordName: reverse.recordName,
              recordType: "PTR",
              currentValue: existing[0].value,
              message: "Previously managed DHCP lease is stale.",
            });
          }
        }
      }
    }

    return deletions;
  }

  private diffExisting(
    base: DhcpDnsSyncPlannedRecord,
    existing: ExistingRecordValue[],
    desiredValue: string,
  ): DhcpDnsSyncPlannedRecord {
    const normalizedDesired =
      base.recordType === "PTR"
        ? this.normalizeHostname(desiredValue)
        : desiredValue.toLowerCase();

    if (existing.length === 0) {
      return { ...base, status: "create-record", desiredValue };
    }

    if (existing.length > 1) {
      return {
        ...base,
        status: "conflict",
        currentValue: existing.map((record) => record.value ?? "?").join(", "),
        desiredValue,
        message: "Multiple existing records share this owner and type.",
      };
    }

    const current = existing[0];
    const normalizedCurrent =
      base.recordType === "PTR"
        ? this.normalizeHostname(current.value ?? "")
        : (current.value ?? "").toLowerCase();

    if (normalizedCurrent === normalizedDesired) {
      return {
        ...base,
        status: "already-correct",
        currentValue: current.value,
        desiredValue,
      };
    }

    const managedForThisLease =
      current.managed?.sourceNodeId === base.sourceNodeId &&
      current.managed?.scopeName === base.scopeName &&
      current.managed?.ip === base.ip;

    if (!managedForThisLease) {
      return {
        ...base,
        status: "conflict",
        currentValue: current.value,
        desiredValue,
        message:
          "Existing record is not managed by DHCP DNS sync for this lease.",
      };
    }

    return {
      ...base,
      status: "update-record",
      currentValue: current.value,
      desiredValue,
    };
  }

  private async applyRecord(
    targetNodeId: string,
    ttl: number,
    record: DhcpDnsSyncPlannedRecord,
  ): Promise<DhcpDnsSyncAction> {
    try {
      if (record.status === "delete-record") {
        await this.deleteRecord(targetNodeId, record);
      } else if (record.status === "create-record") {
        await this.createRecord(targetNodeId, ttl, record);
      } else {
        await this.updateRecord(targetNodeId, ttl, record);
      }

      return {
        kind: record.kind,
        status: record.status,
        ok: true,
        zoneName: record.zoneName,
        recordName: record.recordName,
        recordType: record.recordType,
        currentValue: record.currentValue,
        desiredValue: record.desiredValue,
        message: `${record.status.replace("-record", "")}d record.`,
      };
    } catch (error) {
      return {
        kind: record.kind,
        status: record.status,
        ok: false,
        zoneName: record.zoneName,
        recordName: record.recordName,
        recordType: record.recordType,
        currentValue: record.currentValue,
        desiredValue: record.desiredValue,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async createRecord(
    targetNodeId: string,
    ttl: number,
    record: DhcpDnsSyncPlannedRecord,
  ): Promise<void> {
    const params = this.buildRecordParams(record, ttl);
    await this.technitiumService.executeAction(targetNodeId, {
      method: "GET",
      url: "/api/zones/records/add",
      params,
    });
  }

  private async updateRecord(
    targetNodeId: string,
    ttl: number,
    record: DhcpDnsSyncPlannedRecord,
  ): Promise<void> {
    const params = this.buildRecordParams(record, ttl);
    const currentValue = this.stripTrailingDot(record.currentValue ?? "");
    const desiredValue = this.stripTrailingDot(record.desiredValue ?? "");

    await this.technitiumService.executeAction(targetNodeId, {
      method: "GET",
      url: "/api/zones/records/update",
      params: {
        ...params,
        ...(record.recordType === "PTR"
          ? { ptrName: currentValue, newPtrName: desiredValue }
          : { ipAddress: currentValue, newIpAddress: desiredValue }),
      },
    });
  }

  private async deleteRecord(
    targetNodeId: string,
    record: DhcpDnsSyncPlannedRecord,
  ): Promise<void> {
    await this.technitiumService.executeAction(targetNodeId, {
      method: "GET",
      url: "/api/zones/records/delete",
      params: {
        domain: this.recordOwnerFqdn(record),
        zone: record.zoneName,
        type: record.recordType,
        ...(record.recordType === "PTR"
          ? { ptrName: this.stripTrailingDot(record.currentValue ?? "") }
          : { ipAddress: record.currentValue ?? record.ip ?? "" }),
      },
    });
  }

  private buildRecordParams(
    record: DhcpDnsSyncPlannedRecord,
    ttl: number,
  ): Record<string, string | number> {
    const desiredValue = this.stripTrailingDot(record.desiredValue ?? "");
    return {
      domain: this.recordOwnerFqdn(record),
      zone: record.zoneName,
      type: record.recordType,
      ttl,
      comments: this.buildManagedComment(record),
      ...(record.recordType === "PTR"
        ? { ptrName: desiredValue }
        : { ipAddress: desiredValue }),
    };
  }

  private buildManagedComment(record: DhcpDnsSyncPlannedRecord): string {
    const parts = [
      MANAGED_COMMENT_PREFIX,
      `sourceNode=${record.sourceNodeId}`,
      `scope=${record.scopeName}`,
    ];
    if (record.ip) parts.push(`ip=${record.ip}`);
    if (record.hostname) parts.push(`host=${record.hostname}`);
    if (record.hardwareAddress) parts.push(`mac=${record.hardwareAddress}`);
    return parts.join("; ");
  }

  private parseManagedComment(
    comments: string | undefined,
  ): ManagedRecordComment | undefined {
    const raw = (comments ?? "").trim();
    if (!raw) {
      return undefined;
    }

    const parts = raw.split(";").map((part) => part.trim());
    if (parts[0]?.toLowerCase() !== MANAGED_COMMENT_PREFIX.toLowerCase()) {
      return undefined;
    }

    const parsed: ManagedRecordComment = {};
    for (const part of parts.slice(1)) {
      const [keyRaw, ...valueParts] = part.split("=");
      const key = (keyRaw ?? "").trim().toLowerCase();
      const value = valueParts.join("=").trim();
      if (!key || !value) {
        continue;
      }
      if (key === "sourcenode") parsed.sourceNodeId = value;
      if (key === "scope") parsed.scopeName = value;
      if (key === "ip") parsed.ip = value;
      if (key === "host") parsed.hostname = value;
      if (key === "mac") parsed.mac = value;
    }

    return parsed;
  }

  private async fetchRecordsByZone(
    targetNodeId: string,
    zoneNames: string[],
  ): Promise<Map<string, TechnitiumZoneRecord[]>> {
    const results = new Map<string, TechnitiumZoneRecord[]>();
    for (const zoneName of zoneNames) {
      try {
        const envelope = await this.technitiumService.getZoneRecords(
          targetNodeId,
          zoneName,
        );
        results.set(zoneName.toLowerCase(), envelope.data.records ?? []);
      } catch (error) {
        this.logger.warn(
          `Failed to load DNS records for "${zoneName}" on "${targetNodeId}": ${error instanceof Error ? error.message : String(error)}`,
        );
        results.set(zoneName.toLowerCase(), []);
      }
    }
    return results;
  }

  private findExistingRecords(
    records: TechnitiumZoneRecord[],
    zoneName: string,
    recordName: string,
    recordType: "A" | "AAAA" | "PTR",
  ): ExistingRecordValue[] {
    return records
      .filter((record) => (record.type ?? "").toUpperCase() === recordType)
      .filter(
        (record) =>
          this.toRelativeOwnerName(record.name, zoneName).toLowerCase() ===
          recordName.toLowerCase(),
      )
      .map((record) => ({
        value:
          recordType === "PTR"
            ? this.extractPtrTarget(record)
            : this.extractAddressTarget(record),
        comments: record.comments,
        managed: this.parseManagedComment(record.comments),
      }));
  }

  private extractAddressTarget(
    record: TechnitiumZoneRecord,
  ): string | undefined {
    const payload = record.rData;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }

    const candidates = [
      payload.ipAddress,
      payload.IPAddress,
      payload.address,
      payload.Address,
      payload.ip,
      payload.IP,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return undefined;
  }

  private extractPtrTarget(record: TechnitiumZoneRecord): string | undefined {
    const payload = record.rData;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }

    const candidates = [
      payload.ptrDomainName,
      payload.PtrDomainName,
      payload.ptrName,
      payload.PtrName,
      payload.domain,
      payload.Domain,
      payload.domainName,
      payload.DomainName,
      payload.name,
      payload.Name,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return this.normalizeHostname(candidate.trim());
      }
    }
    return undefined;
  }

  private leaseToDesiredRecord(
    sourceScope: DhcpDnsSyncSourceScope,
    scope: TechnitiumDhcpScope,
    lease: TechnitiumDhcpLease,
    forwardZoneName: string,
  ): DesiredDhcpRecord | undefined {
    const ip = (lease.address ?? "").trim();
    const hostname = this.normalizeLeaseHostname(lease.hostName);
    const ipVersion = isIP(ip);
    if (
      !hostname ||
      (ipVersion !== 4 && ipVersion !== 6) ||
      this.isExpiredDynamicLease(lease)
    ) {
      return undefined;
    }

    const recordName = this.hostnameToRecordName(hostname, forwardZoneName);
    if (!recordName) {
      return undefined;
    }

    return {
      sourceNodeId: sourceScope.nodeId,
      scopeName: sourceScope.scopeName,
      hostname,
      hostnameFqdn: this.normalizeHostname(toFqdn(recordName, forwardZoneName)),
      ip,
      hardwareAddress: (lease.hardwareAddress ?? "").trim() || undefined,
      forwardZoneName,
      recordName,
      recordType: ipVersion === 6 ? "AAAA" : "A",
    };
  }

  private basePlannedRecord(
    desired: DesiredDhcpRecord,
    kind: "forward" | "reverse",
    recordName: string,
  ): DhcpDnsSyncPlannedRecord {
    return {
      kind,
      status: "skipped",
      sourceNodeId: desired.sourceNodeId,
      scopeName: desired.scopeName,
      hostname: desired.hostname,
      ip: desired.ip,
      hardwareAddress: desired.hardwareAddress,
      zoneName: desired.forwardZoneName,
      recordName,
      recordType: desired.recordType,
      desiredValue: desired.ip,
    };
  }

  private async loadSourceScope(
    sourceScope: DhcpDnsSyncSourceScope,
  ): Promise<{ scope?: TechnitiumDhcpScope; error?: string }> {
    try {
      const envelope = await this.technitiumService.getDhcpScope(
        sourceScope.nodeId,
        sourceScope.scopeName,
      );
      return { scope: envelope.data };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadSourceLeases(
    nodeId: string,
  ): Promise<{ leases?: TechnitiumDhcpLease[]; error?: string }> {
    try {
      const envelope = await this.technitiumService.listDhcpLeases(nodeId);
      return { leases: envelope.data.leases ?? [] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async selectTargetPrimaryNodeId(): Promise<string> {
    const nodes = await this.technitiumService.listNodes();
    const primary = nodes.find((node) => node.isPrimary);
    const selected = primary ?? nodes[0];
    if (!selected) {
      throw new BadRequestException("No Technitium nodes are configured.");
    }
    return selected.id;
  }

  private normalizeRequest(request: DhcpDnsSyncPreviewRequest): {
    sourceScopes: DhcpDnsSyncSourceScope[];
    forwardZoneName?: string;
    includeReverse: boolean;
    ttl: number;
    staleGraceSeconds: number;
  } {
    const sourceScopes = (request.sourceScopes ?? [])
      .map((scope) => ({
        nodeId: (scope.nodeId ?? "").trim(),
        scopeName: this.normalizeScopeName(scope.scopeName),
      }))
      .filter((scope) => scope.nodeId && scope.scopeName);

    if (sourceScopes.length === 0) {
      throw new BadRequestException("At least one source scope is required.");
    }

    const uniqueScopes = new Map<string, DhcpDnsSyncSourceScope>();
    for (const scope of sourceScopes) {
      uniqueScopes.set(
        `${scope.nodeId.toLowerCase()}|${scope.scopeName.toLowerCase()}`,
        scope,
      );
    }

    const ttl =
      typeof request.ttl === "number" && request.ttl > 0
        ? Math.floor(request.ttl)
        : DEFAULT_TTL;

    const staleGraceSeconds =
      typeof request.staleGraceSeconds === "number" &&
      request.staleGraceSeconds >= 0
        ? Math.floor(request.staleGraceSeconds)
        : DEFAULT_STALE_GRACE_SECONDS;

    return {
      sourceScopes: Array.from(uniqueScopes.values()),
      forwardZoneName: this.normalizeZoneName(request.forwardZoneName),
      includeReverse:
        request.includeReverse ?? this.getDefaults().includeReverse,
      ttl,
      staleGraceSeconds,
    };
  }

  private summarize(
    plannedRecords: DhcpDnsSyncPlannedRecord[],
    scopeIssues: DhcpDnsSyncScopeIssue[],
  ): DhcpDnsSyncSummary {
    return plannedRecords.reduce(
      (acc, record) => {
        if (record.status === "create-record") acc.createRecords += 1;
        if (record.status === "update-record") acc.updateRecords += 1;
        if (record.status === "delete-record") acc.deleteRecords += 1;
        if (record.status === "already-correct") acc.alreadyCorrect += 1;
        if (record.status === "conflict") acc.conflicts += 1;
        if (record.status === "missing-zone") acc.missingZones += 1;
        if (record.status === "skipped") acc.skipped += 1;
        return acc;
      },
      {
        createRecords: 0,
        updateRecords: 0,
        deleteRecords: 0,
        alreadyCorrect: 0,
        conflicts: 0,
        missingZones: 0,
        skipped: 0,
        errors: scopeIssues.filter((issue) => issue.severity === "error")
          .length,
      },
    );
  }

  private toNoopAction(record: DhcpDnsSyncPlannedRecord): DhcpDnsSyncAction {
    return {
      kind: record.kind,
      status: record.status,
      ok: true,
      zoneName: record.zoneName,
      recordName: record.recordName,
      recordType: record.recordType,
      currentValue: record.currentValue,
      desiredValue: record.desiredValue,
      message: record.message ?? "No change.",
    };
  }

  private recordOwnerFqdn(record: DhcpDnsSyncPlannedRecord): string {
    return this.stripTrailingDot(toFqdn(record.recordName, record.zoneName));
  }

  private recordKey(
    zoneName: string,
    recordName: string,
    recordType: string,
  ): string {
    return `${zoneName.toLowerCase()}|${recordName.toLowerCase()}|${recordType.toUpperCase()}`;
  }

  private hostnameToRecordName(hostname: string, zoneName: string): string {
    const normalizedHostname = hostname.trim().replace(/\.$/, "");
    const normalizedZone = zoneName.trim().replace(/\.$/, "");
    if (!normalizedHostname || !normalizedZone) {
      return "";
    }

    if (normalizedHostname.toLowerCase() === normalizedZone.toLowerCase()) {
      return "@";
    }

    const suffix = `.${normalizedZone}`.toLowerCase();
    if (normalizedHostname.toLowerCase().endsWith(suffix)) {
      const value = normalizedHostname.slice(0, -suffix.length);
      return value || "@";
    }

    return normalizedHostname;
  }

  private toRelativeOwnerName(recordName: string, zoneName: string): string {
    const trimmed = (recordName ?? "").trim();
    const zoneTrimmed = (zoneName ?? "").trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed === "@") {
      return "@";
    }

    const normalizedZone = zoneTrimmed.replace(/\.$/, "");
    const normalizedName = trimmed.replace(/\.$/, "");
    if (normalizedName.toLowerCase() === normalizedZone.toLowerCase()) {
      return "@";
    }

    const suffix = `.${normalizedZone}`.toLowerCase();
    if (normalizedName.toLowerCase().endsWith(suffix)) {
      const value = normalizedName.slice(0, -suffix.length);
      return value || "@";
    }

    return normalizedName;
  }

  private isStale(lastSeenAt: string, staleGraceSeconds: number): boolean {
    const lastSeenMs = Date.parse(lastSeenAt);
    if (Number.isNaN(lastSeenMs)) {
      return false;
    }
    return Date.now() - lastSeenMs >= staleGraceSeconds * 1000;
  }

  private isExpiredDynamicLease(lease: TechnitiumDhcpLease): boolean {
    if ((lease.type ?? "").trim().toLowerCase() === "reserved") {
      return false;
    }

    const expiresAtMs = Date.parse(lease.leaseExpires ?? "");
    return !Number.isNaN(expiresAtMs) && expiresAtMs <= Date.now();
  }

  private normalizeScopeName(value: string | undefined): string {
    return (value ?? "").trim();
  }

  private normalizeZoneName(value: string | undefined): string | undefined {
    const normalized = (value ?? "").trim().replace(/\.$/, "");
    return normalized || undefined;
  }

  private normalizeLeaseHostname(value: string | null | undefined): string {
    return (value ?? "").trim().replace(/\.$/, "");
  }

  private normalizeHostname(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  }

  private stripTrailingDot(value: string): string {
    return value.trim().replace(/\.$/, "");
  }
}
