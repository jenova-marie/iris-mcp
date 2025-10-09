/**
 * Session Manager - Orchestrates team-to-team session lifecycle
 *
 * Manages creation, discovery, and tracking of persistent Claude Code sessions
 * for team pair communications.
 */

import { randomUUID } from "crypto";
import { spawn } from "child_process";
import type { TeamsConfig, TeamConfig } from "../process-pool/types.js";
import { Logger } from "../utils/logger.js";
import { ConfigurationError, ProcessError } from "../utils/errors.js";
import { SessionStore } from "./session-store.js";
import {
  validateProjectPath,
  getSessionFilePath,
  sessionFileExists,
  listTeamSessions,
} from "./path-utils.js";
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

  constructor(teamsConfig: TeamsConfig, dbPath?: string) {
    this.teamsConfig = teamsConfig;
    this.store = new SessionStore(dbPath);
  }

  /**
   * Initialize session manager
   * - Validates team project paths
   * - Discovers existing sessions
   * - Syncs database with filesystem
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
        const projectPath = this.getProjectPath(teamConfig);
        validateProjectPath(projectPath);
        logger.debug("Validated team project path", { teamName, projectPath });
      } catch (error) {
        throw new ConfigurationError(
          `Invalid project path for team '${teamName}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Discover existing sessions from filesystem
    await this.discoverExistingSessions();

    this.initialized = true;
    logger.info("Session manager initialized");
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
          const existing = this.store.getBySessionId(sessionId);

          if (!existing) {
            logger.warn("Found orphaned session file, not adding to database", {
              teamName,
              sessionId,
              note: "Session files without database entries are ignored",
            });
          }
        }
      } catch (error) {
        logger.warn("Failed to discover sessions for team", {
          teamName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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

    const teamConfig = this.teamsConfig.teams[toTeam];
    if (!teamConfig) {
      throw new ConfigurationError(`Unknown team: ${toTeam}`);
    }

    const projectPath = this.getProjectPath(teamConfig);
    const sessionId = randomUUID();

    logger.info("Creating new session", {
      fromTeam,
      toTeam,
      sessionId,
      projectPath,
    });

    try {
      // Pre-create session using Claude CLI
      await this.executeSessionCreation(projectPath, sessionId, teamConfig);

      // Verify session file was created (optional)
      if (options?.verify !== false) {
        const timeout = options?.timeout || 5000;
        const exists = await this.waitForSessionFile(
          projectPath,
          sessionId,
          timeout,
        );

        if (!exists) {
          throw new ProcessError(
            `Session file not created within ${timeout}ms`,
            "session-creation",
          );
        }
      }

      // Store in database
      const sessionInfo = this.store.create(fromTeam, toTeam, sessionId);

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
   * Execute Claude CLI to create session
   */
  private async executeSessionCreation(
    projectPath: string,
    sessionId: string,
    teamConfig: TeamConfig,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "--session-id",
        sessionId,
        "--print",
        "Initial session creation",
      ];

      if (teamConfig.skipPermissions) {
        args.push("--dangerously-skip-permissions");
      }

      logger.debug("Spawning Claude to create session", {
        sessionId,
        projectPath,
        args,
      });

      const child = spawn("claude", args, {
        cwd: projectPath,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        logger.error("Failed to spawn Claude for session creation", {
          sessionId,
          error: error.message,
        });
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          logger.debug("Session creation command completed", { sessionId });
          resolve();
        } else {
          logger.error("Session creation command failed", {
            sessionId,
            code,
            stderr,
          });
          reject(
            new Error(
              `Session creation failed with code ${code}: ${stderr || "Unknown error"}`,
            ),
          );
        }
      });
    });
  }

  /**
   * Wait for session file to exist on filesystem
   */
  private async waitForSessionFile(
    projectPath: string,
    sessionId: string,
    timeout: number,
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (sessionFileExists(projectPath, sessionId)) {
        return true;
      }

      // Wait 100ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  /**
   * Get session for team pair (does not create)
   */
  getSession(fromTeam: string | null, toTeam: string): SessionInfo | null {
    this.ensureInitialized();
    return this.store.getByTeamPair(fromTeam, toTeam);
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
   * Record session usage (update last_used_at)
   */
  recordUsage(sessionId: string): void {
    this.ensureInitialized();
    this.store.updateLastUsed(sessionId);
  }

  /**
   * Increment message count for session
   */
  incrementMessageCount(sessionId: string, count = 1): void {
    this.ensureInitialized();
    this.store.incrementMessageCount(sessionId, count);
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
