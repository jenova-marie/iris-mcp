/**
 * Iris MCP - Dashboard State Bridge
 * Provides read-only access to MCP server state for dashboard
 * Forwards events from process pool for real-time updates
 */

import { EventEmitter } from "events";
import type { ClaudeProcessPool } from "../../process-pool/pool-manager.js";
import type { TeamsConfigManager } from "../../config/teams-config.js";
import type { TeamsConfig, ProcessMetrics } from "../../process-pool/types.js";
import { Logger } from "../../utils/logger.js";

const logger = new Logger("dashboard-bridge");

export interface ProcessInfo extends ProcessMetrics {
  teamName: string;
}

export interface CacheStreamData {
  type: "stdout" | "stderr";
  line: string;
}

/**
 * Bridge between MCP server internals and dashboard
 * Provides read access to state and forwards events
 */
export class DashboardStateBridge extends EventEmitter {
  constructor(
    private pool: ClaudeProcessPool,
    private configManager: TeamsConfigManager,
  ) {
    super();
    this.setupEventForwarding();
  }

  /**
   * Forward events from process pool to dashboard clients
   */
  private setupEventForwarding(): void {
    // Forward process lifecycle events
    this.pool.on("process-spawned", (teamName: string, pid: number) => {
      logger.debug("Forwarding process-spawned event", { teamName, pid });
      this.emit("ws:process-status", {
        teamName,
        status: "spawning",
        pid,
      });
    });

    this.pool.on("process-terminated", (teamName: string) => {
      logger.debug("Forwarding process-terminated event", { teamName });
      this.emit("ws:process-status", {
        teamName,
        status: "stopped",
      });
    });

    this.pool.on("process-status", (teamName: string, status: string) => {
      logger.debug("Forwarding process-status event", { teamName, status });
      const process = this.pool.getProcess(teamName);
      const metrics = process ? process.getBasicMetrics() : null;

      this.emit("ws:process-status", {
        teamName,
        status,
        ...metrics,
      });
    });

    // Forward message events
    this.pool.on("message-sent", (data: any) => {
      logger.debug("Forwarding message-sent event", data);
      this.emit("ws:message-sent", data);
    });

    this.pool.on("message-response", (data: any) => {
      logger.debug("Forwarding message-response event", data);
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
   * Get active process information for all running processes
   */
  getActiveProcesses(): ProcessInfo[] {
    const teamNames = this.configManager.getTeamNames();
    const processes: ProcessInfo[] = [];

    for (const teamName of teamNames) {
      const process = this.pool.getProcess(teamName);

      if (process) {
        const metrics = process.getBasicMetrics();
        processes.push({
          teamName,
          ...metrics,
        });
      } else {
        // Process not running, show as stopped
        processes.push({
          teamName,
          pid: undefined,
          status: "stopped",
          messagesProcessed: 0,
          lastUsed: 0,
          uptime: 0,
          idleTimeRemaining: 0,
          queueLength: 0,
          messageCount: 0,
          lastActivity: 0,
        });
      }
    }

    return processes;
  }

  /**
   * Get metrics for a specific team process
   */
  getProcessMetrics(teamName: string): ProcessInfo | null {
    const process = this.pool.getProcess(teamName);

    if (!process) {
      return {
        teamName,
        pid: undefined,
        status: "stopped",
        messagesProcessed: 0,
        lastUsed: 0,
        uptime: 0,
        idleTimeRemaining: 0,
        queueLength: 0,
        messageCount: 0,
        lastActivity: 0,
      };
    }

    const metrics = process.getBasicMetrics();
    return {
      teamName,
      ...metrics,
    };
  }

  /**
   * Get cache data for a specific team process
   * Returns stdout and stderr buffers
   */
  getProcessCache(teamName: string): { stdout: string; stderr: string } | null {
    const process = this.pool.getProcess(teamName);

    if (!process) {
      return null;
    }

    // ClaudeProcess doesn't currently expose cache directly
    // This will need to be added to ClaudeProcess later
    // For now, return empty buffers
    return {
      stdout: "",
      stderr: "",
    };
  }

  /**
   * Stream cache output for a specific team
   * Emits 'cache-stream' events with new data
   */
  streamProcessCache(teamName: string): boolean {
    const process = this.pool.getProcess(teamName);

    if (!process) {
      return false;
    }

    // This will be implemented when we add cache streaming to ClaudeProcess
    // For now, just return true if process exists
    logger.info("Cache streaming requested for team", { teamName });
    return true;
  }

  /**
   * Get process pool status summary
   */
  getPoolStatus(): {
    totalProcesses: number;
    activeProcesses: number;
    maxProcesses: number;
    configuredTeams: number;
  } {
    const processes = this.getActiveProcesses();
    const activeCount = processes.filter((p) => p.status !== "stopped").length;
    const config = this.getConfig();

    return {
      totalProcesses: processes.length,
      activeProcesses: activeCount,
      maxProcesses: config.settings.maxProcesses,
      configuredTeams: this.getTeamNames().length,
    };
  }
}
