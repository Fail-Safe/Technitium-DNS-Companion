/**
 * Built-in Blocking Controller
 *
 * REST API endpoints for managing Technitium DNS's native allow/blocklist functionality.
 * This is the built-in blocking mechanism that does NOT require the Advanced Blocking App.
 *
 * API Endpoints:
 * - GET  /built-in-blocking                  - Overview across all nodes
 * - GET  /built-in-blocking/:nodeId          - Snapshot for specific node
 * - GET  /built-in-blocking/:nodeId/settings - Get blocking settings
 * - POST /built-in-blocking/:nodeId/settings - Update blocking settings
 * - POST /built-in-blocking/:nodeId/settings/force-update - Force block list update
 * - POST /built-in-blocking/:nodeId/settings/temporary-disable - Temporarily disable blocking
 * - POST /built-in-blocking/:nodeId/settings/re-enable - Re-enable blocking
 *
 * Allowed Zones:
 * - GET    /built-in-blocking/:nodeId/allowed         - List allowed domains
 * - POST   /built-in-blocking/:nodeId/allowed         - Add allowed domain
 * - DELETE /built-in-blocking/:nodeId/allowed/:domain - Delete allowed domain
 * - DELETE /built-in-blocking/:nodeId/allowed         - Flush all allowed domains
 * - POST   /built-in-blocking/:nodeId/allowed/import  - Import from URL(s)
 * - GET    /built-in-blocking/:nodeId/allowed/export  - Export as text
 *
 * Blocked Zones:
 * - GET    /built-in-blocking/:nodeId/blocked         - List blocked domains
 * - POST   /built-in-blocking/:nodeId/blocked         - Add blocked domain
 * - DELETE /built-in-blocking/:nodeId/blocked/:domain - Delete blocked domain
 * - DELETE /built-in-blocking/:nodeId/blocked         - Flush all blocked domains
 * - POST   /built-in-blocking/:nodeId/blocked/import  - Import from URL(s)
 * - GET    /built-in-blocking/:nodeId/blocked/export  - Export as text
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  BadRequestException,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { BuiltInBlockingService } from "./built-in-blocking.service";
import type {
  BuiltInBlockingOverview,
  BuiltInBlockingSnapshot,
  BlockingZoneListResponse,
  BlockingZoneOperationResult,
  BlockingSettings,
  UpdateBlockingSettingsRequest,
  BlockingZoneImportParams,
  BlockingStatusOverview,
} from "./built-in-blocking.types";

/** Request body for adding a domain */
interface AddDomainBody {
  domain: string;
}

/** Request body for importing from URLs */
interface ImportUrlsBody {
  urls: string[];
}

@Controller("built-in-blocking")
export class BuiltInBlockingController {
  constructor(
    private readonly builtInBlockingService: BuiltInBlockingService,
  ) {}

  // ========================================
  // Status & Overview Endpoints
  // ========================================

  /**
   * Get combined blocking status across all nodes.
   * Detects conflicts between Built-in Blocking and Advanced Blocking.
   */
  @Get("status")
  async getBlockingStatus(): Promise<BlockingStatusOverview> {
    return this.builtInBlockingService.getBlockingStatus();
  }

  /**
   * Get built-in blocking overview across all nodes
   */
  @Get()
  async getOverview(): Promise<BuiltInBlockingOverview> {
    return this.builtInBlockingService.getOverview();
  }

  /**
   * Get built-in blocking snapshot for a specific node
   */
  @Get(":nodeId")
  async getSnapshot(
    @Param("nodeId") nodeId: string,
  ): Promise<BuiltInBlockingSnapshot> {
    return this.builtInBlockingService.getSnapshot(nodeId);
  }

  // ========================================
  // Settings Endpoints
  // ========================================

  /**
   * Get blocking settings for a node
   */
  @Get(":nodeId/settings")
  async getSettings(
    @Param("nodeId") nodeId: string,
  ): Promise<BlockingSettings> {
    return this.builtInBlockingService.getBlockingSettings(nodeId);
  }

  /**
   * Update blocking settings for a node
   */
  @Post(":nodeId/settings")
  async updateSettings(
    @Param("nodeId") nodeId: string,
    @Body() body: UpdateBlockingSettingsRequest,
  ): Promise<BlockingZoneOperationResult> {
    return this.builtInBlockingService.updateBlockingSettings(nodeId, body);
  }

  /**
   * Force update block lists from configured URLs
   */
  @Post(":nodeId/settings/force-update")
  async forceUpdate(
    @Param("nodeId") nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    return this.builtInBlockingService.forceBlockListUpdate(nodeId);
  }

  /**
   * Temporarily disable blocking for a specified duration
   */
  @Post(":nodeId/settings/temporary-disable")
  async temporaryDisable(
    @Param("nodeId") nodeId: string,
    @Body() body: { minutes: number },
  ): Promise<{
    success: boolean;
    temporaryDisableBlockingTill?: string;
    message?: string;
  }> {
    if (
      body?.minutes === undefined ||
      typeof body.minutes !== "number" ||
      body.minutes < 0
    ) {
      throw new BadRequestException(
        "minutes is required and must be a non-negative number",
      );
    }
    return this.builtInBlockingService.temporaryDisableBlocking(
      nodeId,
      body.minutes,
    );
  }

  /**
   * Re-enable blocking (cancel temporary disable)
   */
  @Post(":nodeId/settings/re-enable")
  async reEnable(
    @Param("nodeId") nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    return this.builtInBlockingService.reEnableBlocking(nodeId);
  }

  // ========================================
  // Allowed Zones Endpoints
  // ========================================

  /**
   * List allowed domains
   */
  @Get(":nodeId/allowed")
  async listAllowed(
    @Param("nodeId") nodeId: string,
    @Query("domain") domain?: string,
    @Query("pageNumber") pageNumber?: string,
    @Query("entriesPerPage") entriesPerPage?: string,
    @Query("format") format?: "list" | "tree",
  ): Promise<BlockingZoneListResponse> {
    return this.builtInBlockingService.listAllowedZones(nodeId, {
      domain,
      pageNumber: pageNumber ? parseInt(pageNumber, 10) : undefined,
      entriesPerPage: entriesPerPage ? parseInt(entriesPerPage, 10) : undefined,
      format,
    });
  }

  /**
   * Add a domain to allowed list
   */
  @Post(":nodeId/allowed")
  async addAllowed(
    @Param("nodeId") nodeId: string,
    @Body() body: AddDomainBody,
  ): Promise<BlockingZoneOperationResult> {
    if (!body?.domain || typeof body.domain !== "string") {
      throw new BadRequestException("domain is required");
    }

    return this.builtInBlockingService.addAllowedZone(nodeId, {
      domain: body.domain.trim(),
    });
  }

  /**
   * Delete a domain from allowed list
   */
  @Delete(":nodeId/allowed/:domain")
  async deleteAllowed(
    @Param("nodeId") nodeId: string,
    @Param("domain") domain: string,
  ): Promise<BlockingZoneOperationResult> {
    if (!domain) {
      throw new BadRequestException("domain is required");
    }

    return this.builtInBlockingService.deleteAllowedZone(nodeId, { domain });
  }

  /**
   * Flush all allowed domains
   */
  @Delete(":nodeId/allowed")
  async flushAllowed(
    @Param("nodeId") nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    return this.builtInBlockingService.flushAllowedZones(nodeId);
  }

  /**
   * Import allowed domains from URL(s)
   */
  @Post(":nodeId/allowed/import")
  async importAllowed(
    @Param("nodeId") nodeId: string,
    @Body() body: ImportUrlsBody,
  ): Promise<BlockingZoneOperationResult> {
    if (!body?.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      throw new BadRequestException("urls array is required");
    }

    const params: BlockingZoneImportParams = { listUrl: body.urls };
    return this.builtInBlockingService.importAllowedZones(nodeId, params);
  }

  /**
   * Export allowed domains as plain text
   */
  @Get(":nodeId/allowed/export")
  async exportAllowed(
    @Param("nodeId") nodeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const content =
      await this.builtInBlockingService.exportAllowedZones(nodeId);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="allowed-${nodeId}.txt"`,
    );
    res.send(content);
  }

  // ========================================
  // Blocked Zones Endpoints
  // ========================================

  /**
   * List blocked domains
   */
  @Get(":nodeId/blocked")
  async listBlocked(
    @Param("nodeId") nodeId: string,
    @Query("domain") domain?: string,
    @Query("pageNumber") pageNumber?: string,
    @Query("entriesPerPage") entriesPerPage?: string,
    @Query("format") format?: "list" | "tree",
  ): Promise<BlockingZoneListResponse> {
    return this.builtInBlockingService.listBlockedZones(nodeId, {
      domain,
      pageNumber: pageNumber ? parseInt(pageNumber, 10) : undefined,
      entriesPerPage: entriesPerPage ? parseInt(entriesPerPage, 10) : undefined,
      format,
    });
  }

  /**
   * Add a domain to blocked list
   */
  @Post(":nodeId/blocked")
  async addBlocked(
    @Param("nodeId") nodeId: string,
    @Body() body: AddDomainBody,
  ): Promise<BlockingZoneOperationResult> {
    if (!body?.domain || typeof body.domain !== "string") {
      throw new BadRequestException("domain is required");
    }

    return this.builtInBlockingService.addBlockedZone(nodeId, {
      domain: body.domain.trim(),
    });
  }

  /**
   * Delete a domain from blocked list
   */
  @Delete(":nodeId/blocked/:domain")
  async deleteBlocked(
    @Param("nodeId") nodeId: string,
    @Param("domain") domain: string,
  ): Promise<BlockingZoneOperationResult> {
    if (!domain) {
      throw new BadRequestException("domain is required");
    }

    return this.builtInBlockingService.deleteBlockedZone(nodeId, { domain });
  }

  /**
   * Flush all blocked domains
   */
  @Delete(":nodeId/blocked")
  async flushBlocked(
    @Param("nodeId") nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    return this.builtInBlockingService.flushBlockedZones(nodeId);
  }

  /**
   * Import blocked domains from URL(s)
   */
  @Post(":nodeId/blocked/import")
  async importBlocked(
    @Param("nodeId") nodeId: string,
    @Body() body: ImportUrlsBody,
  ): Promise<BlockingZoneOperationResult> {
    if (!body?.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      throw new BadRequestException("urls array is required");
    }

    const params: BlockingZoneImportParams = { listUrl: body.urls };
    return this.builtInBlockingService.importBlockedZones(nodeId, params);
  }

  /**
   * Export blocked domains as plain text
   */
  @Get(":nodeId/blocked/export")
  async exportBlocked(
    @Param("nodeId") nodeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const content =
      await this.builtInBlockingService.exportBlockedZones(nodeId);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="blocked-${nodeId}.txt"`,
    );
    res.send(content);
  }
}
