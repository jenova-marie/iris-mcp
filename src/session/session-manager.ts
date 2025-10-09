/**
 * Session Manager - Orchestrates team-to-team session lifecycle
 *
 * Manages creation, discovery, and tracking of persistent Claude Code sessions
 * for team pair communications.
 */

import type { TeamsConfig, TeamConfig } from "../process-pool/types.js";
import { Logger } from "../utils/logger.js";
import {
  ConfigurationError,
  ProcessError,
  TimeoutError,
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
  private processPool: any; // Will be set after initialization
  private skipSessionFileInit = false; // For testing

  constructor(
    teamsConfig: TeamsConfig,
    dbPath?: string,
    skipSessionFileInit = false,
  ) {
    this.teamsConfig = teamsConfig;
    this.store = new SessionStore(dbPath);
    this.skipSessionFileInit =
      skipSessionFileInit || process.env.NODE_ENV === "test";
  }

  /**
   * Set the process pool reference for bidirectional integration
   */
  setProcessPool(pool: any): void {
    this.processPool = pool;
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

    // Skip discovering existing sessions in test mode
    if (!this.skipSessionFileInit && process.env.NODE_ENV !== "test") {
      // Discover existing sessions from filesystem
      await this.discoverExistingSessions();
    }

    // PRE-INITIALIZE ALL TEAM SESSIONS (skip in test mode)
    // This ensures session files exist before any --resume attempts
    if (!this.skipSessionFileInit && process.env.NODE_ENV !== "test") {
      logger.info("Pre-initializing team sessions");

      for (const [teamName, teamConfig] of Object.entries(
        this.teamsConfig.teams,
      )) {
        try {
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
              logger.debug("Session file already exists", {
                teamName,
                sessionId: existing.sessionId,
              });
              continue;
            }

            // Session in DB but file missing - re-initialize
            logger.warn("Session file missing, re-initializing", {
              teamName,
              sessionId: existing.sessionId,
            });

            await this.initializeSessionFile(teamName, existing.sessionId);
          } else {
            // No session in database - create new one
            logger.info("Creating initial session for team", { teamName });

            const sessionId = generateSecureUUID();
            await this.initializeSessionFile(teamName, sessionId);

            // Store in database
            this.store.create(null, teamName, sessionId);

            logger.info("Initial session created", { teamName, sessionId });
          }
        } catch (error) {
          logger.error("Failed to initialize session for team", {
            teamName,
            error: error instanceof Error ? error.message : String(error),
          });

          // Don't fail entire initialization if one team fails
          // This allows other teams to continue working
          logger.warn("Continuing initialization despite error", { teamName });
        }
      }
    }

    this.initialized = true;
    logger.info(
      "Session manager initialized" +
        (this.skipSessionFileInit || process.env.NODE_ENV === "test"
          ? ""
          : " with all team sessions ready"),
    );
  }

  /**
   * Get project path from team config, preferring 'project' over 'path'
   */
  private getProjectPath(teamConfig: TeamConfig): string {
    // Prefer 'project' over deprecated 'path'
    const projectPath = teamConfig.project || teamConfig.path;

    if (!projectPath) {
      throw new ConfigurationError(
        "Team config missing 'project' or 'path' property",
      );
    }

    return projectPath;
  }

  /**
   * Discover existing sessions from Claude's project directories
   */
  private async discoverExistingSessions(): Promise<void> {
    logger.info("Discovering existing sessions from filesystem");

    let orphanedCount = 0;
    let recoveredCount = 0;

    for (const [teamName, teamConfig] of Object.entries(
      this.teamsConfig.teams,
    )) {
      const projectPath = this.getProjectPath(teamConfig);

      try {
        const sessionIds = listTeamSessions(projectPath);

        logger.debug("Found sessions for team", {
          teamName,
          count: sessionIds.length,
        });

        // Check if any discovered sessions are missing from database
        for (const sessionId of sessionIds) {
          // Validate session ID format
          if (!validateUUID(sessionId)) {
            logger.warn("Skipping invalid session ID", {
              teamName,
              sessionId,
            });
            continue;
          }

          const existing = this.store.getBySessionId(sessionId);

          if (!existing) {
            orphanedCount++;
            logger.warn("Found orphaned session file", {
              teamName,
              sessionId,
            });

            // Try to recover the session
            const recovered = await this.recoverOrphanedSession(
              teamName,
              sessionId,
              projectPath,
            );
            if (recovered) {
              recoveredCount++;
            }
          }
        }
      } catch (error) {
        logger.warn("Failed to discover sessions for team", {
          teamName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (orphanedCount > 0) {
      logger.info("Session discovery completed", {
        orphanedCount,
        recoveredCount,
      });
    }
  }

  /**
   * Attempt to recover an orphaned session
   */
  private async recoverOrphanedSession(
    toTeam: string,
    sessionId: string,
    projectPath: string,
  ): Promise<boolean> {
    try {
      // Try to read session file metadata to infer fromTeam
      const sessionFilePath = getSessionFilePath(projectPath, sessionId);

      // For now, we'll create a recovery entry with null fromTeam
      // In future, could parse session file to determine actual fromTeam
      logger.info("Recovering orphaned session", {
        toTeam,
        sessionId,
      });

      // Create database entry for orphaned session
      const sessionInfo = this.store.create(null, toTeam, sessionId);

      // Mark as potentially needing maintenance
      this.store.updateStatus(sessionId, "compact_pending");

      logger.info("Successfully recovered orphaned session", {
        toTeam,
        sessionId,
      });

      return true;
    } catch (error) {
      logger.error("Failed to recover orphaned session", {
        toTeam,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Initialize a session file using claude --session-id
   * This creates the actual .jsonl file in ~/.claude/projects/
   */
  private async initializeSessionFile(
    teamName: string,
    sessionId: string,
  ): Promise<void> {
    const teamConfig = this.teamsConfig.teams[teamName];
    if (!teamConfig) {
      throw new ConfigurationError(`Unknown team: ${teamName}`);
    }

    const projectPath = this.getProjectPath(teamConfig);

    logger.info("Initializing session file", {
      teamName,
      sessionId,
      projectPath,
    });

    // Skip actual file initialization in test mode
    if (this.skipSessionFileInit) {
      logger.debug("Skipping session file initialization in test mode", {
        teamName,
        sessionId,
      });
      return;
    }

    try {
      const { spawn } = await import("child_process");

      // Build command args for session creation
      const args = [
        "--session-id", // Create NEW session (not resume)
        sessionId,
        "--print", // Non-interactive mode
        "ping", // Simple ping message to initialize the session
      ];

      // Note: --dangerously-skip-permissions is NOT used during session creation
      // It's only used when resuming sessions with --resume

      // Log the exact command being run
      logger.debug("Spawning claude with args", {
        teamName,
        sessionId,
        args,
        cwd: projectPath,
      });

      // Spawn Claude with --session-id and ping message
      const process = spawn("claude", args, {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Close stdin immediately since we're not sending any input
      process.stdin!.end();

      // Capture any errors
      let error: Error | null = null;
      process.on("error", (err) => {
        logger.error("Process error during spawn", {
          teamName,
          sessionId,
          error: err.message,
        });
        error = err;
      });

      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        let responseReceived = false;

        // Listen for stdout data (response from Claude)
        process.stdout!.on("data", (data) => {
          const output = data.toString();
          logger.debug("Session init stdout", {
            teamName,
            sessionId,
            output: output.substring(0, 200),
          });

          // If we got any response, consider it successful
          if (output.length > 0) {
            responseReceived = true;
          }
        });

        // Listen for stderr data (errors from Claude)
        process.stderr!.on("data", (data) => {
          const errorOutput = data.toString();
          logger.warn("Session init stderr", {
            teamName,
            sessionId,
            error: errorOutput,
          });
        });

        process.on("exit", (code) => {
          if (error) {
            reject(error);
          } else if (code !== 0 && code !== 143) {
            // 143 is SIGTERM which is ok
            reject(
              new ProcessError(
                `Session initialization failed with exit code ${code}`,
                teamName,
              ),
            );
          } else if (!responseReceived) {
            reject(
              new ProcessError(
                "Session initialization completed but no response received",
                teamName,
              ),
            );
          } else {
            resolve();
          }
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          process.kill();
          reject(
            new ProcessError(
              `Session initialization timed out after 5 seconds. Response received: ${responseReceived}`,
              teamName,
            ),
          );
        });
      });

      // Verify session file was created
      const sessionFilePath = getSessionFilePath(projectPath, sessionId);
      const { existsSync } = await import("fs");

      if (!existsSync(sessionFilePath)) {
        throw new ProcessError(
          `Session file was not created at ${sessionFilePath}`,
          teamName,
        );
      }

      logger.info("Session file initialized successfully", {
        teamName,
        sessionId,
        filePath: sessionFilePath,
      });
    } catch (error) {
      logger.error("Failed to initialize session file", {
        teamName,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
      // Initialize the session file first using claude --session-id
      await this.initializeSessionFile(toTeam, sessionId);

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
   * Sends /compact command to running Claude process if available
   */
  async compactSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    const session = this.store.getBySessionId(sessionId);
    if (!session) {
      logger.warn("Attempted to compact non-existent session", { sessionId });
      return;
    }

    logger.info("Starting session compaction", {
      sessionId,
      fromTeam: session.fromTeam,
      toTeam: session.toTeam,
      messageCount: session.messageCount,
    });

    // Mark as compacting
    this.store.updateStatus(sessionId, "compacting");
    this.invalidateCache(session.fromTeam, session.toTeam);

    try {
      // Send /compact command to running process if available
      if (this.processPool) {
        try {
          const response = await this.processPool.sendCommandToSession(
            sessionId,
            "/compact",
          );
          if (response) {
            logger.info("Compaction command sent successfully", {
              sessionId,
              response: response.substring(0, 100),
            });
          }
        } catch (error) {
          logger.warn("Failed to send compact command to process", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
            note: "Continuing with metadata update only",
          });
        }
      } else {
        // Simulate compaction delay if no pool available
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Reset message count and update status
      this.store.resetMessageCount(sessionId);
      this.store.updateStatus(sessionId, "active");

      logger.info("Session compaction completed", { sessionId });
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
