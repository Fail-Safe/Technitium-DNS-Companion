import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { SplitHorizonPtrService } from "./split-horizon-ptr.service";
import type {
  SplitHorizonPtrApplyRequest,
  SplitHorizonPtrApplyResponse,
  SplitHorizonPtrPreviewRequest,
  SplitHorizonPtrPreviewResponse,
  SplitHorizonPtrSourceZonesResponse,
} from "./split-horizon-ptr.types";

@Controller("split-horizon/ptr")
export class SplitHorizonPtrController {
  constructor(
    private readonly splitHorizonPtrService: SplitHorizonPtrService,
  ) {}

  @Get("source-zones")
  sourceZones(
    @Query("forceRefresh") forceRefresh?: string,
  ): Promise<SplitHorizonPtrSourceZonesResponse> {
    const normalized = (forceRefresh ?? "").trim().toLowerCase();
    const shouldForce = normalized === "true" || normalized === "1";
    return this.splitHorizonPtrService.listSourceZones({
      forceRefresh: shouldForce,
    });
  }

  @Post("preview")
  preview(
    @Body() body: SplitHorizonPtrPreviewRequest,
  ): Promise<SplitHorizonPtrPreviewResponse> {
    return this.splitHorizonPtrService.preview(body);
  }

  @Post("apply")
  apply(
    @Body() body: SplitHorizonPtrApplyRequest,
  ): Promise<SplitHorizonPtrApplyResponse> {
    return this.splitHorizonPtrService.apply(body);
  }
}
