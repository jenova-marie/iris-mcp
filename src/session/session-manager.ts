/**
 * Session Manager - Orchestrates team-to-team session lifecycle
 *
 * Manages creation, discovery, and tracking of persistent Claude Code sessions
 * for team pair communications.
 */

import type { TeamsConfig, TeamConfig } from "../process-pool/types.js";
import { ClaudeProcess } from "../process-pool/claude-process.js";
import { getChildLogger } from "../utils/logger.js";
import { ConfigurationError, ProcessError } from "../utils/errors.js";
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
  ProcessState,
} from "./types.js";

const logger = getChildLogger("session:manager");

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
   *
   * NOTE: No longer pre-initializes sessions. In the new architecture, ALL sessions
   * require both fromTeam and toTeam. Sessions are created on-demand when the first
   * message arrives with a valid fromTeam.
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

    this.initialized = true;
    logger.info(
      "Session manager initialized - sessions will be created on-demand",
    );
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
    fromTeam: string,
    toTeam: string,
  ): Promise<SessionInfo> {
    this.ensureInitialized();

    // Validate toTeam exists
    if (!this.teamsConfig.teams[toTeam]) {
      throw new ConfigurationError(`Unknown team: ${toTeam}`);
    }

    // Validate fromTeam exists
    if (!this.teamsConfig.teams[fromTeam]) {
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
    fromTeam: string,
    toTeam: string,
    options?: CreateSessionOptions,
  ): Promise<SessionInfo> {
    this.ensureInitialized();

    // Validate teams
    validateTeamName(toTeam);
    validateTeamName(fromTeam);

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
      logger.error({
        err: error instanceof Error ? error : new Error(String(error)),
        fromTeam,
        toTeam,
        sessionId,
      }, "Failed to create session");

      throw new ProcessError(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
        toTeam,
      );
    }
  }

  /**
   * Generate cache key for team pair
   */
  private getCacheKey(fromTeam: string, toTeam: string): string {
    return `${fromTeam}->${toTeam}`;
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
  getSession(fromTeam: string, toTeam: string): SessionInfo | null {
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
  private invalidateCache(fromTeam: string, toTeam: string): void {
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
          logger.info({ sessionId, filePath }, "Deleted session file");
        } catch (error) {
          logger.warn({
            err: error instanceof Error ? error : new Error(String(error)),
            sessionId,
            filePath,
          }, "Failed to delete session file");
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

      logger.info({ sessionId }, "Session metadata compaction completed");
    } catch (error) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error)),
        sessionId,
      }, "Session compaction failed");

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
   * Update process state (called by Iris)
   */
  updateProcessState(sessionId: string, state: ProcessState): void {
    this.ensureInitialized();
    this.store.updateProcessState(sessionId, state);

    // Invalidate cache
    const session = this.store.getBySessionId(sessionId);
    if (session) {
      this.invalidateCache(session.fromTeam, session.toTeam);
    }
  }

  /**
   * Set current cache session ID (called by Iris)
   */
  setCurrentCacheSessionId(
    sessionId: string,
    cacheSessionId: string | null,
  ): void {
    this.ensureInitialized();
    this.store.setCurrentCacheSessionId(sessionId, cacheSessionId);

    // Invalidate cache
    const session = this.store.getBySessionId(sessionId);
    if (session) {
      this.invalidateCache(session.fromTeam, session.toTeam);
    }
  }

  /**
   * Update last response timestamp (called by Iris)
   */
  updateLastResponse(sessionId: string): void {
    this.ensureInitialized();
    this.store.updateLastResponse(sessionId, Date.now());

    // Invalidate cache
    const session = this.store.getBySessionId(sessionId);
    if (session) {
      this.invalidateCache(session.fromTeam, session.toTeam);
    }
  }

  /**
   * Get process state
   */
  getProcessState(sessionId: string): string | null {
    this.ensureInitialized();
    const session = this.store.getBySessionId(sessionId);
    return session?.processState ?? null;
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
