/**
 * Cache Session - Manages cache entries for a team-to-team session
 */

import { Subject, Observable } from "rxjs";
import { CacheEntry, CacheEntryType, CacheEntryStatus } from "./types.js";
import { CacheEntryImpl } from "./cache-entry.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("cache:session");

/**
 * Cache session for a team pair (fromTeam→toTeam)
 * Contains multiple cache entries (spawn + tells)
 * Survives process recreation
 */
export class CacheSession {
  private entries: CacheEntry[] = [];
  private entriesSubject = new Subject<CacheEntry>();

  public entries$: Observable<CacheEntry>;

  constructor(
    public readonly sessionId: string,
    public readonly fromTeam: string,
    public readonly toTeam: string,
  ) {
    this.entries$ = this.entriesSubject.asObservable();

    logger.info("CacheSession created", {
      sessionId,
      fromTeam: fromTeam,
      toTeam,
    });
  }

  /**
   * Create new cache entry (called by Iris)
   */
  createEntry(cacheEntryType: CacheEntryType, tellString: string): CacheEntry {
    const entry = new CacheEntryImpl(cacheEntryType, tellString);
    this.entries.push(entry);
    this.entriesSubject.next(entry);

    logger.debug("CacheEntry created in session", {
      sessionId: this.sessionId,
      cacheEntryType,
      tellStringLength: tellString.length,
      totalEntries: this.entries.length,
    });

    return entry;
  }

  /**
   * Get all entries
   */
  getAllEntries(): CacheEntry[] {
    return [...this.entries]; // Return copy to prevent mutations
  }

  /**
   * Get latest entry
   */
  getLatestEntry(): CacheEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  /**
   * Get entries by type
   */
  getEntriesByType(type: CacheEntryType): CacheEntry[] {
    return this.entries.filter((e) => e.cacheEntryType === type);
  }

  /**
   * Get entries by status
   */
  getEntriesByStatus(status: CacheEntryStatus): CacheEntry[] {
    return this.entries.filter((e) => e.status === status);
  }

  /**
   * Get active entry (if any)
   */
  getActiveEntry(): CacheEntry | null {
    return (
      this.entries.find((e) => e.status === CacheEntryStatus.ACTIVE) || null
    );
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalEntries: this.entries.length,
      spawnEntries: this.getEntriesByType(CacheEntryType.SPAWN).length,
      tellEntries: this.getEntriesByType(CacheEntryType.TELL).length,
      activeEntries: this.getEntriesByStatus(CacheEntryStatus.ACTIVE).length,
      completedEntries: this.getEntriesByStatus(CacheEntryStatus.COMPLETED)
        .length,
      terminatedEntries: this.getEntriesByStatus(CacheEntryStatus.TERMINATED)
        .length,
    };
  }

  /**
   * Cleanup (called by Iris on session end)
   */
  destroy(): void {
    logger.info("CacheSession destroyed", {
      sessionId: this.sessionId,
      stats: this.getStats(),
    });

    this.entriesSubject.complete();

    // Complete all active entry observables
    for (const entry of this.entries) {
      if (entry.status === CacheEntryStatus.ACTIVE) {
        entry.complete();
      }
    }
  }
}
