import { Controller, Get, Query, Logger } from '@nestjs/common';
import { BlockListCatalogService, HageziUpdateCheckResult } from './blocklist-catalog.service';

@Controller('blocklist-catalog')
export class BlockListCatalogController {
    private readonly logger = new Logger(BlockListCatalogController.name);

    constructor(private readonly catalogService: BlockListCatalogService) { }

    /**
     * GET /api/blocklist-catalog/hagezi
     * Fetch the latest Hagezi blocklist catalog from GitHub
     *
     * @param refresh - If 'true', bypass cache and fetch fresh data
     */
    @Get('hagezi')
    async getHageziCatalog(
        @Query('refresh') refresh?: string,
    ): Promise<HageziUpdateCheckResult> {
        const forceRefresh = refresh === 'true';
        this.logger.log(`Fetching Hagezi catalog (refresh=${forceRefresh})`);
        return this.catalogService.checkHageziUpdates(forceRefresh);
    }

    /**
     * GET /api/blocklist-catalog/hagezi/compare
     * Compare current block list URLs with latest Hagezi catalog
     *
     * @param urls - Comma-separated list of current URLs to compare
     */
    @Get('hagezi/compare')
    async compareWithHagezi(
        @Query('urls') urls?: string,
    ): Promise<{
        newLists: Array<{ id: string; name: string; url: string; description: string }>;
        changedUrls: Array<{ oldUrl: string; newUrl: string; listName: string }>;
    }> {
        const currentUrls = urls ? urls.split(',').map(u => u.trim()) : [];
        this.logger.log(`Comparing ${currentUrls.length} URLs with Hagezi catalog`);
        return this.catalogService.compareWithCatalog(currentUrls);
    }
}
