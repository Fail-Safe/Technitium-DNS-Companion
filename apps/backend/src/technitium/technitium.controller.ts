import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseInterceptors,
} from "@nestjs/common";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { Throttle } from "@nestjs/throttler";
import { TechnitiumService } from "./technitium.service";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type {
  TechnitiumQueryLogFilters,
  TechnitiumCloneDhcpScopeRequest,
  TechnitiumUpdateDhcpScopeRequest,
  DhcpBulkSyncRequest,
} from "./technitium.types";
import type { AdvancedBlockingUpdateRequest } from "./advanced-blocking.types";
import type { Response } from "express";

@Controller("nodes")
export class TechnitiumController {
  constructor(
    private readonly technitiumService: TechnitiumService,
    private readonly advancedBlockingService: AdvancedBlockingService,
  ) {}

  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000) // Cache for 30 seconds - cluster state doesn't change frequently
  listNodes() {
    return this.technitiumService.listNodes();
  }

  @Get("advanced-blocking")
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000) // Cache for 30 seconds - Advanced Blocking config doesn't change frequently
  getAdvancedBlockingOverview() {
    return this.advancedBlockingService.getOverview();
  }

  // OPTIMIZATION (Phase 4): Throttle combined logs endpoint to prevent duplicate concurrent requests
  // With 3-second auto-refresh and 30-second cache, throttling at 2 req/sec is reasonable
  // This improves cache hit ratio and reduces unnecessary concurrent requests
  @Get("logs/combined")
  @Throttle({ default: { limit: 20, ttl: 10000 } }) // 20 requests per 10 seconds
  getCombinedQueryLogs(
    @Query() query: Record<string, string | string[]>,
    @Res({ passthrough: true }) res: Response,
  ) {
    console.log("🔍 Backend received query params:", query);
    const filters = this.normalizeQueryLogFilters(query);
    console.log("🔍 Normalized filters:", filters);

    if (filters.disableCache) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }

    return this.technitiumService.getCombinedQueryLogs(filters);
  }

  @Get("zones/combined")
  getCombinedZones() {
    return this.technitiumService.getCombinedZones();
  }

  @Get("advanced-blocking/combined")
  getCombinedAdvancedBlockingConfig() {
    return this.advancedBlockingService.getCombinedAdvancedBlockingConfig();
  }

  @Get(":nodeId/status")
  getNodeStatus(@Param("nodeId") nodeId: string) {
    return this.technitiumService.getNodeStatus(nodeId);
  }

  @Get(":nodeId/cluster/state")
  getClusterState(@Param("nodeId") nodeId: string) {
    return this.technitiumService.getClusterState(nodeId);
  }

  @Get(":nodeId/cluster/settings")
  getClusterSettings(@Param("nodeId") nodeId: string) {
    return this.technitiumService.getClusterSettings(nodeId);
  }

  @Get(":nodeId/overview")
  getNodeOverview(@Param("nodeId") nodeId: string) {
    return this.technitiumService.getNodeOverview(nodeId);
  }

  @Get(":nodeId/apps")
  getNodeApps(@Param("nodeId") nodeId: string) {
    return this.technitiumService.getNodeApps(nodeId);
  }

  @Get(":nodeId/logs")
  getQueryLogs(
    @Param("nodeId") nodeId: string,
    @Query() query: Record<string, string | string[]>,
  ) {
    const filters = this.normalizeQueryLogFilters(query);
    return this.technitiumService.getQueryLogs(nodeId, filters);
  }

  @Get(":nodeId/dhcp/scopes")
  listDhcpScopes(@Param("nodeId") nodeId: string) {
    return this.technitiumService.listDhcpScopes(nodeId);
  }

  @Get(":nodeId/zones")
  listZones(@Param("nodeId") nodeId: string) {
    return this.technitiumService.listZones(nodeId);
  }

  @Get(":nodeId/dhcp/scopes/:scopeName")
  getDhcpScope(
    @Param("nodeId") nodeId: string,
    @Param("scopeName") scopeName: string,
  ) {
    if (!scopeName || scopeName.trim().length === 0) {
      throw new BadRequestException("Scope name is required.");
    }

    return this.technitiumService.getDhcpScope(nodeId, scopeName);
  }

  @Get(":nodeId/advanced-blocking")
  getAdvancedBlockingSnapshot(@Param("nodeId") nodeId: string) {
    return this.advancedBlockingService.getSnapshot(nodeId);
  }

  @Post(":nodeId/advanced-blocking")
  updateAdvancedBlocking(
    @Param("nodeId") nodeId: string,
    @Body() body: AdvancedBlockingUpdateRequest,
  ) {
    if (!body || !body.config) {
      throw new BadRequestException("Advanced Blocking config is required.");
    }

    return this.advancedBlockingService.setConfig(nodeId, body.config);
  }

  @Post(":nodeId/dhcp/scopes/:scopeName/clone")
  cloneDhcpScope(
    @Param("nodeId") nodeId: string,
    @Param("scopeName") scopeName: string,
    @Body() body: TechnitiumCloneDhcpScopeRequest,
  ) {
    if (!scopeName || scopeName.trim().length === 0) {
      throw new BadRequestException("Scope name is required.");
    }

    if (!body) {
      throw new BadRequestException("Clone request payload is required.");
    }

    const payload: TechnitiumCloneDhcpScopeRequest = {
      enableOnTarget: body.enableOnTarget,
      overrides: body.overrides,
    };

    const trimmedTargetNode = body.targetNodeId?.trim();
    if (trimmedTargetNode) {
      payload.targetNodeId = trimmedTargetNode;
    }

    const trimmedNewName = body.newScopeName?.trim();
    if (trimmedNewName) {
      payload.newScopeName = trimmedNewName;
    }

    return this.technitiumService.cloneDhcpScope(nodeId, scopeName, payload);
  }

  @Post(":nodeId/dhcp/scopes/:scopeName")
  updateDhcpScope(
    @Param("nodeId") nodeId: string,
    @Param("scopeName") scopeName: string,
    @Body() body: TechnitiumUpdateDhcpScopeRequest,
  ) {
    if (!scopeName || scopeName.trim().length === 0) {
      throw new BadRequestException("Scope name is required.");
    }

    if (!body) {
      throw new BadRequestException("Update request payload is required.");
    }

    const payload: TechnitiumUpdateDhcpScopeRequest = {};

    if (body.overrides) {
      const overrides: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(body.overrides)) {
        if (value === undefined) {
          continue;
        }

        overrides[key] = value;
      }

      if (Object.keys(overrides).length > 0) {
        payload.overrides =
          overrides as TechnitiumUpdateDhcpScopeRequest["overrides"];
      }
    }

    if (body.enabled !== undefined) {
      payload.enabled = body.enabled;
    }

    return this.technitiumService.updateDhcpScope(nodeId, scopeName, payload);
  }

  @Delete(":nodeId/dhcp/scopes/:scopeName")
  deleteDhcpScope(
    @Param("nodeId") nodeId: string,
    @Param("scopeName") scopeName: string,
  ) {
    if (!scopeName || scopeName.trim().length === 0) {
      throw new BadRequestException("Scope name is required.");
    }

    return this.technitiumService.deleteDhcpScope(nodeId, scopeName);
  }

  @Post("dhcp/bulk-sync")
  bulkSyncDhcpScopes(@Body() body: DhcpBulkSyncRequest) {
    if (
      !body ||
      !body.sourceNodeId ||
      !body.targetNodeIds ||
      body.targetNodeIds.length === 0
    ) {
      throw new BadRequestException(
        "Source node ID and at least one target node ID are required.",
      );
    }

    if (!body.strategy) {
      throw new BadRequestException(
        "Sync strategy is required (skip-existing, overwrite-all, or merge-missing).",
      );
    }

    const validStrategies = ["skip-existing", "overwrite-all", "merge-missing"];
    if (!validStrategies.includes(body.strategy)) {
      throw new BadRequestException(
        `Invalid strategy. Must be one of: ${validStrategies.join(", ")}`,
      );
    }

    return this.technitiumService.bulkSyncDhcpScopes(body);
  }

  private normalizeQueryLogFilters(
    raw: Record<string, string | string[]>,
  ): TechnitiumQueryLogFilters {
    const filters: TechnitiumQueryLogFilters = {};
    const first = (
      value: string | string[] | undefined,
    ): string | undefined => {
      if (Array.isArray(value)) {
        return value[0];
      }
      return value;
    };

    const pageNumberRaw = first(raw.pageNumber);
    if (pageNumberRaw !== undefined) {
      const parsed = Number.parseInt(pageNumberRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new BadRequestException(
          '"pageNumber" must be a positive integer.',
        );
      }
      filters.pageNumber = parsed;
    }

    const entriesPerPageRaw = first(raw.entriesPerPage);
    if (entriesPerPageRaw !== undefined) {
      const parsed = Number.parseInt(entriesPerPageRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new BadRequestException(
          '"entriesPerPage" must be a positive integer.',
        );
      }
      filters.entriesPerPage = parsed;
    }

    const descendingOrderRaw = first(raw.descendingOrder);
    if (descendingOrderRaw !== undefined) {
      if (/^(true|1)$/i.test(descendingOrderRaw)) {
        filters.descendingOrder = true;
      } else if (/^(false|0)$/i.test(descendingOrderRaw)) {
        filters.descendingOrder = false;
      } else {
        throw new BadRequestException(
          '"descendingOrder" must be "true" or "false".',
        );
      }
    }

    const deduplicateDomainsRaw = first(raw.deduplicateDomains);
    if (deduplicateDomainsRaw !== undefined) {
      if (/^(true|1)$/i.test(deduplicateDomainsRaw)) {
        filters.deduplicateDomains = true;
      } else if (/^(false|0)$/i.test(deduplicateDomainsRaw)) {
        filters.deduplicateDomains = false;
      } else {
        throw new BadRequestException(
          '"deduplicateDomains" must be "true" or "false".',
        );
      }
    }

    const disableCacheRaw = first(raw.disableCache);
    if (disableCacheRaw !== undefined) {
      if (/^(true|1)$/i.test(disableCacheRaw)) {
        filters.disableCache = true;
      } else if (/^(false|0)$/i.test(disableCacheRaw)) {
        filters.disableCache = false;
      } else {
        throw new BadRequestException(
          '"disableCache" must be "true" or "false".',
        );
      }
    }

    const assignString = (key: keyof TechnitiumQueryLogFilters) => {
      const value = first(raw[key]);
      if (typeof value === "string" && value.trim().length > 0) {
        (filters as Record<string, unknown>)[key] = value.trim();
      }
    };

    assignString("start");
    assignString("end");
    assignString("clientIpAddress");
    assignString("protocol");
    assignString("responseType");
    assignString("rcode");
    assignString("qname");
    assignString("qtype");
    assignString("qclass");

    return filters;
  }
}
