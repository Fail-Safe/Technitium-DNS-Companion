import { Injectable, Logger } from "@nestjs/common";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

/**
 * Simple in-memory cache with TTL (Time To Live).
 *
 * Usage:
 *   const cache = new QueryLogCache(30000); // 30 second TTL
 *   cache.set('key', data);
 *   const result = cache.get('key'); // returns data or undefined if expired/missing
 */
@Injectable()
export class QueryLogCache<T = unknown> {
  private readonly logger = new Logger(QueryLogCache.name);
  private cache = new Map<string, CacheEntry<T>>();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(
    private readonly ttlMs: number = 30000, // Default 30 seconds
  ) {
    this.logger.log(
      `Initialized with TTL: ${ttlMs}ms (${(ttlMs / 1000).toFixed(1)}s)`,
    );
  }

  /**
   * Get value from cache. Returns undefined if not found or expired.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.logger.debug(`Cache MISS: ${key} (not found)`);
      return undefined;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      // Expired - remove it
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      this.logger.debug(`Cache MISS: ${key} (expired)`);
      return undefined;
    }

    this.stats.hits++;
    const age = now - (entry.expiresAt - this.ttlMs);
    this.logger.debug(`Cache HIT: ${key} (age: ${age}ms)`);
    return entry.value;
  }

  /**
   * Set value in cache with TTL.
   */
  set(key: string, value: T): void {
    const expiresAt = Date.now() + this.ttlMs;
    this.cache.set(key, { value, expiresAt });
    this.logger.debug(`Cache SET: ${key} (expires in ${this.ttlMs}ms)`);
  }

  /**
   * Check if key exists and is not expired.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }

    return true;
  }

  /**
   * Delete a specific key.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log(`Cache cleared (${size} entries removed)`);
  }

  /**
   * Remove all expired entries (garbage collection).
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.stats.evictions += removed;
      this.logger.debug(`Pruned ${removed} expired entries`);
    }

    return removed;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    // Prune expired entries before calculating size
    this.prune();

    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    this.logger.log(
      `Cache stats: ${this.stats.hits} hits, ${this.stats.misses} misses, ` +
        `${hitRate.toFixed(1)}% hit rate, ${this.cache.size} entries, ` +
        `${this.stats.evictions} evictions`,
    );

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
    this.logger.log("Cache statistics reset");
  }

  /**
   * Get cache size (number of entries, including expired).
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get hit rate as percentage (0-100).
   */
  get hitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? (this.stats.hits / total) * 100 : 0;
  }
}
