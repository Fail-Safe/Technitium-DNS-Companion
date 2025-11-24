import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { DomainListCacheService } from './domain-list-cache.service';

@Controller('domain-lists')
export class DomainListController {
  constructor(private readonly domainListService: DomainListCacheService) {}

  /**
   * GET /api/domain-lists/:nodeId/metadata
   * Get metadata about all configured blocklists and allowlists for a node
   */
  @Get(':nodeId/metadata')
  async getMetadata(@Param('nodeId') nodeId: string) {
    return this.domainListService.getListsMetadata(nodeId);
  }

  /**
   * GET /api/domain-lists/:nodeId/check?domain=example.com
   * Check if a domain exists in any blocklist or allowlist (across all groups)
   */
  @Get(':nodeId/check')
  async checkDomain(@Param('nodeId') nodeId: string, @Query('domain') domain: string) {
    if (!domain) {
      return { error: 'domain query parameter is required' };
    }
    return this.domainListService.checkDomain(nodeId, domain);
  }

  /**
   * GET /api/domain-lists/:nodeId/simulate?group=groupName&domain=example.com
   * Simulate the effective policy for a domain in a specific group (Policy Simulator)
   */
  @Get(':nodeId/simulate')
  async simulateGroupPolicy(
    @Param('nodeId') nodeId: string,
    @Query('group') groupName: string,
    @Query('domain') domain: string,
  ) {
    if (!groupName) {
      return { error: 'group query parameter is required' };
    }
    if (!domain) {
      return { error: 'domain query parameter is required' };
    }
    return this.domainListService.simulateGroupPolicy(nodeId, groupName, domain);
  }

  /**
   * GET /api/domain-lists/:nodeId/search?query=example&type=blocklist&limit=100
   * Search for domains matching a pattern across all lists
   */
  @Get(':nodeId/search')
  async searchDomains(
    @Param('nodeId') nodeId: string,
    @Query('query') query: string,
    @Query('type') type?: 'blocklist' | 'allowlist',
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    if (!query) {
      return { error: 'query parameter is required' };
    }
    return this.domainListService.searchDomains(nodeId, query, {
      type,
      limit,
    });
  }

  /**
   * GET /api/domain-lists/:nodeId/list/:hash/domains?page=1&limit=100
   * Get domains from a specific list (paginated)
   */
  @Get(':nodeId/list/:hash/domains')
  getListDomains(
    @Param('nodeId') nodeId: string,
    @Param('hash') hash: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    return this.domainListService.getListDomains(nodeId, hash, page, limit);
  }

  /**
   * GET /api/domain-lists/:nodeId/all-domains?search=query&searchMode=text&type=all&page=1&limit=1000
   * Get all domains from all lists for a node (with filtering and pagination)
   */
  @Get(':nodeId/all-domains')
  async getAllDomains(
    @Param('nodeId') nodeId: string,
    @Query('search') search?: string,
    @Query('searchMode') searchMode?: 'text' | 'regex',
    @Query('type') type?: 'all' | 'allow' | 'block',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 1000;

    return this.domainListService.getAllDomains(
      nodeId,
      search,
      searchMode,
      type,
      pageNum,
      limitNum,
    );
  }

  /**
   * POST /api/domain-lists/:nodeId/refresh
   * Force refresh all lists for a node
   */
  @Post(':nodeId/refresh')
  async refreshLists(@Param('nodeId') nodeId: string) {
    await this.domainListService.refreshLists(nodeId);
    return { success: true, message: `Refreshed all lists for node ${nodeId}` };
  }

  /**
   * POST /api/domain-lists/:nodeId/clear-cache
   * Clear cache for a specific node
   */
  @Post(':nodeId/clear-cache')
  clearCache(@Param('nodeId') nodeId: string) {
    this.domainListService.clearCache(nodeId);
    return { success: true, message: `Cleared cache for node ${nodeId}` };
  }

  /**
   * POST /api/domain-lists/clear-all-caches
   * Clear all caches
   */
  @Post('clear-all-caches')
  clearAllCaches() {
    this.domainListService.clearAllCaches();
    return { success: true, message: 'Cleared all domain list caches' };
  }
}
