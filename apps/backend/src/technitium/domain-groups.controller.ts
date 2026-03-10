import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { DomainGroupsService } from "./domain-groups.service";

@Controller("domain-groups")
export class DomainGroupsController {
  constructor(
    private readonly domainGroupsService: DomainGroupsService,
    private readonly evaluatorService: DnsSchedulesEvaluatorService,
  ) {}

  @Get()
  listDomainGroups() {
    return this.domainGroupsService.listDomainGroups();
  }

  @Get("status")
  getStatus() {
    return this.domainGroupsService.getStatus();
  }

  @Get("materialization/preview")
  getMaterializationPreview() {
    return this.domainGroupsService.getMaterializationPreview();
  }

  @Post("materialization/apply")
  applyMaterialization(
    @Body()
    body?: {
      nodeIds?: unknown;
      dryRun?: unknown;
    },
  ) {
    return this.domainGroupsService.applyMaterialization({
      nodeIds: body?.nodeIds as string[] | undefined,
      dryRun: body?.dryRun === true,
    });
  }

  @Get("export")
  exportUnifiedConfig(@Query("nodeId") nodeId?: string) {
    if (!nodeId) throw new BadRequestException("nodeId is required");
    return this.domainGroupsService.exportUnifiedConfig(nodeId);
  }

  @Post("import")
  importUnifiedConfig(
    @Body()
    body?: {
      nodeId?: unknown;
      domainsMode?: unknown;
      domainGroupsMode?: unknown;
      data?: unknown;
    },
  ) {
    return this.domainGroupsService.importUnifiedConfig({
      nodeId: body?.nodeId,
      domainsMode: body?.domainsMode,
      domainGroupsMode: body?.domainGroupsMode,
      data: body?.data,
    });
  }

  @Get(":groupId")
  getDomainGroup(@Param("groupId") groupId: string) {
    return this.domainGroupsService.getDomainGroup(groupId);
  }

  @Post()
  createDomainGroup(@Body() body: { name?: unknown; description?: unknown }) {
    return this.domainGroupsService.createDomainGroup(body);
  }

  @Patch(":groupId")
  updateDomainGroup(
    @Param("groupId") groupId: string,
    @Body() body: { name?: unknown; description?: unknown },
  ) {
    return this.domainGroupsService.updateDomainGroup(groupId, body);
  }

  @Delete(":groupId")
  deleteDomainGroup(@Param("groupId") groupId: string) {
    const { name } = this.domainGroupsService.getDomainGroup(groupId);
    const result = this.domainGroupsService.deleteDomainGroup(groupId);
    this.evaluatorService.syncAlertRulesForDomainGroup(name);
    return result;
  }

  @Post(":groupId/entries")
  addEntry(
    @Param("groupId") groupId: string,
    @Body() body: { matchType?: unknown; value?: unknown; note?: unknown },
  ) {
    const { name } = this.domainGroupsService.getDomainGroup(groupId);
    const result = this.domainGroupsService.addEntry(groupId, body);
    this.evaluatorService.syncAlertRulesForDomainGroup(name);
    return result;
  }

  @Patch(":groupId/entries/:entryId")
  updateEntry(
    @Param("groupId") groupId: string,
    @Param("entryId") entryId: string,
    @Body() body: { matchType?: unknown; value?: unknown; note?: unknown },
  ) {
    const { name } = this.domainGroupsService.getDomainGroup(groupId);
    const result = this.domainGroupsService.updateEntry(groupId, entryId, body);
    this.evaluatorService.syncAlertRulesForDomainGroup(name);
    return result;
  }

  @Delete(":groupId/entries/:entryId")
  removeEntry(
    @Param("groupId") groupId: string,
    @Param("entryId") entryId: string,
  ) {
    const { name } = this.domainGroupsService.getDomainGroup(groupId);
    const result = this.domainGroupsService.removeEntry(groupId, entryId);
    this.evaluatorService.syncAlertRulesForDomainGroup(name);
    return result;
  }

  @Post(":groupId/bindings")
  addBinding(
    @Param("groupId") groupId: string,
    @Body() body: { advancedBlockingGroupName?: unknown; action?: unknown },
  ) {
    return this.domainGroupsService.addBinding(groupId, body);
  }

  @Delete(":groupId/bindings/:bindingId")
  removeBinding(
    @Param("groupId") groupId: string,
    @Param("bindingId") bindingId: string,
  ) {
    return this.domainGroupsService.removeBinding(groupId, bindingId);
  }
}
