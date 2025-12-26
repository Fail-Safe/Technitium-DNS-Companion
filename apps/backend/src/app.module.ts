import { CacheModule } from "@nestjs/cache-manager";
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthGuard } from "./auth/auth.guard";
import { AuthRequestContextMiddleware } from "./auth/auth.middleware";
import { AuthModule } from "./auth/auth.module";
import { BlockListCatalogModule } from "./blocklist-catalog/blocklist-catalog.module";
import { TechnitiumModule } from "./technitium/technitium.module";

@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 30000, // 30 seconds default TTL
      max: 100, // Max 100 items in cache
    }),
    TechnitiumModule,
    BlockListCatalogModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(cookieParser(), AuthRequestContextMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
