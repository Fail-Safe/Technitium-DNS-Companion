import { HttpModule } from "@nestjs/axios";
import { Logger, Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdvancedBlockingController } from "./advanced-blocking.controller";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { BuiltInBlockingController } from "./built-in-blocking.controller";
import { BuiltInBlockingService } from "./built-in-blocking.service";
import { CompanionDbService } from "./companion-db.service";
import { ConfigSyncSchedulerController } from "./config-sync-scheduler.controller";
import { ConfigSyncSchedulerService } from "./config-sync-scheduler.service";
import { DhcpDnsSyncController } from "./dhcp-dns-sync.controller";
import { DhcpDnsSyncStateService } from "./dhcp-dns-sync-state.service";
import { DhcpDnsSyncService } from "./dhcp-dns-sync.service";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import { DnsSchedulesController } from "./dns-schedules.controller";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { DnsSchedulesService } from "./dns-schedules.service";
import { DnsTemporaryOverridesController } from "./dns-temporary-overrides.controller";
import { DnsTemporaryOverridesService } from "./dns-temporary-overrides.service";
import { DomainGroupsController } from "./domain-groups.controller";
import { DomainGroupsService } from "./domain-groups.service";
import { DomainListController } from "./domain-list-cache.controller";
import { DomainListCacheService } from "./domain-list-cache.service";
import { DomainListPersistenceService } from "./domain-list-persistence.service";
import { LogAlertsEmailService } from "./log-alerts-email.service";
import { LogAlertsController } from "./log-alerts.controller";
import { LogAlertsEvaluatorService } from "./log-alerts-evaluator.service";
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import { NodeOverviewCacheInterceptor } from "./node-overview-cache.interceptor";
import { QueryLogSqliteService } from "./query-log-sqlite.service";
import { SplitHorizonPtrStateService } from "./split-horizon-ptr/split-horizon-ptr-state.service";
import { SplitHorizonPtrController } from "./split-horizon-ptr/split-horizon-ptr.controller";
import { SplitHorizonPtrService } from "./split-horizon-ptr/split-horizon-ptr.service";
import { TECHNITIUM_NODES_TOKEN } from "./technitium.constants";
import { loadTechnitiumNodeConfigs } from "./technitium-config";
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
    CompanionDbService,
    QueryLogSqliteService,
    AdvancedBlockingService,
    BuiltInBlockingService,
    DhcpDnsSyncService,
    DhcpDnsSyncStateService,
    SplitHorizonPtrService,
    SplitHorizonPtrStateService,
    DomainListCacheService,
    DomainListPersistenceService,
    LogAlertsEmailService,
    LogAlertsEvaluatorService,
    LogAlertsRulesService,
    DomainGroupsService,
    DnsSchedulesService,
    DnsTemporaryOverridesService,
    DnsSchedulesEvaluatorService,
    NodeOverviewCacheInterceptor,
    DnsFilteringSnapshotService,
    DhcpSnapshotService,
    ZoneSnapshotService,
    ConfigSyncSchedulerService,
    {
      provide: TECHNITIUM_NODES_TOKEN,
      useFactory: (): TechnitiumNodeConfig[] => {
        const logger = new Logger("TechnitiumConfig");
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

        return loadTechnitiumNodeConfigs(process.env, logger);
      },
    },
  ],
  controllers: [
    TechnitiumController,
    AdvancedBlockingController,
    BuiltInBlockingController,
    DomainGroupsController,
    DnsSchedulesController,
    DnsTemporaryOverridesController,
    DomainListController,
    LogAlertsController,
    DhcpDnsSyncController,
    SplitHorizonPtrController,
    ConfigSyncSchedulerController,
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
