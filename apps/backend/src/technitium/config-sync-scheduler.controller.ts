import { Controller, Get, Post } from "@nestjs/common";
import { ConfigSyncSchedulerService } from "./config-sync-scheduler.service";

@Controller("nodes/config-sync")
export class ConfigSyncSchedulerController {
  constructor(private readonly scheduler: ConfigSyncSchedulerService) {}

  @Get("status")
  getStatus() {
    return this.scheduler.getStatus();
  }

  @Post("run")
  runNow() {
    return this.scheduler.runNow();
  }
}
