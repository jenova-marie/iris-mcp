/**
 * Iris MCP - Dashboard State Bridge
 * Provides read-only access to MCP server state for dashboard
 * Forwards events from process pool and session manager for real-time updates
 *
 * ARCHITECTURE: Combines SessionManager (source of truth) with Pool (runtime state)
 * - SessionManager: Persistent session data (SQLite) - ALL sessions
 * - ProcessPool: Runtime process status - ACTIVE processes only
 * - Bridge: Merges both to show complete picture
 */

import { EventEmitter } from "events";
import type { ClaudeProcessPool } from "../../process-pool/pool-manager.js";
import type { SessionManager } from "../../session/session-manager.js";
import type { TeamsConfigManager } from "../../config/iris-config.js";
import type { TeamsConfig } from "../../process-pool/types.js";
import { PoolEvent } from "../../process-pool/types.js";
import { IrisOrchestrator } from "../../iris.js";
import type { PendingPermissionsManager } from "../../permissions/pending-manager.js";
import { getChildLogger } from "../../utils/logger.js";

const logger = getChildLogger("dashboard:state");

/**
 * Session-based process info (fromTeam->toTeam pairs)
 * Combines persistent session data with runtime process status
 */
export interface SessionProcessInfo {
  poolKey: string; // "fromTeam->toTeam"
  fromTeam: string;
  toTeam: string;
  sessionId: string;

  // Session data (from SessionManager)
  messageCount: number; // Total messages in session (persistent)
  createdAt: number; // Session creation time
  lastUsedAt: number; // Last activity time
  sessionStatus: string; // Session status (active/archived)

  // Process data (from ProcessPool - may be null if not running)
  processState: string; // Process state (stopped/spawning/idle/processing)
  pid?: number; // Process ID (if running)
  messagesProcessed: number; // Messages processed by current process
  uptime: number; // Process uptime (0 if stopped)
  queueLength: number; // Process queue length (0 if stopped)
  lastResponseAt: number | null; // Last response timestamp

  // Debug info (for troubleshooting)
  launchCommand: string | null; // Full command used to spawn this session
  teamConfigSnapshot: string | null; // JSON snapshot of server-side config
}

/**
 * Bridge between MCP server internals and dashboard
 * Provides read access to state and forwards events
 */
export class DashboardStateBridge extends EventEmitter {
  private iris: IrisOrchestrator;
  private pendingPermissions?: PendingPermissionsManager;

  constructor(
    private pool: ClaudeProcessPool,
    private sessionManager: SessionManager,
    private configManager: TeamsConfigManager,
    iris?: IrisOrchestrator,
    pendingPermissions?: PendingPermissionsManager,
  ) {
    super();

    // Use provided IrisOrchestrator or create new one for accessing CacheManager
    this.iris =
      iris ||
      new IrisOrchestrator(
        this.sessionManager,
        this.pool,
        this.configManager.getConfig(),
      );

    // Store permissions manager if provided
    this.pendingPermissions = pendingPermissions;

    this.setupEventForwarding();
  }

  /**
   * Forward events from process pool and session manager to dashboard clients
   */
  private setupEventForwarding(): void {
    // Forward process lifecycle events using enum to prevent typos
    this.pool.on(PoolEvent.PROCESS_TERMINATED, (data: { teamName: string }) => {
      logger.debug(data, "Forwarding process-terminated event");
      // Note: We don't have poolKey in the event data, so we can't forward it
      // Dashboard will need to refresh via polling or use a different approach
      this.emit("ws:process-status", {
        teamName: data.teamName,
        status: "stopped",
      });
    });

    this.pool.on(
      PoolEvent.PROCESS_ERROR,
      (data: { teamName: string; error: Error }) => {
        logger.debug(data, "Forwarding process-error event");
        this.emit("ws:process-error", {
          teamName: data.teamName,
          error: data.error.message,
        });
      },
    );

    // Forward permission events if manager is available
    if (this.pendingPermissions) {
      this.pendingPermissions.on("permission:created", (request) => {
        logger.debug(
          {
            permissionId: request.permissionId,
            teamName: request.teamName,
            toolName: request.toolName,
          },
          "Forwarding permission:created event",
        );
        this.emit("ws:permission:request", request);
      });

      this.pendingPermissions.on("permission:resolved", (data) => {
        logger.debug(
          {
            permissionId: data.permissionId,
            approved: data.approved,
          },
          "Forwarding permission:resolved event",
        );
        this.emit("ws:permission:resolved", data);
      });

      this.pendingPermissions.on("permission:timeout", (data) => {
        logger.debug(
          {
            permissionId: data.permissionId,
          },
          "Forwarding permission:timeout event",
        );
        this.emit("ws:permission:timeout", {
          permissionId: data.permissionId,
          request: data.request,
        });
      });
    }

    logger.info("Event forwarding initialized");
  }

  /**
   * Get current configuration
   */
  getConfig(): TeamsConfig {
    return this.configManager.getConfig();
  }

  /**
   * Get list of all configured teams
   */
  getTeamNames(): string[] {
    return this.configManager.getTeamNames();
  }

  /**
   * Get all sessions (fromTeam->toTeam pairs)
   * Combines SessionManager (persistent) with ProcessPool (runtime)
   *
   * Architecture:
   * - SessionManager is source of truth (shows ALL sessions)
   * - ProcessPool provides runtime status (only active processes)
   * - Result: Complete view of all sessions with their current state
   */
  getActiveSessions(): SessionProcessInfo[] {
    // Get ALL sessions from SessionManager (source of truth)
    const sessions = this.sessionManager.listSessions();

    // Get runtime process status from pool
    const poolStatus = this.pool.getStatus();

    const sessionProcesses: SessionProcessInfo[] = [];

    for (const session of sessions) {
      const poolKey = `${session.fromTeam}->${session.toTeam}`;

      // Try to get runtime process info (may not exist if process stopped)
      const processInfo = poolStatus.processes[poolKey];

      // Skip sessions with null fromTeam (shouldn't exist in new architecture)
      if (!session.fromTeam) {
        logger.warn(
          { sessionId: session.sessionId, toTeam: session.toTeam },
          "Skipping session with null fromTeam",
        );
        continue;
      }

      sessionProcesses.push({
        poolKey,
        fromTeam: session.fromTeam,
        toTeam: session.toTeam,
        sessionId: session.sessionId,

        // Session data (from SessionManager - persistent)
        messageCount: session.messageCount,
        createdAt: session.createdAt.getTime(),
        lastUsedAt: session.lastUsedAt.getTime(),
        sessionStatus: session.status,

        // Process data (from Pool - runtime state takes precedence)
        processState: processInfo?.status || "stopped",
        pid: processInfo?.pid,
        messagesProcessed: processInfo?.messagesProcessed || 0,
        uptime: processInfo?.uptime || 0,
        queueLength: processInfo?.queueLength || 0,
        lastResponseAt: session.lastResponseAt,

        // Debug info (for troubleshooting)
        launchCommand: session.launchCommand,
        teamConfigSnapshot: session.teamConfigSnapshot,
      });
    }

    return sessionProcesses;
  }

  /**
   * Get metrics for a specific session
   * Combines SessionManager (persistent) with ProcessPool (runtime)
   */
  getSessionMetrics(
    fromTeam: string,
    toTeam: string,
  ): SessionProcessInfo | null {
    // Get session from SessionManager (source of truth)
    const session = this.sessionManager.getSession(fromTeam, toTeam);

    if (!session) {
      return null;
    }

    // Skip sessions with null fromTeam (shouldn't exist in new architecture)
    if (!session.fromTeam) {
      logger.warn(
        { sessionId: session.sessionId, toTeam: session.toTeam },
        "Cannot get metrics for session with null fromTeam",
      );
      return null;
    }

    const poolKey = `${fromTeam}->${toTeam}`;

    // Try to get runtime process info
    const poolStatus = this.pool.getStatus();
    const processInfo = poolStatus.processes[poolKey];

    return {
      poolKey,
      fromTeam: session.fromTeam,
      toTeam: session.toTeam,
      sessionId: session.sessionId,

      // Session data (from SessionManager - persistent)
      messageCount: session.messageCount,
      createdAt: session.createdAt.getTime(),
      lastUsedAt: session.lastUsedAt.getTime(),
      sessionStatus: session.status,

      // Process data (from Pool - may be defaults if no process)
      processState: session.processState || "stopped",
      pid: processInfo?.pid,
      messagesProcessed: processInfo?.messagesProcessed || 0,
      uptime: processInfo?.uptime || 0,
      queueLength: processInfo?.queueLength || 0,
      lastResponseAt: session.lastResponseAt,

      // Debug info (for troubleshooting)
      launchCommand: session.launchCommand,
      teamConfigSnapshot: session.teamConfigSnapshot,
    };
  }

  /**
   * Get cache report for a specific team pair (fromTeam->toTeam)
   */
  async getSessionReport(fromTeam: string, toTeam: string): Promise<any> {
    // Get message cache for this team pair
    const messageCache = this.iris.getMessageCacheForTeams(fromTeam, toTeam);

    if (!messageCache) {
      logger.info(
        { fromTeam, toTeam },
        "No message cache found (no session yet)",
      );

      return {
        team: toTeam,
        fromTeam,
        hasSession: false,
        hasProcess: false,
        allComplete: true,
        entries: [],
        stats: {
          totalEntries: 0,
          spawnEntries: 0,
          tellEntries: 0,
          activeEntries: 0,
          completedEntries: 0,
        },
        timestamp: Date.now(),
      };
    }

    // Get all cache entries
    const entries = messageCache.getAllEntries();
    const stats = messageCache.getStats();

    // Format entries for output
    const formattedEntries = entries.map((entry) => {
      const messages = entry.getMessages().map((msg) => {
        let content: string | undefined;

        // Extract text content from assistant messages
        if (msg.type === "assistant" && msg.data?.message?.content) {
          const textBlocks = msg.data.message.content.filter(
            (c: any) => c.type === "text",
          );
          if (textBlocks.length > 0) {
            content = textBlocks.map((b: any) => b.text).join("\n");
          }
        }

        return {
          timestamp: msg.timestamp,
          type: msg.type,
          content,
        };
      });

      return {
        type: entry.cacheEntryType as "spawn" | "tell",
        tellString: entry.tellString,
        status: entry.status,
        isComplete: entry.status === "completed",
        messageCount: entry.getMessages().length,
        createdAt: entry.createdAt,
        completedAt: entry.completedAt,
        messages,
      };
    });

    // Check if all entries are complete
    const allComplete = entries.every((entry) => entry.status === "completed");

    // Check if process is active
    const session = this.iris.getSession(messageCache.sessionId);
    const hasProcess = session ? this.iris.isAwake(fromTeam, toTeam) : false;

    // Get process state if session exists
    let processState: string | undefined;
    if (session) {
      processState = session.processState;
    }

    return {
      team: toTeam,
      fromTeam,
      hasSession: true,
      hasProcess,
      processState,
      sessionId: messageCache.sessionId,
      allComplete,
      entries: formattedEntries,
      stats,
      timestamp: Date.now(),
    };
  }

  /**
   * Stream cache output for a specific session
   * TODO: Implement when CacheManager is available in dashboard
   */
  streamSessionCache(sessionId: string): boolean {
    logger.warn({ sessionId }, "streamSessionCache not yet implemented");
    return false;
  }

  /**
   * Get process pool status summary
   */
  getPoolStatus(): {
    totalSessions: number;
    activeProcesses: number;
    maxProcesses: number;
    configuredTeams: number;
  } {
    const sessions = this.getActiveSessions();
    const activeCount = sessions.filter(
      (s) => s.processState !== "stopped",
    ).length;
    const config = this.getConfig();

    return {
      totalSessions: sessions.length,
      activeProcesses: activeCount,
      maxProcesses: config.settings.maxProcesses,
      configuredTeams: this.getTeamNames().length,
    };
  }

  /**
   * Get the absolute path for a specific team
   */
  getTeamPath(teamName: string): string | null {
    const teamConfig = this.configManager.getIrisConfig(teamName);
    return teamConfig ? teamConfig.path : null;
  }

  /**
   * Get the spawn script path (if configured)
   * The spawn script handles both fork and spawn operations
   */
  getForkScriptPath(): string | null {
    const config = this.getConfig();
    return config.dashboard?.spawnScriptPath || null;
  }

  /**
   * Get remote connection info for a team (if configured)
   * Parses the remote string to extract SSH host and options
   */
  getTeamRemoteInfo(
    teamName: string,
  ): { sshHost: string; sshOptions: string } | null {
    const teamConfig = this.configManager.getIrisConfig(teamName);

    if (!teamConfig || !teamConfig.remote) {
      return null;
    }

    // Parse remote string (e.g., "ssh inanna" or "ssh -J jumphost user@host")
    const remoteParts = teamConfig.remote.split(/\s+/);

    // Skip "ssh" command
    if (remoteParts[0] === "ssh") {
      remoteParts.shift();
    }

    if (remoteParts.length === 0) {
      return null;
    }

    // Last part is the host
    const sshHost = remoteParts[remoteParts.length - 1];

    // Everything else is options
    const sshOptions = remoteParts.slice(0, -1).join(" ");

    return { sshHost, sshOptions };
  }

  /**
   * Get the claudePath for a team (if configured)
   * Returns the path to the Claude CLI executable
   * Defaults to "claude" if not specified
   */
  getTeamClaudePath(teamName: string): string {
    const teamConfig = this.configManager.getIrisConfig(teamName);
    return teamConfig?.claudePath || "claude";
  }

  /**
   * Put a session to sleep (terminate the process)
   */
  async sleepSession(
    fromTeam: string,
    toTeam: string,
    force: boolean = false,
  ): Promise<any> {
    const { sleep } = await import("../../actions/sleep.js");
    return await sleep({ team: toTeam, fromTeam, force }, this.pool);
  }

  /**
   * Reboot a session (terminate, delete, create new)
   */
  async rebootSession(fromTeam: string, toTeam: string): Promise<any> {
    const { reboot } = await import("../../actions/reboot.js");
    return await reboot(
      { fromTeam, toTeam },
      this.iris,
      this.sessionManager,
      this.pool,
    );
  }

  /**
   * Delete a session permanently (terminate and remove)
   */
  async deleteSession(fromTeam: string, toTeam: string): Promise<any> {
    const { deleteSession } = await import("../../actions/delete.js");
    return await deleteSession(
      { fromTeam, toTeam },
      this.iris,
      this.sessionManager,
      this.pool,
    );
  }

  /**
   * Fork a session (launch new terminal with --resume --fork-session)
   * Delegates to the fork MCP action for consistency
   */
  async forkSession(fromTeam: string, toTeam: string): Promise<any> {
    const { fork } = await import("../../actions/fork.js");
    return await fork(
      { fromTeam, toTeam },
      this.iris,
      this.sessionManager,
      this.pool,
      this.configManager,
    );
  }

  /**
   * Fork a session by sessionId (lookup fromTeam/toTeam automatically)
   * More convenient API that doesn't require caller to know the team pair
   */
  async forkSessionById(sessionId: string): Promise<any> {
    // Look up session to get fromTeam and toTeam
    const session = this.sessionManager.getSessionById(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.fromTeam) {
      throw new Error(`Session ${sessionId} has no fromTeam (legacy session)`);
    }

    // Delegate to existing fork method
    return await this.forkSession(session.fromTeam, session.toTeam);
  }

  /**
   * Get all pending permission requests
   */
  getPendingPermissions() {
    if (!this.pendingPermissions) {
      return [];
    }
    return this.pendingPermissions.getPendingRequests();
  }

  /**
   * Resolve a pending permission request
   */
  resolvePermission(
    permissionId: string,
    approved: boolean,
    reason?: string,
  ): boolean {
    if (!this.pendingPermissions) {
      logger.warn("Cannot resolve permission - manager not available");
      return false;
    }
    return this.pendingPermissions.resolvePendingPermission(
      permissionId,
      approved,
      reason,
    );
  }

  /**
   * Get logs from wonder-logger memory transport
   * Delegates to the debug MCP action
   */
  async getLogs(options: {
    since?: number;
    storeName?: string;
    format?: "raw" | "parsed";
    level?: string | string[];
  }): Promise<any> {
    const { debug } = await import("../../actions/debug.js");
    return await debug({
      logs_since: options.since,
      storeName: options.storeName,
      format: options.format,
      level: options.level,
    });
  }

  /**
   * Get all available log store names
   */
  async getLogStores(): Promise<string[]> {
    const { debug } = await import("../../actions/debug.js");
    const result = await debug({ getAllStores: true });
    return result.availableStores || [];
  }
}
