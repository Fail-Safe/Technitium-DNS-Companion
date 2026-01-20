import { Controller, Get, Logger, Query } from "@nestjs/common";
import { AppService } from "./app.service";
import { Public } from "./auth/public.decorator";
import { TechnitiumService } from "./technitium/technitium.service";
import type {
  HealthCheckBasic,
  HealthCheckDetailed,
  NodeHealthStatus,
} from "./app.service";

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly technitiumService: TechnitiumService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("health")
  @Public()
  async getHealth(
    @Query("detailed") detailed?: string,
  ): Promise<HealthCheckBasic | HealthCheckDetailed> {
    // Basic health check (fast, for Docker health checks)
    if (detailed !== "true") {
      return this.appService.getBasicHealth();
    }

    // Detailed health check with node connectivity status
    const basicHealth = this.appService.getBasicHealth();
    const nodeStatuses: NodeHealthStatus[] = [];

    try {
      const nodes = await this.technitiumService.listNodes();

      // Check health of each configured node
      const healthChecks = await Promise.allSettled(
        nodes.map(async (node) => {
          const startTime = Date.now();
          try {
            // Perform a lightweight API call to check node health
            await this.technitiumService.getNodeStatus(node.id);
            const responseTime = Date.now() - startTime;

            return {
              id: node.id,
              name: node.name || node.id,
              baseUrl: node.baseUrl,
              status: "healthy" as const,
              responseTime,
              clusterState: node.clusterState
                ? {
                    initialized: node.clusterState.initialized,
                    type: node.clusterState.type,
                    health: node.clusterState.health,
                  }
                : undefined,
            };
          } catch (error) {
            const responseTime = Date.now() - startTime;
            return {
              id: node.id,
              name: node.name || node.id,
              baseUrl: node.baseUrl,
              status: "unhealthy" as const,
              responseTime,
              error: error instanceof Error ? error.message : "Unknown error",
              clusterState: node.clusterState
                ? {
                    initialized: node.clusterState.initialized,
                    type: node.clusterState.type,
                    health: node.clusterState.health,
                  }
                : undefined,
            };
          }
        }),
      );

      // Collect node health results
      healthChecks.forEach((result) => {
        if (result.status === "fulfilled") {
          nodeStatuses.push(result.value);
        } else {
          // Handle unexpected promise rejection
          this.logger.error(
            `Unexpected error checking node health: ${result.reason}`,
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch nodes for detailed health check: ${error}`,
      );
    }

    const healthyCount = nodeStatuses.filter(
      (n) => n.status === "healthy",
    ).length;
    const unhealthyCount = nodeStatuses.filter(
      (n) => n.status === "unhealthy",
    ).length;

    // Read version from package.json at runtime for accurate production version
    let version = "unknown";
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const packageJson = require("../../package.json");
      version = packageJson.version || "unknown";
    } catch {
      // Fallback to unknown if package.json can't be read
      version = "unknown";
    }

    return {
      ...basicHealth,
      version,
      environment: process.env.NODE_ENV || "development",
      nodes: {
        configured: nodeStatuses.length,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        details: nodeStatuses,
      },
    };
  }
}
