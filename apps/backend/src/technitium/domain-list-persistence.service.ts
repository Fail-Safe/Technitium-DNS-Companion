import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "fs";
import { join } from "path";
import os from "os";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { Readable, Writable } from "stream";

/**
 * Metadata for a cached list file
 */
interface CacheMetadata {
  url: string;
  hash: string;
  fetchedAt: string;
  lineCount: number;
  commentCount: number;
  domainCount?: number;
  patternCount?: number;
  etag?: string;
  lastModified?: string;
  contentLength?: number;
  errorMessage?: string;
}

/**
 * Persisted cache data
 */
interface PersistedCache {
  url: string;
  hash: string;
  fetchedAt: Date;
  lineCount: number;
  commentCount: number;
  domains?: string[]; // For regular lists
  patterns?: string[]; // For regex lists
  etag?: string;
  lastModified?: string;
  errorMessage?: string;
}

@Injectable()
export class DomainListPersistenceService {
  private readonly logger = new Logger(DomainListPersistenceService.name);
  private cacheBaseDir: string;
  private readonly useCompression = true; // Enable gzip compression

  constructor() {
    // Prefer explicit env, then project tmp, OS tmp, and finally Docker default
    const envDir = process.env.CACHE_DIR;
    const projectTmpDir = join(process.cwd(), "tmp", "domain-lists-cache");
    const osTmpDir = join(os.tmpdir(), "tdc-domain-lists-cache");
    const dockerDefaultDir = "/data/domain-lists-cache";

    this.fallbackDirs = [
      envDir,
      projectTmpDir,
      osTmpDir,
      dockerDefaultDir,
    ].filter(Boolean) as string[];

    // Pick an initial candidate for logging; initialize() will validate and adjust
    this.cacheBaseDir = this.fallbackDirs[0];
    this.logger.log(`Cache directory (preferred): ${this.cacheBaseDir}`);
  }

  private readonly fallbackDirs: string[];

  /**
   * Initialize cache directory structure
   */
  async initialize(): Promise<void> {
    for (const dir of this.fallbackDirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
        this.logger.log(`Cache directory initialized: ${dir}`);
        this.cacheBaseDir = dir; // set chosen dir
        return;
      } catch (error) {
        this.logger.warn(
          `Failed to initialize cache directory candidate ${dir}:`,
          error as Error,
        );
      }
    }

    throw new Error("Unable to initialize any cache directory");
  }

  /**
   * Get cache directory path for a specific node
   */
  private getNodeCacheDir(nodeId: string): string {
    return join(this.cacheBaseDir, nodeId);
  }

  /**
   * Get cache file paths for a specific list
   */
  private getCacheFilePaths(nodeId: string, hash: string) {
    const nodeDir = this.getNodeCacheDir(nodeId);
    const metadataFile = join(nodeDir, `${hash}.meta.json`);
    const dataFile = join(
      nodeDir,
      `${hash}.data${this.useCompression ? ".gz" : ""}`,
    );
    return { metadataFile, dataFile };
  }

  /**
   * Save list data to disk
   */
  async saveCache(
    nodeId: string,
    url: string,
    hash: string,
    domains: string[] | null,
    patterns: string[] | null,
    lineCount: number,
    commentCount: number,
    etag?: string,
    lastModified?: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const nodeDir = this.getNodeCacheDir(nodeId);
      await fs.mkdir(nodeDir, { recursive: true });

      const { metadataFile, dataFile } = this.getCacheFilePaths(nodeId, hash);

      // Save metadata
      const metadata: CacheMetadata = {
        url,
        hash,
        fetchedAt: new Date().toISOString(),
        lineCount,
        commentCount,
        domainCount: domains?.length,
        patternCount: patterns?.length,
        etag,
        lastModified,
        errorMessage,
      };

      await fs.writeFile(
        metadataFile,
        JSON.stringify(metadata, null, 2),
        "utf-8",
      );

      // Save data (compressed if enabled)
      if (domains || patterns) {
        const data = JSON.stringify({
          domains: domains || undefined,
          patterns: patterns || undefined,
        });

        if (this.useCompression) {
          // Write compressed data
          const input = Buffer.from(data, "utf-8");
          await pipeline(
            Readable.from([input]),
            createGzip(),
            createWriteStream(dataFile),
          );
        } else {
          await fs.writeFile(dataFile, data, "utf-8");
        }
      }

      this.logger.log(
        `Saved cache for ${nodeId}/${hash}: ${domains?.length || 0} domains, ${patterns?.length || 0} patterns`,
      );
    } catch (error) {
      this.logger.error(`Failed to save cache for ${nodeId}/${hash}:`, error);
      throw error;
    }
  }

  /**
   * Load list data from disk
   */
  async loadCache(
    nodeId: string,
    hash: string,
  ): Promise<PersistedCache | null> {
    try {
      const { metadataFile, dataFile } = this.getCacheFilePaths(nodeId, hash);

      // Check if files exist
      try {
        await fs.access(metadataFile);
        await fs.access(dataFile);
      } catch {
        return null; // Cache doesn't exist
      }

      // Read metadata
      const metadataJson = await fs.readFile(metadataFile, "utf-8");
      const metadata = JSON.parse(metadataJson) as CacheMetadata;

      // Read data (decompress if needed)
      let dataJson: string;
      if (this.useCompression) {
        // Read compressed data
        const chunks: Buffer[] = [];
        const collector = new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(chunk as Buffer);
            callback();
          },
        });

        await pipeline(createReadStream(dataFile), createGunzip(), collector);
        dataJson = Buffer.concat(chunks).toString("utf-8");
      } else {
        dataJson = await fs.readFile(dataFile, "utf-8");
      }

      const data = JSON.parse(dataJson) as {
        domains?: string[];
        patterns?: string[];
      };

      this.logger.log(
        `Loaded cache for ${nodeId}/${hash}: ${data.domains?.length || 0} domains, ${data.patterns?.length || 0} patterns`,
      );

      return {
        url: metadata.url,
        hash: metadata.hash,
        fetchedAt: new Date(metadata.fetchedAt),
        lineCount: metadata.lineCount,
        commentCount: metadata.commentCount,
        domains: data.domains,
        patterns: data.patterns,
        etag: metadata.etag,
        lastModified: metadata.lastModified,
        errorMessage: metadata.errorMessage,
      };
    } catch (error) {
      this.logger.error(`Failed to load cache for ${nodeId}/${hash}:`, error);
      return null;
    }
  }

  /**
   * Check if cache exists and get metadata without loading full data
   */
  async getCacheMetadata(
    nodeId: string,
    hash: string,
  ): Promise<CacheMetadata | null> {
    try {
      const { metadataFile } = this.getCacheFilePaths(nodeId, hash);

      try {
        await fs.access(metadataFile);
      } catch {
        return null; // Cache doesn't exist
      }

      const metadataJson = await fs.readFile(metadataFile, "utf-8");
      const metadata = JSON.parse(metadataJson) as CacheMetadata;
      return metadata;
    } catch (error) {
      this.logger.error(
        `Failed to get cache metadata for ${nodeId}/${hash}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Delete cache for a specific list
   */
  async deleteCache(nodeId: string, hash: string): Promise<void> {
    try {
      const { metadataFile, dataFile } = this.getCacheFilePaths(nodeId, hash);

      try {
        await fs.unlink(metadataFile);
      } catch {
        // Ignore if doesn't exist
      }

      try {
        await fs.unlink(dataFile);
      } catch {
        // Ignore if doesn't exist
      }

      this.logger.log(`Deleted cache for ${nodeId}/${hash}`);
    } catch (error) {
      this.logger.error(`Failed to delete cache for ${nodeId}/${hash}:`, error);
    }
  }

  /**
   * Delete all caches for a node
   */
  async deleteNodeCache(nodeId: string): Promise<void> {
    try {
      const nodeDir = this.getNodeCacheDir(nodeId);

      try {
        await fs.rm(nodeDir, { recursive: true, force: true });
        this.logger.log(`Deleted all caches for node ${nodeId}`);
      } catch {
        // Ignore if doesn't exist
      }
    } catch (error) {
      this.logger.error(`Failed to delete node cache for ${nodeId}:`, error);
    }
  }

  /**
   * Get all cached hashes for a node
   */
  async listNodeCaches(nodeId: string): Promise<string[]> {
    try {
      const nodeDir = this.getNodeCacheDir(nodeId);

      try {
        const files = await fs.readdir(nodeDir);
        const hashes = files
          .filter((file) => file.endsWith(".meta.json"))
          .map((file) => file.replace(".meta.json", ""));
        return hashes;
      } catch {
        return []; // Directory doesn't exist
      }
    } catch (error) {
      this.logger.error(`Failed to list caches for node ${nodeId}:`, error);
      return [];
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalNodes: number;
    totalCaches: number;
    totalSizeBytes: number;
  }> {
    try {
      let totalNodes = 0;
      let totalCaches = 0;
      let totalSizeBytes = 0;

      const nodes = await fs.readdir(this.cacheBaseDir);

      for (const nodeId of nodes) {
        const nodeDir = join(this.cacheBaseDir, nodeId);
        const stat = await fs.stat(nodeDir);

        if (stat.isDirectory()) {
          totalNodes++;
          const files = await fs.readdir(nodeDir);

          for (const file of files) {
            const filePath = join(nodeDir, file);
            const fileStat = await fs.stat(filePath);
            totalSizeBytes += fileStat.size;

            if (file.endsWith(".meta.json")) {
              totalCaches++;
            }
          }
        }
      }

      return { totalNodes, totalCaches, totalSizeBytes };
    } catch (error) {
      this.logger.error("Failed to get cache stats:", error);
      return { totalNodes: 0, totalCaches: 0, totalSizeBytes: 0 };
    }
  }

  /**
   * Clean up old caches (older than specified days)
   */
  async cleanupOldCaches(maxAgeDays: number = 30): Promise<number> {
    let deletedCount = 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const nodes = await fs.readdir(this.cacheBaseDir);

      for (const nodeId of nodes) {
        const nodeDir = join(this.cacheBaseDir, nodeId);
        const stat = await fs.stat(nodeDir);

        if (stat.isDirectory()) {
          const files = await fs.readdir(nodeDir);

          for (const file of files) {
            if (file.endsWith(".meta.json")) {
              const metadataPath = join(nodeDir, file);
              const metadataJson = await fs.readFile(metadataPath, "utf-8");
              const metadata = JSON.parse(metadataJson) as CacheMetadata;

              const fetchedAt = new Date(metadata.fetchedAt);
              if (fetchedAt < cutoffDate) {
                const hash = file.replace(".meta.json", "");
                await this.deleteCache(nodeId, hash);
                deletedCount++;
              }
            }
          }
        }
      }

      if (deletedCount > 0) {
        this.logger.log(`Cleaned up ${deletedCount} old cache entries`);
      }

      return deletedCount;
    } catch (error) {
      this.logger.error("Failed to cleanup old caches:", error);
      return deletedCount;
    }
  }
}
