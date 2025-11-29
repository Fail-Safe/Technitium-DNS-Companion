import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BlockListCatalogService } from './blocklist-catalog.service';
import { BlockListCatalogController } from './blocklist-catalog.controller';

@Module({
    imports: [
        HttpModule.register({
            timeout: 30000,
            maxRedirects: 5,
        }),
    ],
    controllers: [BlockListCatalogController],
    providers: [BlockListCatalogService],
    exports: [BlockListCatalogService],
})
export class BlockListCatalogModule { }
