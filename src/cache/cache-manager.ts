/**
 * Cache Manager - Manages all message caches
 *
 * NOTE: "MessageCache" = in-memory message storage (not SessionInfo)
 */

import { MessageCache } from "./message-cache.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("cache:manager");

/**
 * Manages all message caches (one per sessionId)
 * Top-level cache coordinator
 *
 * Each MessageCache links to a SessionInfo via sessionId
 */
export class CacheManager {
  private caches = new Map<string, MessageCache>();

  /**
   * Get or create message cache for a session (called by Iris)
   * NOTE: Renamed from createSession to be explicit about what it does
   */
  getOrCreateCache(
    sessionId: string,
    fromTeam: string,
    toTeam: string,
  ): MessageCache {
    if (this.caches.has(sessionId)) {
      logger.debug({
        sessionId,
      }, "MessageCache already exists, returning existing");
      return this.caches.get(sessionId)!;
    }

    const cache = new MessageCache(sessionId, fromTeam, toTeam);
    this.caches.set(sessionId, cache);

    logger.info({
      sessionId,
      fromTeam,
      toTeam,
      totalCaches: this.caches.size,
    }, "MessageCache created in manager");

    return cache;
  }

  /**
   * Get message cache by session ID
   */
  getCache(sessionId: string): MessageCache | null {
    return this.caches.get(sessionId) ?? null;
  }

  /**
   * Get all message caches
   */
  getAllCaches(): MessageCache[] {
    return Array.from(this.caches.values());
  }

  /**
   * Delete message cache (available but not currently used)
   */
  deleteCache(sessionId: string): void {
    const cache = this.caches.get(sessionId);
    if (cache) {
      cache.destroy();
      this.caches.delete(sessionId);

      logger.info({
        sessionId,
        remainingCaches: this.caches.size,
      }, "MessageCache deleted");
    } else {
      logger.warn({
        sessionId,
      }, "Attempted to delete non-existent MessageCache");
    }
  }

  /**
   * Get aggregate stats across all caches
   */
  getStats() {
    const allCaches = this.getAllCaches();

    return {
      totalCaches: this.caches.size,
      totalEntries: allCaches.reduce((sum, c) => {
        return sum + c.getAllEntries().length;
      }, 0),
      cacheStats: allCaches.map((c) => ({
        sessionId: c.sessionId,
        fromTeam: c.fromTeam,
        toTeam: c.toTeam,
        ...c.getStats(),
      })),
    };
  }

  /**
   * Cleanup all message caches
   */
  destroyAll(): void {
    logger.info({
      totalCaches: this.caches.size,
    }, "Destroying all message caches");

    for (const cache of this.caches.values()) {
      cache.destroy();
    }

    this.caches.clear();
  }
}
