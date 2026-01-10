import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import { join } from "path";

interface SplitHorizonPtrManagedZonesFile {
  version: 1;
  nodeId: string;
  sourceZoneName: string;
  updatedAt: string;
  managedReverseZones: string[];
}

@Injectable()
export class SplitHorizonPtrStateService implements OnModuleInit {
  private readonly logger = new Logger(SplitHorizonPtrStateService.name);
  private baseDir: string;
  private readonly fallbackDirs: string[];

  constructor() {
    const envDir = process.env.CACHE_DIR;
    const projectTmpDir = join(process.cwd(), "tmp", "split-horizon-ptr-state");
    const osTmpDir = join(os.tmpdir(), "tdc-split-horizon-ptr-state");
    const dockerDefaultDir = "/data/split-horizon-ptr-state";

    this.fallbackDirs = [
      envDir,
      projectTmpDir,
      osTmpDir,
      dockerDefaultDir,
    ].filter(Boolean) as string[];

    this.baseDir = this.fallbackDirs[0];
  }

  async onModuleInit(): Promise<void> {
    for (const dir of this.fallbackDirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
        this.baseDir = dir;
        this.logger.log(
          `Split Horizon PTR state directory initialized: ${dir}`,
        );
        return;
      } catch (error) {
        this.logger.warn(
          `Failed to initialize Split Horizon PTR state directory candidate ${dir}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.warn(
      "Unable to initialize any Split Horizon PTR state directory; deletions may be incomplete.",
    );
  }

  async loadManagedReverseZones(
    nodeId: string,
    sourceZoneName: string,
  ): Promise<string[]> {
    const path = this.getFilePath(nodeId, sourceZoneName);

    try {
      const data = await fs.readFile(path, "utf-8");
      const parsed = JSON.parse(
        data,
      ) as Partial<SplitHorizonPtrManagedZonesFile>;
      const zones = Array.isArray(parsed.managedReverseZones)
        ? parsed.managedReverseZones
        : [];
      return zones
        .map((z) => (z ?? "").toString().trim())
        .filter((z) => z.length > 0);
    } catch {
      return [];
    }
  }

  async mergeManagedReverseZones(
    nodeId: string,
    sourceZoneName: string,
    reverseZones: string[],
  ): Promise<void> {
    if (!this.baseDir) return;

    const cleaned = reverseZones
      .map((z) => (z ?? "").toString().trim())
      .filter((z) => z.length > 0);

    if (cleaned.length === 0) {
      return;
    }

    try {
      const dir = join(this.baseDir, nodeId);
      await fs.mkdir(dir, { recursive: true });

      const existing = await this.loadManagedReverseZones(
        nodeId,
        sourceZoneName,
      );
      const merged = Array.from(
        new Set([...existing, ...cleaned].map((z) => z.toLowerCase())),
      ).sort((a, b) => a.localeCompare(b));

      const payload: SplitHorizonPtrManagedZonesFile = {
        version: 1,
        nodeId,
        sourceZoneName,
        updatedAt: new Date().toISOString(),
        managedReverseZones: merged,
      };

      await fs.writeFile(
        this.getFilePath(nodeId, sourceZoneName),
        JSON.stringify(payload, null, 2),
        "utf-8",
      );
    } catch (error) {
      this.logger.warn(
        `Failed to persist Split Horizon PTR managed zones state for node ${nodeId} source zone ${sourceZoneName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getFilePath(nodeId: string, sourceZoneName: string): string {
    const hash = createHash("sha256")
      .update(`${nodeId}::${sourceZoneName}`)
      .digest("hex")
      .slice(0, 24);
    return join(this.baseDir, nodeId, `${hash}.json`);
  }
}
