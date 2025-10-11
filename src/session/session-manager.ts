/**
 * Session Manager - Orchestrates team-to-team session lifecycle
 *
 * Manages creation, discovery, and tracking of persistent Claude Code sessions
 * for team pair communications.
 */

import type { TeamsConfig, TeamConfig } from "../process-pool/types.js";
import { ClaudeProcess } from "../process-pool/claude-process.js";
import { Logger } from "../utils/logger.js";
import {
  ConfigurationError,
  ProcessError,
} from "../utils/errors.js";
import { SessionStore } from "./session-store.js";
import {
  validateProjectPath,
  getSessionFilePath,
  listTeamSessions,
} from "./path-utils.js";
import {
  validateSessionId,
  validateSecureProjectPath,
  validateTeamName,
  generateSecureUUID,
  validateUUID,
} from "./validation.js";
import type {
  SessionInfo,
  SessionFilters,
  CreateSessionOptions,
} from "./types.js";

const logger = new Logger("session-manager");

/**
 * Manages persistent team-to-team sessions
 */
export class SessionManager {
  private store: SessionStore;
  private teamsConfig: TeamsConfig;
  private initialized = false;
  private sessionCache = new Map<string, SessionInfo>();
  private cacheMaxAge = 60000; // 1 minute cache TTL
  private cacheTimestamps = new Map<string, number>();

  constructor(teamsConfig: TeamsConfig, dbPath?: string) {
    this.teamsConfig = teamsConfig;
    this.store = new SessionStore(dbPath);
  }

  /**
   * Initialize session manager
   * - Validates team project paths
   * - Discovers existing sessions
   * - Syncs database with filesystem
   * - Pre-initializes sessions for all teams (CRITICAL)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("Already initialized");
      return;
    }

    logger.info("Initializing session manager");

    // Validate all team project paths
    for (const [teamName, teamConfig] of Object.entries(
      this.teamsConfig.teams,
    )) {
      try {
        validateTeamName(teamName);
        const projectPath = this.getProjectPath(teamConfig);
        validateSecureProjectPath(projectPath);
        logger.debug("Validated team project path", { teamName, projectPath });
      } catch (error) {
        throw new ConfigurationError(
          `Invalid configuration for team '${teamName}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // PRE-INITIALIZE ALL TEAM SESSIONS
    logger.info("Pre-initializing team sessions");

    for (const [teamName, teamConfig] of Object.entries(
      this.teamsConfig.teams,
    )) {
      try {
        logger.info("Processing team for session initialization", {
          teamName,
        });
        const projectPath = this.getProjectPath(teamConfig);

        // Check if session exists for (null, teamName) - external→team sessions
        const existing = this.store.getByTeamPair(null, teamName);

        if (existing) {
          // Verify session file exists
          const sessionFilePath = getSessionFilePath(
            projectPath,
            existing.sessionId,
          );
          const { existsSync } = await import("fs");

          if (existsSync(sessionFilePath)) {
            logger.info("Session file already exists and valid, skipping", {
              teamName,
              sessionId: existing.sessionId,
              filePath: sessionFilePath,
            });
            continue;
          }

          // Session in DB but file missing - MUST create NEW session with NEW UUID
          // Cannot reuse old UUID with --session-id (UUID is "burned")
          logger.warn("Session file missing, creating new session", {
            teamName,
            oldSessionId: existing.sessionId,
          });

          // Generate fresh UUID
          const newSessionId = generateSecureUUID();

          // Create new session file with new UUID using ClaudeProcess static method
          await ClaudeProcess.initializeSessionFile(
            teamConfig,
            newSessionId,
            this.teamsConfig.settings.sessionInitTimeout,
          );

          // Delete old database entry
          this.store.delete(existing.sessionId);

          // Store new session in database
          this.store.create(null, teamName, newSessionId);

          logger.info("New session created to replace missing file", {
            teamName,
            oldSessionId: existing.sessionId,
            newSessionId,
          });
        } else {
          // No session in database - create new one
          logger.info("No session in database, creating initial session", {
            teamName,
          });

          const sessionId = generateSecureUUID();
          // Create session file using ClaudeProcess static method
          await ClaudeProcess.initializeSessionFile(
            teamConfig,
            sessionId,
            this.teamsConfig.settings.sessionInitTimeout,
          );

          // Store in database
          this.store.create(null, teamName, sessionId);

          logger.info("Initial session created", { teamName, sessionId });
        }
      } catch (error) {
        logger.error("Failed to initialize session for team", {
          teamName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ConfigurationError(
          `Failed to initialize team '${teamName}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.initialized = true;
    logger.info("Session manager initialized with all team sessions ready");
  }

  /**
   * Get project path from team config
   */
  private getProjectPath(teamConfig: TeamConfig): string {
    return teamConfig.path;
  }

  /**
   * Get or create session for team pair
   */
  async getOrCreateSession(
    fromTeam: string | null,
    toTeam: string,
  ): Promise<SessionInfo> {
    this.ensureInitialized();

    // Validate toTeam exists
    if (!this.teamsConfig.teams[toTeam]) {
      throw new ConfigurationError(`Unknown team: ${toTeam}`);
    }

    // Validate fromTeam if provided
    if (fromTeam && !this.teamsConfig.teams[fromTeam]) {
      throw new ConfigurationError(`Unknown team: ${fromTeam}`);
    }

    // Check if session already exists
    const existing = this.store.getByTeamPair(fromTeam, toTeam);

    if (existing) {
      logger.debug("Using existing session", {
        fromTeam,
        toTeam,
        sessionId: existing.sessionId,
      });
      return existing;
    }

    // Create new session
    return await this.createSession(fromTeam, toTeam);
  }

  /**
   * Create a new session for team pair
   */
  async createSession(
    fromTeam: string | null,
    toTeam: string,
    options?: CreateSessionOptions,
  ): Promise<SessionInfo> {
    this.ensureInitialized();

    // Validate teams
    validateTeamName(toTeam);
    if (fromTeam) {
      validateTeamName(fromTeam);
    }

    const teamConfig = this.teamsConfig.teams[toTeam];
    if (!teamConfig) {
      throw new ConfigurationError(`Unknown team: ${toTeam}`);
    }

    const projectPath = this.getProjectPath(teamConfig);
    const sessionId = generateSecureUUID();

    logger.info("Creating new session", {
      fromTeam,
      toTeam,
      sessionId,
      projectPath,
    });

    try {
      // Initialize the session file using ClaudeProcess static method
      const teamConfig = this.teamsConfig.teams[toTeam];
      const sessionInitTimeout =
        teamConfig.sessionInitTimeout ??
        this.teamsConfig.settings.sessionInitTimeout;

      await ClaudeProcess.initializeSessionFile(
        teamConfig,
        sessionId,
        sessionInitTimeout,
      );

      // Store in database
      const sessionInfo = this.store.create(fromTeam, toTeam, sessionId);

      // Update cache
      const cacheKey = this.getCacheKey(fromTeam, toTeam);
      this.sessionCache.set(cacheKey, sessionInfo);
      this.cacheTimestamps.set(cacheKey, Date.now());

      logger.info("Session created successfully", {
        fromTeam,
        toTeam,
        sessionId,
      });

      return sessionInfo;
    } catch (error) {
      logger.error("Failed to create session", {
        fromTeam,
        toTeam,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new ProcessError(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
        toTeam,
      );
    }
  }

  /**
   * Generate cache key for team pair
   */
  private getCacheKey(fromTeam: string | null, toTeam: string): string {
    return `${fromTeam ?? "external"}->${toTeam}`;
  }

  /**
   * Check if cached item is still valid
   */
  private isCacheValid(key: string): boolean {
    const timestamp = this.cacheTimestamps.get(key);
    if (!timestamp) return false;
    return Date.now() - timestamp < this.cacheMaxAge;
  }

  /**
   * Get session for team pair (does not create)
   */
  getSession(fromTeam: string | null, toTeam: string): SessionInfo | null {
    this.ensureInitialized();

    // Check cache first
    const cacheKey = this.getCacheKey(fromTeam, toTeam);
    const cached = this.sessionCache.get(cacheKey);

    if (cached && this.isCacheValid(cacheKey)) {
      logger.debug("Session cache hit", { fromTeam, toTeam });
      return cached;
    }

    // Cache miss - fetch from database
    const session = this.store.getByTeamPair(fromTeam, toTeam);

    if (session) {
      // Update cache
      this.sessionCache.set(cacheKey, session);
      this.cacheTimestamps.set(cacheKey, Date.now());
    }

    return session;
  }

  /**
   * Get session by session ID
   */
  getSessionById(sessionId: string): SessionInfo | null {
    this.ensureInitialized();
    return this.store.getBySessionId(sessionId);
  }

  /**
   * List sessions with filters
   */
  listSessions(filters?: SessionFilters): SessionInfo[] {
    this.ensureInitialized();
    return this.store.list(filters);
  }

  /**
   * Invalidate cache for a session
   */
  private invalidateCache(fromTeam: string | null, toTeam: string): void {
    const cacheKey = this.getCacheKey(fromTeam, toTeam);
    this.sessionCache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.sessionCache.clear();
    this.cacheTimestamps.clear();
    logger.debug("Session cache cleared");
  }

  /**
   * Record session usage (update last_used_at)
   */
  recordUsage(sessionId: string): void {
    this.ensureInitialized();
    this.store.updateLastUsed(sessionId);

    // Invalidate cache for this session
    const session = this.store.getBySessionId(sessionId);
    if (session) {
      this.invalidateCache(session.fromTeam, session.toTeam);
    }
  }

  /**
   * Increment message count for session
   */
  incrementMessageCount(sessionId: string, count = 1): void {
    this.ensureInitialized();
    this.store.incrementMessageCount(sessionId, count);

    // Invalidate cache for this session
    const session = this.store.getBySessionId(sessionId);
    if (session) {
      this.invalidateCache(session.fromTeam, session.toTeam);
    }
  }

  /**
   * Delete session (database and optionally filesystem)
   */
  async deleteSession(sessionId: string, deleteFile = false): Promise<void> {
    this.ensureInitialized();

    const session = this.store.getBySessionId(sessionId);
    if (!session) {
      logger.warn("Attempted to delete non-existent session", { sessionId });
      return;
    }

    // Delete from database
    this.store.delete(sessionId);

    // Optionally delete session file
    if (deleteFile) {
      const teamConfig = this.teamsConfig.teams[session.toTeam];
      if (teamConfig) {
        const projectPath = this.getProjectPath(teamConfig);
        const filePath = getSessionFilePath(projectPath, sessionId);

        try {
          const fs = await import("fs/promises");
          await fs.unlink(filePath);
          logger.info("Deleted session file", { sessionId, filePath });
        } catch (error) {
          logger.warn("Failed to delete session file", {
            sessionId,
            filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * Compact a session to reduce context size
   * Updates database metadata only - caller must send /compact command to process if needed
   *
   * NOTE: This method only updates session metadata. To actually compact a running process,
   * the caller should use PoolManager.sendCommandToSession(sessionId, "/compact").
   */
  async compactSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    const session = this.store.getBySessionId(sessionId);
    if (!session) {
      logger.warn("Attempted to compact non-existent session", { sessionId });
      return;
    }

    logger.info("Compacting session metadata", {
      sessionId,
      fromTeam: session.fromTeam,
      toTeam: session.toTeam,
      messageCount: session.messageCount,
    });

    // Mark as compacting
    this.store.updateStatus(sessionId, "compacting");
    this.invalidateCache(session.fromTeam, session.toTeam);

    try {
      // Reset message count and update status
      this.store.resetMessageCount(sessionId);
      this.store.updateStatus(sessionId, "active");

      logger.info("Session metadata compaction completed", { sessionId });
    } catch (error) {
      logger.error("Session compaction failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Mark as error state
      this.store.updateStatus(sessionId, "error");
      this.invalidateCache(session.fromTeam, session.toTeam);

      throw new ProcessError(
        `Failed to compact session: ${error instanceof Error ? error.message : String(error)}`,
        session.toTeam,
      );
    }
  }

  /**
   * Check if a session should be compacted based on message count and age
   */
  shouldCompactSession(session: SessionInfo): boolean {
    const HIGH_MESSAGE_THRESHOLD = 500;
    const AGE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    const age = Date.now() - session.createdAt.getTime();
    return (
      session.messageCount > HIGH_MESSAGE_THRESHOLD ||
      (session.messageCount > 100 && age > AGE_THRESHOLD_MS)
    );
  }

  /**
   * Get session statistics
   */
  getStats() {
    this.ensureInitialized();
    return this.store.getStats();
  }

  /**
   * Reset session manager to initialized state
   * Clears internal caches and state but preserves database and session files
   * Useful for testing to reset to a known initialized state
   */
  reset(): void {
    if (!this.initialized) {
      logger.warn("Attempting to reset uninitialized SessionManager");
      return;
    }

    logger.info("Resetting SessionManager to clean initialized state");

    // Clear all caches
    this.clearCache();

    // Clear internal session cache
    this.sessionCache.clear();
    this.cacheTimestamps.clear();

    // Note: We do NOT:
    // - Close or reset the database (store remains connected)
    // - Delete session files from disk
    // - Clear the sessions from database
    // - Set initialized to false (remains initialized)

    logger.info("SessionManager reset complete - initialized state preserved");
  }

  /**
   * Close session manager and database
   */
  close(): void {
    this.clearCache();
    this.store.close();
    this.initialized = false;
  }

  /**
   * Ensure manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "SessionManager not initialized. Call initialize() first.",
      );
    }
  }
}
