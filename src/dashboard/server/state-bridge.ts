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
import { IrisOrchestrator } from "../../iris.js";
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
}

/**
 * Bridge between MCP server internals and dashboard
 * Provides read access to state and forwards events
 */
export class DashboardStateBridge extends EventEmitter {
  private iris: IrisOrchestrator;

  constructor(
    private pool: ClaudeProcessPool,
    private sessionManager: SessionManager,
    private configManager: TeamsConfigManager,
  ) {
    super();

    // Create IrisOrchestrator for accessing CacheManager
    this.iris = new IrisOrchestrator(
      this.sessionManager,
      this.pool,
      this.configManager.getConfig(),
    );

    this.setupEventForwarding();
  }

  /**
   * Forward events from process pool and session manager to dashboard clients
   */
  private setupEventForwarding(): void {
    // Forward process lifecycle events
    this.pool.on(
      "process-spawned",
      (data: { poolKey: string; pid: number }) => {
        logger.debug(data, "Forwarding process-spawned event");
        this.emit("ws:process-status", {
          poolKey: data.poolKey,
          status: "spawning",
          pid: data.pid,
        });
      },
    );

    this.pool.on("process-terminated", (data: { poolKey: string }) => {
      logger.debug(data, "Forwarding process-terminated event");
      this.emit("ws:process-status", {
        poolKey: data.poolKey,
        status: "stopped",
      });
    });

    this.pool.on(
      "process-status",
      (data: { poolKey: string; status: string }) => {
        logger.debug(data, "Forwarding process-status event");

        const [fromTeam, toTeam] = data.poolKey.split("->") as [string, string];

        this.emit("ws:process-status", {
          poolKey: data.poolKey,
          fromTeam,
          toTeam,
          status: data.status,
        });
      },
    );

    // Forward message events
    this.pool.on("message-sent", (data: any) => {
      logger.debug(data, "Forwarding message-sent event");
      this.emit("ws:message-sent", data);
    });

    this.pool.on("message-response", (data: any) => {
      logger.debug(data, "Forwarding message-response event");
      this.emit("ws:message-response", data);
    });

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

        // Process data (from Pool - may be defaults if no process)
        processState: session.processState || "stopped",
        pid: processInfo?.pid,
        messagesProcessed: processInfo?.messagesProcessed || 0,
        uptime: processInfo?.uptime || 0,
        queueLength: processInfo?.queueLength || 0,
        lastResponseAt: session.lastResponseAt,
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
    };
  }

  /**
   * Get cache report for a specific team pair (fromTeam->toTeam)
   */
  async getSessionReport(fromTeam: string, toTeam: string): Promise<any> {
    // Get message cache for this team pair
    const messageCache = this.iris.getMessageCacheForTeams(fromTeam, toTeam);

    if (!messageCache) {
      logger.info({ fromTeam, toTeam }, "No message cache found (no session yet)");

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
   * Get the terminal script path (if configured)
   */
  getTerminalScriptPath(): string | null {
    const config = this.getConfig();
    return config.dashboard?.terminalScriptPath || null;
  }
}
