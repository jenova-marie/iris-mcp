/**
 * Session Store - SQLite database wrapper for team-to-team sessions
 *
 * Manages persistent storage of session metadata including UUIDs, timestamps,
 * and usage statistics for team pair conversations.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { Logger } from "../utils/logger.js";
import { getSessionDbPath } from "../utils/paths.js";
import type {
  SessionInfo,
  SessionRow,
  SessionFilters,
  SessionStatus,
} from "./types.js";

const logger = new Logger("session-store");

/**
 * SQLite-based session storage
 */
export class SessionStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    // Use provided path or default to $IRIS_HOME/data/team-sessions.db (or ~/.iris/data/team-sessions.db)
    const absoluteDbPath = dbPath ? resolve(dbPath) : getSessionDbPath();

    // Ensure data directory exists
    const dataDir = dirname(absoluteDbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Open database
    this.db = new Database(absoluteDbPath);
    this.db.pragma("journal_mode = WAL");

    // Initialize schema
    this.initializeSchema();

    logger.info("Session store initialized", { dbPath: absoluteDbPath });
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_team TEXT,
        to_team TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        process_state TEXT DEFAULT 'stopped',
        current_cache_session_id TEXT,
        last_response_at INTEGER,
        UNIQUE(from_team, to_team)
      );

      CREATE INDEX IF NOT EXISTS idx_team_sessions_from_to
        ON team_sessions(from_team, to_team);

      CREATE INDEX IF NOT EXISTS idx_team_sessions_session_id
        ON team_sessions(session_id);

      CREATE INDEX IF NOT EXISTS idx_team_sessions_status
        ON team_sessions(status);
    `);

    // Migration: Add new columns if they don't exist (for existing databases)
    this.migrateSchema();

    logger.debug("Schema initialized");
  }

  /**
   * Migrate schema for existing databases
   */
  private migrateSchema(): void {
    try {
      // Check if process_state column exists
      const columns = this.db
        .prepare("PRAGMA table_info(team_sessions)")
        .all() as any[];

      const hasProcessState = columns.some(col => col.name === "process_state");
      const hasCurrentCacheSessionId = columns.some(col => col.name === "current_cache_session_id");
      const hasLastResponseAt = columns.some(col => col.name === "last_response_at");

      if (!hasProcessState) {
        logger.info("Migrating: Adding process_state column");
        this.db.exec("ALTER TABLE team_sessions ADD COLUMN process_state TEXT DEFAULT 'stopped'");
      }

      if (!hasCurrentCacheSessionId) {
        logger.info("Migrating: Adding current_cache_session_id column");
        this.db.exec("ALTER TABLE team_sessions ADD COLUMN current_cache_session_id TEXT");
      }

      if (!hasLastResponseAt) {
        logger.info("Migrating: Adding last_response_at column");
        this.db.exec("ALTER TABLE team_sessions ADD COLUMN last_response_at INTEGER");
      }
    } catch (error) {
      logger.error("Schema migration failed", error);
      throw error;
    }
  }

  /**
   * Convert database row to SessionInfo
   */
  private rowToSessionInfo(row: SessionRow): SessionInfo {
    return {
      id: row.id,
      fromTeam: row.from_team,
      toTeam: row.to_team,
      sessionId: row.session_id,
      createdAt: new Date(row.created_at),
      lastUsedAt: new Date(row.last_used_at),
      messageCount: row.message_count,
      status: row.status,
      // NEW: Process state fields
      processState: row.process_state,
      currentCacheSessionId: row.current_cache_session_id,
      lastResponseAt: row.last_response_at,
    };
  }

  /**
   * Create a new session record
   */
  create(
    fromTeam: string,
    toTeam: string,
    sessionId: string,
  ): SessionInfo {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO team_sessions (
        from_team, to_team, session_id, created_at, last_used_at, message_count, status,
        process_state, current_cache_session_id, last_response_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'active', 'stopped', NULL, NULL)
    `);

    const result = stmt.run(fromTeam, toTeam, sessionId, now, now);

    logger.info("Session created", {
      fromTeam,
      toTeam,
      sessionId,
      id: result.lastInsertRowid,
    });

    return this.rowToSessionInfo({
      id: Number(result.lastInsertRowid),
      from_team: fromTeam,
      to_team: toTeam,
      session_id: sessionId,
      created_at: now,
      last_used_at: now,
      message_count: 0,
      status: "active",
      process_state: "stopped",
      current_cache_session_id: null,
      last_response_at: null,
    });
  }

  /**
   * Get session by team pair
   */
  getByTeamPair(
    fromTeam: string,
    toTeam: string,
  ): SessionInfo | null {
    const stmt = this.db.prepare(`
      SELECT * FROM team_sessions
      WHERE from_team = ? AND to_team = ?
    `);

    const row = stmt.get(fromTeam, toTeam) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return this.rowToSessionInfo(row);
  }

  /**
   * Get session by session ID
   */
  getBySessionId(sessionId: string): SessionInfo | null {
    const stmt = this.db.prepare(`
      SELECT * FROM team_sessions
      WHERE session_id = ?
    `);

    const row = stmt.get(sessionId) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return this.rowToSessionInfo(row);
  }

  /**
   * List sessions with optional filters
   */
  list(filters?: SessionFilters): SessionInfo[] {
    let query = "SELECT * FROM team_sessions WHERE 1=1";
    const params: any[] = [];

    if (filters?.fromTeam !== undefined) {
      query += " AND from_team = ?";
      params.push(filters.fromTeam);
    }

    if (filters?.toTeam) {
      query += " AND to_team = ?";
      params.push(filters.toTeam);
    }

    if (filters?.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    if (filters?.createdAfter) {
      query += " AND created_at > ?";
      params.push(filters.createdAfter.getTime());
    }

    if (filters?.usedAfter) {
      query += " AND last_used_at > ?";
      params.push(filters.usedAfter.getTime());
    }

    query += " ORDER BY last_used_at DESC";

    if (filters?.limit) {
      query += " LIMIT ?";
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as SessionRow[];

    return rows.map((row) => this.rowToSessionInfo(row));
  }

  /**
   * Update session's last used timestamp
   */
  updateLastUsed(sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET last_used_at = ?
      WHERE session_id = ?
    `);

    stmt.run(Date.now(), sessionId);

    logger.debug("Updated last used timestamp", { sessionId });
  }

  /**
   * Increment message count for a session
   */
  incrementMessageCount(sessionId: string, count = 1): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET message_count = message_count + ?
      WHERE session_id = ?
    `);

    stmt.run(count, sessionId);

    logger.debug("Incremented message count", { sessionId, count });
  }

  /**
   * Reset message count for a session
   */
  resetMessageCount(sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET message_count = 0
      WHERE session_id = ?
    `);

    stmt.run(sessionId);

    logger.debug("Reset message count", { sessionId });
  }

  /**
   * Update session status
   */
  updateStatus(sessionId: string, status: SessionStatus): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET status = ?
      WHERE session_id = ?
    `);

    stmt.run(status, sessionId);

    logger.info("Updated session status", { sessionId, status });
  }

  /**
   * Delete a session record
   */
  delete(sessionId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM team_sessions
      WHERE session_id = ?
    `);

    stmt.run(sessionId);

    logger.info("Session deleted", { sessionId });
  }

  /**
   * Delete sessions by team pair
   */
  deleteByTeamPair(fromTeam: string, toTeam: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM team_sessions
      WHERE from_team = ? AND to_team = ?
    `);

    stmt.run(fromTeam, toTeam);

    logger.info("Sessions deleted for team pair", { fromTeam, toTeam });
  }

  /**
   * Get session count statistics
   */
  getStats(): {
    total: number;
    active: number;
    archived: number;
    totalMessages: number;
  } {
    const row = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived,
        SUM(message_count) as total_messages
      FROM team_sessions
    `,
      )
      .get() as any;

    return {
      total: row.total || 0,
      active: row.active || 0,
      archived: row.archived || 0,
      totalMessages: row.total_messages || 0,
    };
  }

  /**
   * Execute operations in a transaction
   * Provides atomic batch operations
   */
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Batch create multiple sessions
   */
  createBatch(
    sessions: Array<{
      fromTeam: string;
      toTeam: string;
      sessionId: string;
    }>,
  ): SessionInfo[] {
    return this.transaction(() => {
      const results: SessionInfo[] = [];
      for (const session of sessions) {
        const info = this.create(
          session.fromTeam,
          session.toTeam,
          session.sessionId,
        );
        results.push(info);
      }
      return results;
    });
  }

  /**
   * Batch update session status
   */
  updateStatusBatch(
    updates: Array<{ sessionId: string; status: SessionStatus }>,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET status = ?
      WHERE session_id = ?
    `);

    this.transaction(() => {
      for (const update of updates) {
        stmt.run(update.status, update.sessionId);
      }
    });

    logger.info("Batch updated session statuses", { count: updates.length });
  }

  /**
   * Update process state
   */
  updateProcessState(sessionId: string, processState: string): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET process_state = ?
      WHERE session_id = ?
    `);

    stmt.run(processState, sessionId);

    logger.debug("Updated process state", { sessionId, processState });
  }

  /**
   * Set current cache session ID
   */
  setCurrentCacheSessionId(
    sessionId: string,
    cacheSessionId: string | null,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET current_cache_session_id = ?
      WHERE session_id = ?
    `);

    stmt.run(cacheSessionId, sessionId);

    logger.debug("Updated current cache session ID", {
      sessionId,
      cacheSessionId,
    });
  }

  /**
   * Update last response timestamp
   */
  updateLastResponse(sessionId: string, timestamp: number): void {
    const stmt = this.db.prepare(`
      UPDATE team_sessions
      SET last_response_at = ?
      WHERE session_id = ?
    `);

    stmt.run(timestamp, sessionId);

    logger.debug("Updated last response timestamp", { sessionId, timestamp });
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info("Session store closed");
  }
}
