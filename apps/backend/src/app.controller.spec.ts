import { Test, TestingModule } from "@nestjs/testing";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { TechnitiumService } from "./technitium/technitium.service";
import type { TechnitiumNodeSummary } from "./technitium/technitium.types";

describe("AppController", () => {
  let appController: AppController;
  let technitiumService: TechnitiumService;

  beforeEach(async () => {
    const mockTechnitiumService = {
      listNodes: jest.fn(),
      getNodeStatus: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: TechnitiumService,
          useValue: mockTechnitiumService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    technitiumService = app.get<TechnitiumService>(TechnitiumService);
  });

  describe("root", () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe("Hello World!");
    });
  });

  describe("health check", () => {
    it("should return basic health status", () => {
      const result = appController.getHealth();

      expect(result).toHaveProperty("status", "ok");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("uptime");
      expect(result).not.toHaveProperty("nodes");
    });

    it("should return detailed health status", async () => {
      const mockNodes: TechnitiumNodeSummary[] = [
        {
          id: "node1",
          name: "DNS Primary",
          baseUrl: "http://localhost:5380",
          clusterState: {
            initialized: false,
            type: "Standalone",
          },
        },
      ];

      jest.spyOn(technitiumService, "listNodes").mockResolvedValue(mockNodes);
      jest.spyOn(technitiumService, "getNodeStatus").mockResolvedValue({
        nodeId: "node1",
        fetchedAt: new Date().toISOString(),
        data: { status: "ok" },
      });

      const result = await appController.getHealthDetailed();

      expect(result).toHaveProperty("status", "ok");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("uptime");
      expect(result).toHaveProperty("version");
      expect(result).toHaveProperty("environment");
      expect(result).toHaveProperty("nodes");

      expect(result.nodes.configured).toBe(1);
      expect(result.nodes.healthy).toBe(1);
      expect(result.nodes.unhealthy).toBe(0);
      expect(result.nodes.details).toHaveLength(1);
      expect(result.nodes.details[0]).toMatchObject({
        id: "node1",
        name: "DNS Primary",
        baseUrl: "http://localhost:5380",
        status: "healthy",
      });
    });

    it("should mark nodes as unhealthy when status check fails", async () => {
      const mockNodes: TechnitiumNodeSummary[] = [
        {
          id: "node1",
          name: "DNS Primary",
          baseUrl: "http://localhost:5380",
          clusterState: {
            initialized: false,
            type: "Standalone",
          },
        },
      ];

      jest.spyOn(technitiumService, "listNodes").mockResolvedValue(mockNodes);
      jest
        .spyOn(technitiumService, "getNodeStatus")
        .mockRejectedValue(new Error("Connection timeout"));

      const result = await appController.getHealthDetailed();

      expect(result.nodes.configured).toBe(1);
      expect(result.nodes.healthy).toBe(0);
      expect(result.nodes.unhealthy).toBe(1);
      expect(result.nodes.details[0]).toMatchObject({
        id: "node1",
        status: "unhealthy",
        error: "Connection timeout",
      });
    });

    it("should handle empty node list gracefully", async () => {
      jest.spyOn(technitiumService, "listNodes").mockResolvedValue([]);

      const result = await appController.getHealthDetailed();

      expect(result.nodes.configured).toBe(0);
      expect(result.nodes.healthy).toBe(0);
      expect(result.nodes.unhealthy).toBe(0);
      expect(result.nodes.details).toHaveLength(0);
    });

    it("should handle error fetching nodes gracefully", async () => {
      jest
        .spyOn(technitiumService, "listNodes")
        .mockRejectedValue(new Error("Failed to fetch nodes"));

      const result = await appController.getHealthDetailed();

      // Should still return health data, just with empty nodes
      expect(result).toHaveProperty("status", "ok");
      expect(result.nodes.configured).toBe(0);
    });
  });
});
