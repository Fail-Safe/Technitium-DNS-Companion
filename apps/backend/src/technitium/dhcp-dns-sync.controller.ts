import { Body, Controller, Get, Post } from "@nestjs/common";
import { DhcpDnsSyncService } from "./dhcp-dns-sync.service";
import type {
  DhcpDnsSyncApplyRequest,
  DhcpDnsSyncApplyResponse,
  DhcpDnsSyncDefaultsResponse,
  DhcpDnsSyncPreviewRequest,
  DhcpDnsSyncPreviewResponse,
} from "./dhcp-dns-sync.types";

@Controller("dhcp-dns-sync")
export class DhcpDnsSyncController {
  constructor(private readonly dhcpDnsSyncService: DhcpDnsSyncService) {}

  @Get("defaults")
  defaults(): DhcpDnsSyncDefaultsResponse {
    return this.dhcpDnsSyncService.getDefaults();
  }

  @Post("preview")
  preview(
    @Body() body: DhcpDnsSyncPreviewRequest,
  ): Promise<DhcpDnsSyncPreviewResponse> {
    return this.dhcpDnsSyncService.preview(body);
  }

  @Post("apply")
  apply(
    @Body() body: DhcpDnsSyncApplyRequest,
  ): Promise<DhcpDnsSyncApplyResponse> {
    return this.dhcpDnsSyncService.apply(body);
  }
}
