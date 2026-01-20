import { Injectable } from "@nestjs/common";

export interface HealthCheckBasic {
  status: "ok";
  timestamp: string;
  uptime: number;
}

export interface NodeHealthStatus {
  id: string;
  name: string;
  baseUrl: string;
  status: "healthy" | "unhealthy" | "unknown";
  responseTime?: number;
  error?: string;
  clusterState?: {
    initialized: boolean;
    type?: string;
    health?: string;
  };
}

export interface HealthCheckDetailed extends HealthCheckBasic {
  version: string;
  environment: string;
  nodes: {
    configured: number;
    healthy: number;
    unhealthy: number;
    details: NodeHealthStatus[];
  };
}

@Injectable()
export class AppService {
  private readonly startTime = Date.now();

  getHello(): string {
    return "Hello World!";
  }

  getBasicHealth(): HealthCheckBasic {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
