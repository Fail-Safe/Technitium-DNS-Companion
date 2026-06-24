import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { DnsTemporaryOverridesService } from "./dns-temporary-overrides.service";
import type {
  DnsTemporaryOverride,
  DnsTemporaryOverrideDraft,
} from "./dns-temporary-overrides.types";

const ACTIONS = ["block", "allow"] as const;

function stripNewlines(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

@Controller("nodes/dns-overrides/temporary")
export class DnsTemporaryOverridesController {
  constructor(
    private readonly temporaryOverridesService: DnsTemporaryOverridesService,
  ) {}

  @Get()
  listOverrides(): DnsTemporaryOverride[] {
    return this.temporaryOverridesService.listOverrides();
  }

  @Post()
  createOverride(@Body() body: unknown): DnsTemporaryOverride {
    return this.temporaryOverridesService.createOverride(this.parseDraft(body));
  }

  @Patch(":overrideId")
  updateOverride(
    @Param("overrideId") overrideId: string,
    @Body() body: unknown,
  ): DnsTemporaryOverride {
    return this.temporaryOverridesService.updateOverride(
      overrideId,
      this.parseDraft(body),
    );
  }

  @Patch(":overrideId/enabled")
  setOverrideEnabled(
    @Param("overrideId") overrideId: string,
    @Body() body: { enabled?: unknown },
  ): DnsTemporaryOverride {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled must be provided as a boolean.");
    }
    return this.temporaryOverridesService.setOverrideEnabled(
      overrideId,
      body.enabled,
    );
  }

  @Delete(":overrideId")
  deleteOverride(@Param("overrideId") overrideId: string): {
    deleted: true;
    overrideId: string;
  } {
    return this.temporaryOverridesService.deleteOverride(overrideId);
  }

  private parseDraft(body: unknown): DnsTemporaryOverrideDraft {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Request body must be a JSON object.");
    }
    const input = body as Record<string, unknown>;
    const name =
      typeof input.name === "string" ? stripNewlines(input.name) : "";
    if (!name) throw new BadRequestException("name is required.");

    const action = typeof input.action === "string" ? input.action.trim() : "";
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      throw new BadRequestException("action must be 'block' or 'allow'.");
    }

    const advancedBlockingGroupNames = this.normalizeStringArray(
      input.advancedBlockingGroupNames,
    );
    const domainEntries = this.normalizeStringArray(input.domainEntries);
    const domainGroupNames = this.normalizeStringArray(input.domainGroupNames);
    const nodeIds = this.normalizeStringArray(input.nodeIds);
    const expiresAt =
      typeof input.expiresAt === "string" && input.expiresAt.trim()
        ? input.expiresAt.trim()
        : null;

    return {
      name,
      enabled: input.enabled !== false,
      advancedBlockingGroupNames,
      action: action as DnsTemporaryOverrideDraft["action"],
      domainEntries,
      domainGroupNames,
      nodeIds,
      flushCacheOnChange: input.flushCacheOnChange !== false,
      expiresAt,
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
      ),
    ];
  }
}
