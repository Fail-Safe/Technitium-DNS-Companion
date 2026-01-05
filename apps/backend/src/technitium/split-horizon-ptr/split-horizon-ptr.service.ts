import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { TechnitiumService } from "../technitium.service";
import type { TechnitiumZoneRecord } from "../technitium.types";
import type {
  SplitHorizonPtrApplyAction,
  SplitHorizonPtrApplyRequest,
  SplitHorizonPtrApplyResponse,
  SplitHorizonPtrCatalogZoneCandidate,
  SplitHorizonPtrConflictPolicy,
  SplitHorizonPtrPlannedRecord,
  SplitHorizonPtrPlannedZone,
  SplitHorizonPtrPreviewRequest,
  SplitHorizonPtrPreviewResponse,
  SplitHorizonPtrSourceZonesResponse,
  SplitHorizonSimpleAddressSourceRecord,
} from "./split-horizon-ptr.types";
import {
  computeReverseZoneAndRecordName,
  computeReverseZoneCidr,
  getDefaultIpv4ZonePrefixLength,
  getDefaultIpv6ZonePrefixLength,
  toFqdn,
} from "./split-horizon-ptr.util";

const SPLIT_HORIZON_APP_NAME = "Split Horizon";
const SIMPLE_ADDRESS_CLASS_PATH = "SplitHorizon.SimpleAddress";

@Injectable()
export class SplitHorizonPtrService {
  private readonly logger = new Logger(SplitHorizonPtrService.name);

  private sourceZonesCache?: {
    expiresAtMs: number;
    value: SplitHorizonPtrSourceZonesResponse;
  };

  private sourceZonesInFlight?: Promise<SplitHorizonPtrSourceZonesResponse>;

  constructor(private readonly technitiumService: TechnitiumService) {}

  async listSourceZones(options?: {
    forceRefresh?: boolean;
  }): Promise<SplitHorizonPtrSourceZonesResponse> {
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();

    if (!forceRefresh && this.sourceZonesCache) {
      if (now < this.sourceZonesCache.expiresAtMs) {
        return this.sourceZonesCache.value;
      }
    }

    if (!forceRefresh && this.sourceZonesInFlight) {
      return await this.sourceZonesInFlight;
    }

    const work = (async (): Promise<SplitHorizonPtrSourceZonesResponse> => {
      const nodeId = await this.selectPrimaryNodeId();

      const apps = await this.technitiumService.getNodeApps(nodeId);
      const splitHorizonInstalled = apps.apps.some(
        (app) =>
          (app.name ?? "").toLowerCase() ===
          SPLIT_HORIZON_APP_NAME.toLowerCase(),
      );

      if (!splitHorizonInstalled) {
        return {
          fetchedAt: new Date().toISOString(),
          nodeId,
          splitHorizonInstalled: false,
          zones: [],
          warnings: [
            `Split Horizon app not detected on node "${nodeId}" (apps/list did not include "${SPLIT_HORIZON_APP_NAME}").`,
          ],
        };
      }

      const zonesEnvelope = await this.technitiumService.listZones(nodeId);
      const zones = (zonesEnvelope.data.zones ?? [])
        .map((zone) => (zone.name ?? "").trim())
        .filter(Boolean);

      const warnings: string[] = [];
      const candidates: Array<{ zoneName: string; recordCount: number }> = [];

      // Keep Technitium API load reasonable even if there are many zones.
      const concurrency = 4;
      let cursor = 0;

      const worker = async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= zones.length) {
            return;
          }

          const zoneName = zones[index];
          try {
            const envelope = await this.technitiumService.getZoneRecords(
              nodeId,
              zoneName,
            );
            const records = envelope.data.records ?? [];

            let recordCount = 0;
            for (const record of records) {
              if (this.isSimpleAddressAppRecord(record)) {
                recordCount += 1;
              }
            }

            if (recordCount > 0) {
              candidates.push({ zoneName, recordCount });
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            warnings.push(`Failed to scan zone "${zoneName}": ${message}`);
          }
        }
      };

      const workerCount = Math.min(concurrency, zones.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      candidates.sort((a, b) => a.zoneName.localeCompare(b.zoneName));

      return {
        fetchedAt: new Date().toISOString(),
        nodeId,
        splitHorizonInstalled: true,
        zones: candidates,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    })();

    this.sourceZonesInFlight = work;

    try {
      const value = await work;
      this.sourceZonesCache = { expiresAtMs: Date.now() + 60_000, value };
      return value;
    } finally {
      this.sourceZonesInFlight = undefined;
    }
  }

  async apply(
    request: SplitHorizonPtrApplyRequest,
  ): Promise<SplitHorizonPtrApplyResponse> {
    const zoneName = (request.zoneName ?? "").trim();
    if (!zoneName) {
      throw new BadRequestException("zoneName is required");
    }

    const conflictPolicy: SplitHorizonPtrConflictPolicy =
      request.conflictPolicy ?? "skip";
    const dryRun = request.dryRun === true;
    const catalogZoneName = (request.catalogZoneName ?? "").trim();

    const sourceHostnameResolutionByIp = new Map<string, string>();
    const rawResolutions = request.sourceHostnameResolutions ?? [];
    for (const resolution of rawResolutions) {
      const ip = (resolution?.ip ?? "").trim();
      const hostname = (resolution?.hostname ?? "").trim();
      if (!ip || !hostname) {
        continue;
      }

      if (sourceHostnameResolutionByIp.has(ip)) {
        throw new BadRequestException(
          `Duplicate sourceHostnameResolutions entry for IP "${ip}".`,
        );
      }

      sourceHostnameResolutionByIp.set(ip, hostname);
    }

    const preview = await this.preview({
      zoneName,
      ipv4ZonePrefixLength: request.ipv4ZonePrefixLength,
      ipv6ZonePrefixLength: request.ipv6ZonePrefixLength,
    });

    // Validate that provided resolutions match preview conflicts (and are among the advertised candidates).
    if (sourceHostnameResolutionByIp.size > 0) {
      for (const [ip, hostname] of sourceHostnameResolutionByIp.entries()) {
        const planned = preview.plannedRecords.find((r) => r.ip === ip);
        if (!planned || planned.status !== "conflict") {
          throw new BadRequestException(
            `sourceHostnameResolutions includes IP "${ip}", but preview did not report it as a conflict. Re-run Preview and try again.`,
          );
        }

        if (planned.conflictReason !== "multiple-source-hostnames") {
          throw new BadRequestException(
            `sourceHostnameResolutions currently supports only "multiple-source-hostnames" conflicts. IP "${ip}" is "${planned.conflictReason ?? "unknown"}".`,
          );
        }

        const candidates = planned.conflictTargets ?? [];
        const normalizedChosen = this.normalizeHostname(hostname);
        const matchesCandidate = candidates.some(
          (candidate) =>
            this.normalizeHostname(candidate).toLowerCase() ===
            normalizedChosen.toLowerCase(),
        );

        if (!matchesCandidate) {
          throw new BadRequestException(
            `Chosen hostname "${hostname}" for IP "${ip}" is not one of the preview candidates: ${candidates.join(", ") || "(none)"}.`,
          );
        }
      }
    }

    if (catalogZoneName) {
      const found = (preview.catalogZones ?? []).some(
        (z) =>
          z.name.toLowerCase() === catalogZoneName.toLowerCase() &&
          z.type === "Catalog",
      );
      if (!found) {
        const available = (preview.catalogZones ?? [])
          .filter((z) => z.type === "Catalog")
          .map((z) => z.name);
        throw new BadRequestException(
          `catalogZoneName "${catalogZoneName}" was not found as a Catalog zone on node "${preview.nodeId}". Available: ${available.length > 0 ? available.join(", ") : "(none)"}`,
        );
      }
    }

    if (!preview.splitHorizonInstalled) {
      return {
        fetchedAt: new Date().toISOString(),
        nodeId: preview.nodeId,
        zoneName,
        splitHorizonInstalled: false,
        dryRun,
        conflictPolicy,
        actions: [],
        summary: {
          createdZones: 0,
          createdRecords: 0,
          updatedRecords: 0,
          skippedConflicts: 0,
          noops: 0,
          errors: 0,
        },
        warnings: preview.warnings,
      };
    }

    const nodeId = preview.nodeId;

    // If caller wants strict behavior, bail on any *unresolved* conflicts.
    if (conflictPolicy === "fail") {
      const unresolvedConflicts = preview.plannedRecords.filter((r) => {
        if (r.status !== "conflict") return false;
        if (r.conflictReason === "multiple-source-hostnames") {
          return !sourceHostnameResolutionByIp.has(r.ip);
        }
        return true;
      });

      if (unresolvedConflicts.length > 0) {
        const examples = unresolvedConflicts
          .slice(0, 5)
          .map((c) => `${c.ip} -> ${c.ptrRecordName}.${c.ptrZoneName}`);
        throw new BadRequestException(
          `Unresolved conflicts detected (${unresolvedConflicts.length}). Example(s): ${examples.join(", ")}`,
        );
      }
    }

    const actions: SplitHorizonPtrApplyAction[] = [];
    const warnings: string[] = [...(preview.warnings ?? [])];

    const hasMutations =
      preview.plannedZones.some((z) => z.status === "create-zone") ||
      preview.plannedRecords.some(
        (r) => r.status === "create-record" || r.status === "update-record",
      );

    if (!dryRun && hasMutations) {
      const zoneNames = Array.from(
        new Set(
          preview.plannedZones
            .map((z) => (z.zoneName ?? "").trim())
            .filter(Boolean),
        ),
      );

      try {
        await this.technitiumService.createZoneSnapshot(
          nodeId,
          zoneNames,
          "automatic",
          `Automatic snapshot before PTR Sync apply (source zone: ${zoneName})`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create automatic zone snapshot before apply for node ${nodeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        warnings.push(
          "Warning: failed to create an automatic DNS zone snapshot before applying changes.",
        );
      }
    }

    // Compute the CIDR to use when creating each missing PTR zone.
    const zonesToCreateLower = new Set(
      preview.plannedZones
        .filter((z) => z.status === "create-zone")
        .map((z) => z.zoneName.toLowerCase()),
    );

    const zoneCreateCidrByLower = new Map<string, string>();
    for (const record of preview.plannedRecords) {
      const zoneKey = record.ptrZoneName.toLowerCase();
      if (
        !zonesToCreateLower.has(zoneKey) ||
        zoneCreateCidrByLower.has(zoneKey)
      ) {
        continue;
      }

      const cidrResult = computeReverseZoneCidr(record.ip, {
        ipv4ZonePrefixLength: preview.ipv4ZonePrefixLength,
        ipv6ZonePrefixLength: preview.ipv6ZonePrefixLength,
      });
      if ("error" in cidrResult) {
        warnings.push(
          `Failed to compute CIDR for missing PTR zone "${record.ptrZoneName}" from IP "${record.ip}": ${cidrResult.error}`,
        );
        continue;
      }

      zoneCreateCidrByLower.set(zoneKey, cidrResult.cidr);
    }

    // 1) Create missing PTR zones.
    for (const plannedZone of preview.plannedZones.filter(
      (z) => z.status === "create-zone",
    )) {
      const zoneKey = plannedZone.zoneName.toLowerCase();
      const cidr = zoneCreateCidrByLower.get(zoneKey);
      if (!cidr) {
        actions.push({
          kind: "create-zone",
          ok: false,
          ptrZoneName: plannedZone.zoneName,
          message:
            "Missing CIDR for reverse zone creation (no usable IP found).",
        });
        continue;
      }

      if (dryRun) {
        actions.push({
          kind: "create-zone",
          ok: true,
          ptrZoneName: plannedZone.zoneName,
          message: `Dry run: would create zone from ${cidr}${catalogZoneName ? ` (catalog member: ${catalogZoneName})` : ""}`,
        });
        continue;
      }

      try {
        await this.technitiumService.executeAction(nodeId, {
          method: "GET",
          url: "/api/zones/create",
          params: {
            zone: cidr,
            type: "Primary",
            ...(catalogZoneName ? { catalog: catalogZoneName } : {}),
          },
        });

        actions.push({
          kind: "create-zone",
          ok: true,
          ptrZoneName: plannedZone.zoneName,
          message: `Created reverse zone from ${cidr}${catalogZoneName ? ` (catalog member: ${catalogZoneName})` : ""}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.push({
          kind: "create-zone",
          ok: false,
          ptrZoneName: plannedZone.zoneName,
          message,
        });
      }
    }

    // 2) Load (or reload) PTR zone records so we can do safe, idempotent upserts.
    // Note: Technitium's PTR record payload field names can vary by version/config.
    // If we can't extract the current target, we still track the owner so we don't
    // accidentally treat it as missing and create a duplicate.
    type ExistingPtr = { raw?: string; normalized?: string };
    const existingByZoneLower = new Map<string, Map<string, ExistingPtr[]>>();

    const affectedZones = Array.from(
      new Set(preview.plannedRecords.map((r) => r.ptrZoneName.toLowerCase())),
    );

    for (const zoneLower of affectedZones) {
      const zoneNameForFetch =
        preview.plannedZones.find((z) => z.zoneName.toLowerCase() === zoneLower)
          ?.zoneName ??
        preview.plannedRecords.find(
          (r) => r.ptrZoneName.toLowerCase() === zoneLower,
        )?.ptrZoneName;

      if (!zoneNameForFetch) continue;

      try {
        const envelope = await this.technitiumService.getZoneRecords(
          nodeId,
          zoneNameForFetch,
        );
        const zoneRecords = envelope.data.records ?? [];
        const owners = new Map<string, ExistingPtr[]>();

        for (const rec of zoneRecords) {
          if ((rec.type ?? "").toUpperCase() !== "PTR") continue;
          const ownerRel = this.toRelativeOwnerName(
            rec.name,
            zoneNameForFetch,
          ).toLowerCase();
          if (!ownerRel) continue;
          const ptr = this.extractPtrTarget(rec);
          const entry: ExistingPtr =
            ptr ? { raw: ptr, normalized: this.normalizeHostname(ptr) } : {};
          if (!owners.has(ownerRel)) owners.set(ownerRel, []);
          owners.get(ownerRel)!.push(entry);
        }

        existingByZoneLower.set(zoneLower, owners);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Failed to load PTR records for zone "${zoneNameForFetch}" before apply: ${message}`,
        );
        existingByZoneLower.set(zoneLower, new Map());
      }
    }

    // 3) Apply record changes.
    for (const planned of preview.plannedRecords) {
      const resolvedTarget =
        (
          planned.status === "conflict" &&
          planned.conflictReason === "multiple-source-hostnames"
        ) ?
          sourceHostnameResolutionByIp.get(planned.ip)
        : undefined;

      const effectivePlanned: SplitHorizonPtrPlannedRecord =
        resolvedTarget ?
          {
            ...planned,
            status: "create-record",
            targetHostname: resolvedTarget,
            conflictTargets: undefined,
            conflictReason: undefined,
          }
        : planned;

      const ownerFqdn = toFqdn(
        effectivePlanned.ptrRecordName,
        effectivePlanned.ptrZoneName,
      );
      const normalizedTarget = this.normalizeHostname(
        effectivePlanned.targetHostname,
      );
      const zoneLower = planned.ptrZoneName.toLowerCase();
      const ownerLower = planned.ptrRecordName.toLowerCase();

      if (effectivePlanned.status === "conflict") {
        if (conflictPolicy === "fail") {
          throw new BadRequestException(
            `Conflict for IP "${planned.ip}" (${ownerFqdn}) with targets: ${(planned.conflictTargets ?? []).join(", ")}`,
          );
        }
        actions.push({
          kind: "skip-conflict",
          ok: true,
          ip: planned.ip,
          ptrZoneName: planned.ptrZoneName,
          ptrRecordFqdn: ownerFqdn,
          targetHostname: planned.targetHostname,
          message: "Skipped due to conflict.",
        });
        continue;
      }

      const existingForZone = existingByZoneLower.get(zoneLower) ?? new Map();
      const existingPtrs = existingForZone.get(ownerLower) ?? [];

      // If we already have the desired PTR and it's the only one, treat as noop.
      const hasDesired = existingPtrs.some(
        (p) =>
          typeof p.normalized === "string" &&
          p.normalized.toLowerCase() === normalizedTarget.toLowerCase(),
      );
      if (hasDesired && existingPtrs.length === 1) {
        actions.push({
          kind: "noop",
          ok: true,
          ip: planned.ip,
          ptrZoneName: planned.ptrZoneName,
          ptrRecordFqdn: ownerFqdn,
          targetHostname: planned.targetHostname,
          message: "Already correct.",
        });
        continue;
      }

      // Multiple existing PTR targets for one owner is a conflict.
      if (existingPtrs.length > 1) {
        if (conflictPolicy === "fail") {
          throw new BadRequestException(
            `Existing PTR conflict at ${ownerFqdn}: ${existingPtrs.map((p) => p.raw).join(", ")}`,
          );
        }
        actions.push({
          kind: "skip-conflict",
          ok: true,
          ip: planned.ip,
          ptrZoneName: planned.ptrZoneName,
          ptrRecordFqdn: ownerFqdn,
          targetHostname: planned.targetHostname,
          message: `Skipped due to existing conflicting PTRs: ${existingPtrs.map((p) => p.raw).join(", ")}`,
        });
        continue;
      }

      const shouldCreate = existingPtrs.length === 0;
      const shouldUpdate = existingPtrs.length === 1 && !hasDesired;

      if (dryRun) {
        actions.push({
          kind:
            shouldCreate ? "create-record"
            : shouldUpdate ? "update-record"
            : "noop",
          ok: true,
          ip: planned.ip,
          ptrZoneName: planned.ptrZoneName,
          ptrRecordFqdn: ownerFqdn,
          targetHostname: planned.targetHostname,
          message: `Dry run: would ${
            shouldCreate ? "create"
            : shouldUpdate ? "update"
            : "noop"
          }`,
        });
        continue;
      }

      if (shouldCreate) {
        try {
          const apiOwner = this.stripTrailingDot(ownerFqdn);
          const apiTarget = this.stripTrailingDot(normalizedTarget);
          await this.technitiumService.executeAction(nodeId, {
            method: "GET",
            url: "/api/zones/records/add",
            params: {
              domain: apiOwner,
              zone: effectivePlanned.ptrZoneName,
              type: "PTR",
              ptrName: apiTarget,
            },
          });

          actions.push({
            kind: "create-record",
            ok: true,
            ip: planned.ip,
            ptrZoneName: effectivePlanned.ptrZoneName,
            ptrRecordFqdn: ownerFqdn,
            targetHostname: normalizedTarget,
            message: "Created PTR record.",
          });

          // Update in-memory view.
          existingForZone.set(ownerLower, [
            { raw: normalizedTarget, normalized: normalizedTarget },
          ]);
          existingByZoneLower.set(zoneLower, existingForZone);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          actions.push({
            kind: "create-record",
            ok: false,
            ip: planned.ip,
            ptrZoneName: planned.ptrZoneName,
            ptrRecordFqdn: ownerFqdn,
            targetHostname: normalizedTarget,
            message,
          });
        }
        continue;
      }

      if (shouldUpdate) {
        const current = existingPtrs[0]!;

        if (!current.raw) {
          actions.push({
            kind: "update-record",
            ok: false,
            ip: planned.ip,
            ptrZoneName: planned.ptrZoneName,
            ptrRecordFqdn: ownerFqdn,
            targetHostname: normalizedTarget,
            message:
              "Cannot update PTR record: existing record target could not be extracted from Technitium response.",
          });
          continue;
        }

        try {
          const apiOwner = this.stripTrailingDot(ownerFqdn);
          const apiCurrent = this.stripTrailingDot(current.raw);
          const apiTarget = this.stripTrailingDot(normalizedTarget);
          await this.technitiumService.executeAction(nodeId, {
            method: "GET",
            url: "/api/zones/records/update",
            params: {
              domain: apiOwner,
              zone: effectivePlanned.ptrZoneName,
              type: "PTR",
              ptrName: apiCurrent,
              newPtrName: apiTarget,
            },
          });

          actions.push({
            kind: "update-record",
            ok: true,
            ip: planned.ip,
            ptrZoneName: planned.ptrZoneName,
            ptrRecordFqdn: ownerFqdn,
            currentTargetHostname: current.raw,
            targetHostname: normalizedTarget,
            message: `Updated PTR from ${current.raw} to ${normalizedTarget}`,
          });

          existingForZone.set(ownerLower, [
            { raw: normalizedTarget, normalized: normalizedTarget },
          ]);
          existingByZoneLower.set(zoneLower, existingForZone);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          actions.push({
            kind: "update-record",
            ok: false,
            ip: planned.ip,
            ptrZoneName: planned.ptrZoneName,
            ptrRecordFqdn: ownerFqdn,
            currentTargetHostname: current.raw,
            targetHostname: normalizedTarget,
            message,
          });
        }
      } else {
        actions.push({
          kind: "noop",
          ok: true,
          ip: planned.ip,
          ptrZoneName: planned.ptrZoneName,
          ptrRecordFqdn: ownerFqdn,
          currentTargetHostname: existingPtrs[0]?.raw,
          targetHostname: planned.targetHostname,
          message: "No change.",
        });
      }
    }

    const summary = actions.reduce(
      (acc, action) => {
        if (!action.ok) {
          acc.errors += 1;
          return acc;
        }
        switch (action.kind) {
          case "create-zone":
            acc.createdZones += 1;
            break;
          case "create-record":
            acc.createdRecords += 1;
            break;
          case "update-record":
            acc.updatedRecords += 1;
            break;
          case "skip-conflict":
            acc.skippedConflicts += 1;
            break;
          case "noop":
            acc.noops += 1;
            break;
        }
        return acc;
      },
      {
        createdZones: 0,
        createdRecords: 0,
        updatedRecords: 0,
        skippedConflicts: 0,
        noops: 0,
        errors: 0,
      },
    );

    return {
      fetchedAt: new Date().toISOString(),
      nodeId,
      zoneName,
      splitHorizonInstalled: true,
      dryRun,
      conflictPolicy,
      actions,
      summary,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async preview(
    request: SplitHorizonPtrPreviewRequest,
  ): Promise<SplitHorizonPtrPreviewResponse> {
    const zoneName = (request.zoneName ?? "").trim();
    if (!zoneName) {
      throw new BadRequestException("zoneName is required");
    }

    const ipv4ZonePrefixLength =
      request.ipv4ZonePrefixLength ?? getDefaultIpv4ZonePrefixLength();
    const ipv6ZonePrefixLength =
      request.ipv6ZonePrefixLength ?? getDefaultIpv6ZonePrefixLength();

    const nodeId = await this.selectPrimaryNodeId();

    // Check that Split Horizon is installed.
    const apps = await this.technitiumService.getNodeApps(nodeId);
    const splitHorizonInstalled = apps.apps.some(
      (app) =>
        (app.name ?? "").toLowerCase() === SPLIT_HORIZON_APP_NAME.toLowerCase(),
    );

    if (!splitHorizonInstalled) {
      return {
        fetchedAt: new Date().toISOString(),
        nodeId,
        zoneName,
        splitHorizonInstalled: false,
        ipv4ZonePrefixLength,
        ipv6ZonePrefixLength,
        sourceRecords: [],
        plannedZones: [],
        plannedRecords: [],
        warnings: [
          `Split Horizon app not detected on node \"${nodeId}\" (apps/list did not include \"${SPLIT_HORIZON_APP_NAME}\").`,
        ],
      };
    }

    const envelope = await this.technitiumService.getZoneRecords(
      nodeId,
      zoneName,
    );
    const records = envelope.data.records ?? [];

    const warnings: string[] = [];

    const sourceRecords: SplitHorizonSimpleAddressSourceRecord[] = [];
    const plannedRecords: SplitHorizonPtrPlannedRecord[] = [];

    // Map ip -> set(targetHostnames) to detect conflicts.
    const ipTargets = new Map<string, Set<string>>();
    const ipToPlanned = new Map<
      string,
      Omit<
        SplitHorizonPtrPlannedRecord,
        "status" | "conflictTargets" | "conflictReason"
      >
    >();

    const appRecords = records.filter((record) =>
      this.isSimpleAddressAppRecord(record),
    );

    for (const record of appRecords) {
      const parsed = this.extractSimpleAddressIps(record);
      const hostname = toFqdn(record.name, zoneName);

      sourceRecords.push({
        recordName: record.name,
        classPath: this.getClassPath(record),
        addresses: parsed.addresses,
        warnings: parsed.warnings,
      });

      for (const ip of parsed.addresses) {
        const reverse = computeReverseZoneAndRecordName(ip, {
          ipv4ZonePrefixLength,
          ipv6ZonePrefixLength,
        });

        if ("error" in reverse) {
          warnings.push(
            `Skipping IP \"${ip}\" from record \"${record.name}\": ${reverse.error}`,
          );
          continue;
        }

        if (!ipTargets.has(ip)) {
          ipTargets.set(ip, new Set());
        }
        ipTargets.get(ip)!.add(hostname);

        // Store first-seen planned mapping; conflicts handled later.
        if (!ipToPlanned.has(ip)) {
          ipToPlanned.set(ip, {
            ip,
            ptrZoneName: reverse.zoneName,
            ptrRecordName: reverse.recordName,
            targetHostname: hostname,
          });
        }
      }
    }

    // Build planned records with conflict detection.
    for (const [ip, base] of ipToPlanned.entries()) {
      const targets = Array.from(ipTargets.get(ip) ?? []);
      if (targets.length > 1) {
        plannedRecords.push({
          ...base,
          status: "conflict",
          conflictTargets: targets,
          conflictReason: "multiple-source-hostnames",
        });
      } else {
        plannedRecords.push({ ...base, status: "create-record" });
      }
    }

    // Determine which PTR zones already exist.
    const zonesEnvelope = await this.technitiumService.listZones(nodeId);
    const existingZones = new Set(
      (zonesEnvelope.data.zones ?? []).map((zone) =>
        (zone.name ?? "").toLowerCase(),
      ),
    );

    const catalogZones: SplitHorizonPtrCatalogZoneCandidate[] = (
      zonesEnvelope.data.zones ?? []
    )
      .filter((zone) => {
        const type = (zone.type ?? "").toString();
        return type === "Catalog" || type === "SecondaryCatalog";
      })
      .map((zone) => ({
        name: (zone.name ?? "").toString(),
        type: (zone.type ?? "Catalog") as "Catalog" | "SecondaryCatalog",
      }))
      .filter((z) => z.name.trim().length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const plannedZonesMap = new Map<string, SplitHorizonPtrPlannedZone>();
    for (const record of plannedRecords) {
      const key = record.ptrZoneName.toLowerCase();
      const existing = plannedZonesMap.get(key);
      if (existing) {
        existing.recordCount += 1;
        continue;
      }

      plannedZonesMap.set(key, {
        zoneName: record.ptrZoneName,
        status: existingZones.has(key) ? "zone-exists" : "create-zone",
        recordCount: 1,
      });
    }

    const plannedZones = Array.from(plannedZonesMap.values()).sort((a, b) =>
      a.zoneName.localeCompare(b.zoneName),
    );

    // Diff against existing PTR records (for zones that already exist).
    const ptrZoneRecordsByZoneLower = new Map<string, TechnitiumZoneRecord[]>();

    const zonesNeedingLookup = plannedZones
      .filter((z) => z.status === "zone-exists")
      .map((z) => z.zoneName);

    await Promise.all(
      zonesNeedingLookup.map(async (ptrZoneName) => {
        const key = ptrZoneName.toLowerCase();
        if (ptrZoneRecordsByZoneLower.has(key)) {
          return;
        }
        try {
          const ptrEnvelope = await this.technitiumService.getZoneRecords(
            nodeId,
            ptrZoneName,
          );
          ptrZoneRecordsByZoneLower.set(
            key,
            Array.isArray(ptrEnvelope.data.records) ?
              ptrEnvelope.data.records
            : [],
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          warnings.push(
            `Failed to load existing records for PTR zone \"${ptrZoneName}\" on node \"${nodeId}\": ${message}`,
          );
          ptrZoneRecordsByZoneLower.set(key, []);
        }
      }),
    );

    const plannedRecordsWithDiff: SplitHorizonPtrPlannedRecord[] =
      plannedRecords.map((record) => {
        // Conflicts from multiple hostnames are always surfaced as conflicts.
        if (record.status === "conflict") {
          return record;
        }

        const zoneKey = record.ptrZoneName.toLowerCase();
        const zoneRecords = ptrZoneRecordsByZoneLower.get(zoneKey);
        if (!zoneRecords) {
          // Zone doesn't exist (or wasn't in plannedZones), so it'll be created.
          return record;
        }

        const matchingPtrRecords = zoneRecords.filter((existing) => {
          if ((existing.type ?? "").toUpperCase() !== "PTR") {
            return false;
          }

          const relativeOwner = this.toRelativeOwnerName(
            existing.name,
            record.ptrZoneName,
          );
          return (
            relativeOwner.toLowerCase() === record.ptrRecordName.toLowerCase()
          );
        });

        if (matchingPtrRecords.length === 0) {
          return { ...record, status: "create-record" };
        }

        if (matchingPtrRecords.length > 1) {
          const existingTargets = matchingPtrRecords
            .map((existing) => this.extractPtrTarget(existing))
            .filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            )
            .map((value) => this.normalizeHostname(value));

          const conflictTargets = Array.from(
            new Set([
              ...existingTargets,
              this.normalizeHostname(record.targetHostname),
            ]),
          );

          return {
            ...record,
            status: "conflict",
            conflictTargets,
            conflictReason: "multiple-existing-ptr-targets",
          };
        }

        const existing = matchingPtrRecords[0]!;
        const existingTarget = this.extractPtrTarget(existing);

        if (!existingTarget) {
          return { ...record, status: "update-record" };
        }

        const normalizedExisting = this.normalizeHostname(existingTarget);
        const normalizedPlanned = this.normalizeHostname(record.targetHostname);

        if (
          normalizedExisting.toLowerCase() === normalizedPlanned.toLowerCase()
        ) {
          return { ...record, status: "already-correct" };
        }

        return { ...record, status: "update-record" };
      });

    return {
      fetchedAt: new Date().toISOString(),
      nodeId,
      zoneName,
      splitHorizonInstalled: true,
      ipv4ZonePrefixLength,
      ipv6ZonePrefixLength,
      catalogZones: catalogZones.length > 0 ? catalogZones : undefined,
      sourceRecords,
      plannedZones,
      plannedRecords: plannedRecordsWithDiff.sort((a, b) =>
        a.ip.localeCompare(b.ip),
      ),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
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
      const withoutSuffix = normalizedName.slice(0, -suffix.length);
      return withoutSuffix.length > 0 ? withoutSuffix : "@";
    }

    return normalizedName;
  }

  private extractPtrTarget(record: TechnitiumZoneRecord): string | undefined {
    const rData = record.rData;
    if (!rData || typeof rData !== "object" || Array.isArray(rData)) {
      return undefined;
    }

    const payload = rData as Record<string, unknown>;

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
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return undefined;
  }

  private normalizeHostname(hostname: string): string {
    const trimmed = (hostname ?? "").trim();
    if (!trimmed) {
      return trimmed;
    }
    return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  }

  private stripTrailingDot(value: string): string {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
      return trimmed;
    }
    return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  }

  private async selectPrimaryNodeId(): Promise<string> {
    const summaries = await this.technitiumService.listNodes();

    const clusterEnabled = summaries.some(
      (summary) => summary.clusterState?.initialized === true,
    );

    if (clusterEnabled) {
      const primary = summaries.find((summary) => summary.isPrimary);
      if (primary?.id) {
        return primary.id;
      }
      this.logger.warn(
        "Cluster appears enabled but no primary node was detected; falling back to first configured node.",
      );
    }

    const first = summaries[0];
    if (!first?.id) {
      throw new Error("No Technitium nodes configured.");
    }

    return first.id;
  }

  private isSimpleAddressAppRecord(record: TechnitiumZoneRecord): boolean {
    if ((record.type ?? "").toUpperCase() !== "APP") {
      return false;
    }

    const classPath = this.getClassPath(record);
    return (
      typeof classPath === "string" &&
      classPath.toLowerCase() === SIMPLE_ADDRESS_CLASS_PATH.toLowerCase()
    );
  }

  private getClassPath(record: TechnitiumZoneRecord): string | undefined {
    const rData = record.rData;
    if (!rData || typeof rData !== "object" || Array.isArray(rData)) {
      return undefined;
    }

    const raw =
      (rData as Record<string, unknown>).classPath ??
      (rData as Record<string, unknown>).ClassPath;

    return typeof raw === "string" ? raw : undefined;
  }

  private extractSimpleAddressIps(record: TechnitiumZoneRecord): {
    addresses: string[];
    warnings?: string[];
  } {
    const warnings: string[] = [];

    const rData = record.rData;
    if (!rData || typeof rData !== "object" || Array.isArray(rData)) {
      return {
        addresses: [],
        warnings: ["APP record rData was not an object."],
      };
    }

    const payload = rData as Record<string, unknown>;

    // Technitium typically stores the app record JSON in a field named "data".
    const rawConfig =
      payload.data ?? payload.Data ?? payload.value ?? payload.Value;

    let parsed: unknown = rawConfig;
    if (typeof rawConfig === "string") {
      try {
        parsed = JSON.parse(rawConfig) as unknown;
      } catch {
        warnings.push("APP record data was not valid JSON.");
        parsed = undefined;
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        addresses: [],
        warnings:
          warnings.length ? warnings : ["APP record data was not an object."],
      };
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    const addresses: string[] = [];

    for (const [key, value] of entries) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim().length > 0) {
            addresses.push(item.trim());
          }
        }
      } else if (typeof value === "string") {
        // Some configs may include strings (e.g., SimpleCNAME). Ignore for SimpleAddress.
        warnings.push(
          `Key \"${key}\" was a string value; expected array of IPs.`,
        );
      } else {
        warnings.push(`Key \"${key}\" had unsupported value type.`);
      }
    }

    // Deduplicate while preserving order.
    const seen = new Set<string>();
    const deduped = addresses.filter((addr) => {
      const normalized = addr.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    return {
      addresses: deduped,
      warnings: warnings.length ? warnings : undefined,
    };
  }
}
