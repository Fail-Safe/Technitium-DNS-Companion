import { Controller, Get, Param } from "@nestjs/common";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type {
  AdvancedBlockingSnapshot,
  AdvancedBlockingOverview,
  AdvancedBlockingCombinedOverview,
} from "./advanced-blocking.types";

@Controller("advanced-blocking")
export class AdvancedBlockingController {
  constructor(
    private readonly advancedBlockingService: AdvancedBlockingService,
  ) {}

  /**
   * Get Advanced Blocking configuration for a specific node
   * Used by DNS Lookup page to fetch groups for the Policy Simulator
   */
  @Get(":nodeId")
  async getNodeConfig(
    @Param("nodeId") nodeId: string,
  ): Promise<AdvancedBlockingSnapshot> {
    return this.advancedBlockingService.getSnapshot(nodeId);
  }

  /**
   * Get Advanced Blocking overview for all nodes
   */
  @Get()
  async getOverview(): Promise<AdvancedBlockingOverview> {
    return this.advancedBlockingService.getOverview();
  }

  /**
   * Get combined Advanced Blocking overview with group comparisons
   */
  @Get("combined/overview")
  async getCombinedOverview(): Promise<AdvancedBlockingCombinedOverview> {
    return this.advancedBlockingService.getCombinedAdvancedBlockingConfig();
  }
}
