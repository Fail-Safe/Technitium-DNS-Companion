import { HttpModule } from "@nestjs/axios";
import { Logger, Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdvancedBlockingController } from "./advanced-blocking.controller";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { BuiltInBlockingController } from "./built-in-blocking.controller";
import { BuiltInBlockingService } from "./built-in-blocking.service";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import { DomainListController } from "./domain-list-cache.controller";
import { DomainListCacheService } from "./domain-list-cache.service";
import { DomainListPersistenceService } from "./domain-list-persistence.service";
import { QueryLogSqliteService } from "./query-log-sqlite.service";
import { SplitHorizonPtrStateService } from "./split-horizon-ptr/split-horizon-ptr-state.service";
import { SplitHorizonPtrController } from "./split-horizon-ptr/split-horizon-ptr.controller";
import { SplitHorizonPtrService } from "./split-horizon-ptr/split-horizon-ptr.service";
import { TECHNITIUM_NODES_TOKEN } from "./technitium.constants";
import { TechnitiumController } from "./technitium.controller";
import { TechnitiumService } from "./technitium.service";
import { TechnitiumNodeConfig } from "./technitium.types";
import { ZoneSnapshotService } from "./zone-snapshot.service";

@Module({
  imports: [
    HttpModule,
    // OPTIMIZATION (Phase 4): Request throttling to prevent duplicate concurrent requests
    // Limits: 20 requests per 10 seconds per client (average 2 req/sec)
    // This works well with 3-second auto-refresh and 30-second cache TTL
    ThrottlerModule.forRoot([
      {
        ttl: 10000, // 10 seconds
        limit: 20, // 20 requests per 10 seconds = average 2 req/sec
      },
    ]),
  ],
  providers: [
    TechnitiumService,
    QueryLogSqliteService,
    AdvancedBlockingService,
    BuiltInBlockingService,
    SplitHorizonPtrService,
    SplitHorizonPtrStateService,
    DomainListCacheService,
    DomainListPersistenceService,
    DnsFilteringSnapshotService,
    DhcpSnapshotService,
    ZoneSnapshotService,
    {
      provide: TECHNITIUM_NODES_TOKEN,
      useFactory: (): TechnitiumNodeConfig[] => {
        const logger = new Logger("TechnitiumConfig");
        const sessionAuthEnabled = process.env.AUTH_SESSION_ENABLED === "true";
        const isTestRunner =
          process.env.JEST_WORKER_ID !== undefined ||
          process.env.NODE_ENV === "test";
        const allowHttpInTests =
          process.env.ALLOW_TECHNITIUM_HTTP_IN_TESTS === "true";

        if (isTestRunner && !allowHttpInTests) {
          logger.log(
            "Detected test environment, skipping Technitium DNS node configuration. " +
              "Set ALLOW_TECHNITIUM_HTTP_IN_TESTS=true to allow real nodes during tests.",
          );
          return [];
        }

        const rawNodes = process.env.TECHNITIUM_NODES;
        if (!rawNodes) {
          logger.warn(
            "No Technitium DNS nodes configured via TECHNITIUM_NODES",
          );
          return [];
        }

        const ids = rawNodes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);

        // Cluster-wide token (deprecated legacy fallback for all nodes)
        const clusterToken = process.env.TECHNITIUM_CLUSTER_TOKEN;

        if ((clusterToken ?? "").trim().length > 0) {
          logger.warn(
            "TECHNITIUM_CLUSTER_TOKEN is deprecated as of v1.3.0 and is planned to be removed in v1.4. " +
              "Prefer Technitium-backed session auth (AUTH_SESSION_ENABLED=true) for interactive UI usage and TECHNITIUM_BACKGROUND_TOKEN for background jobs. " +
              "Per-node TECHNITIUM_<NODE>_TOKEN is legacy-only for Technitium DNS < v14.",
          );
        }

        const configs: TechnitiumNodeConfig[] = [];

        for (const id of ids) {
          const sanitizedKey = id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
          const name = process.env[`TECHNITIUM_${sanitizedKey}_NAME`];
          const baseUrl = process.env[`TECHNITIUM_${sanitizedKey}_BASE_URL`];
          // Check node-specific token first (legacy), then fall back to cluster token (deprecated)
          const token =
            process.env[`TECHNITIUM_${sanitizedKey}_TOKEN`] || clusterToken;
          const queryLoggerAppName =
            process.env[`TECHNITIUM_${sanitizedKey}_QUERY_LOGGER_APP_NAME`];
          const queryLoggerClassPath =
            process.env[`TECHNITIUM_${sanitizedKey}_QUERY_LOGGER_CLASS_PATH`];

          if (!baseUrl) {
            logger.warn(
              `Skipping node "${id}" because TECHNITIUM_${sanitizedKey}_BASE_URL is not set.`,
            );
            continue;
          }

          if (!token && !sessionAuthEnabled) {
            logger.warn(
              `Skipping node "${id}" because neither TECHNITIUM_${sanitizedKey}_TOKEN nor TECHNITIUM_CLUSTER_TOKEN is set.`,
            );
            continue;
          }

          if (!token && sessionAuthEnabled) {
            logger.warn(
              `Node "${id}" has no env token configured; AUTH_SESSION_ENABLED=true so it will require user login sessions.`,
            );
          }

          configs.push({
            id,
            name: name || id, // Use name if provided, otherwise fall back to id
            baseUrl,
            token: token ?? "",
            queryLoggerAppName,
            queryLoggerClassPath,
          });
        }

        if (configs.length === 0) {
          logger.warn(
            "Technitium DNS configuration contained node ids but none were fully configured.",
          );
        }

        return configs;
      },
    },
  ],
  controllers: [
    TechnitiumController,
    AdvancedBlockingController,
    BuiltInBlockingController,
    DomainListController,
    SplitHorizonPtrController,
  ],
  exports: [
    TechnitiumService,
    AdvancedBlockingService,
    BuiltInBlockingService,
    SplitHorizonPtrService,
    DomainListCacheService,
    DhcpSnapshotService,
    TECHNITIUM_NODES_TOKEN,
  ],
})
export class TechnitiumModule {}
