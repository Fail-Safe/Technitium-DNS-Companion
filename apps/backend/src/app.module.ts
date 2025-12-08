import { Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { TechnitiumModule } from "./technitium/technitium.module";
import { BlockListCatalogModule } from "./blocklist-catalog/blocklist-catalog.module";

@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 30000, // 30 seconds default TTL
      max: 100, // Max 100 items in cache
    }),
    TechnitiumModule,
    BlockListCatalogModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
