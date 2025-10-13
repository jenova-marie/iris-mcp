/**
 * Cache Manager - Manages all cache sessions
 */

import { CacheSession } from "./cache-session.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("cache-manager");

/**
 * Manages all cache sessions (one per fromTeam→toTeam pair)
 * Top-level cache coordinator
 */
export class CacheManager {
  private sessions = new Map<string, CacheSession>();

  /**
   * Create new cache session (called by Iris)
   */
  createSession(
    sessionId: string,
    fromTeam: string | null,
    toTeam: string,
  ): CacheSession {
    if (this.sessions.has(sessionId)) {
      logger.warn("CacheSession already exists, returning existing", {
        sessionId,
      });
      return this.sessions.get(sessionId)!;
    }

    const session = new CacheSession(sessionId, fromTeam, toTeam);
    this.sessions.set(sessionId, session);

    logger.info("CacheSession created in manager", {
      sessionId,
      fromTeam: fromTeam || "external",
      toTeam,
      totalSessions: this.sessions.size,
    });

    return session;
  }

  /**
   * Get cache session by ID
   */
  getSession(sessionId: string): CacheSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): CacheSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Delete cache session (available but not currently used)
   */
  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.destroy();
      this.sessions.delete(sessionId);

      logger.info("CacheSession deleted", {
        sessionId,
        remainingSessions: this.sessions.size,
      });
    } else {
      logger.warn("Attempted to delete non-existent CacheSession", {
        sessionId,
      });
    }
  }

  /**
   * Get aggregate stats across all sessions
   */
  getStats() {
    const allSessions = this.getAllSessions();

    return {
      totalSessions: this.sessions.size,
      totalEntries: allSessions.reduce((sum, s) => {
        return sum + s.getAllEntries().length;
      }, 0),
      sessionStats: allSessions.map((s) => ({
        sessionId: s.sessionId,
        fromTeam: s.fromTeam,
        toTeam: s.toTeam,
        ...s.getStats(),
      })),
    };
  }

  /**
   * Cleanup all sessions
   */
  destroyAll(): void {
    logger.info("Destroying all cache sessions", {
      totalSessions: this.sessions.size,
    });

    for (const session of this.sessions.values()) {
      session.destroy();
    }

    this.sessions.clear();
  }
}
