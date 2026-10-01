import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from "@nestjs/common";
import { AdvancedBlockingPauseService } from "./advanced-blocking-pause.service";
import type {
  AdvancedBlockingPauseOperationResult,
  AdvancedBlockingPauseStatus,
} from "./advanced-blocking-pause.types";

@Controller("advanced-blocking/pause")
export class AdvancedBlockingPauseController {
  constructor(private readonly pauseService: AdvancedBlockingPauseService) {}

  @Get()
  getStatus(): AdvancedBlockingPauseStatus {
    return this.pauseService.getStatus();
  }

  @Post()
  async pause(
    @Body() body: { minutes?: unknown },
  ): Promise<AdvancedBlockingPauseOperationResult> {
    if (typeof body?.minutes !== "number") {
      throw new BadRequestException("minutes is required.");
    }
    return this.pauseService.pause(body.minutes);
  }

  @Post("resume")
  resume(): Promise<AdvancedBlockingPauseOperationResult> {
    return this.pauseService.resumeNow();
  }
}
