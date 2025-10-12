/**
 * Iris MCP - Process Pool Manager
 * Manages a pool of Claude Code processes with LRU eviction
 */

import { EventEmitter } from "events";
import { ClaudeProcess } from "./claude-process.js";
import type { ProcessPoolStatus, ProcessPoolConfig } from "./types.js";
import { TeamsConfigManager } from "../config/teams-config.js";
import { Logger } from "../utils/logger.js";
import { TeamNotFoundError, ProcessPoolLimitError } from "../utils/errors.js";

export class ClaudeProcessPool extends EventEmitter {
  private processes = new Map<string, ClaudeProcess>();
  private sessionToProcess = new Map<string, string>(); // sessionId -> poolKey mapping
  private accessOrder: string[] = []; // For LRU tracking
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private logger = new Logger("pool");

  constructor(
    private configManager: TeamsConfigManager,
    private config: ProcessPoolConfig,
  ) {
    super();
    this.startHealthCheck();
  }

  /**
   * Get the current configuration
   */
  getConfig() {
    return this.configManager.getConfig();
  }

  /**
   * Generate pool key for team pair
   * Format: "fromTeam->toTeam" or "external->toTeam"
   */
  private getPoolKey(fromTeam: string | null, toTeam: string): string {
    return `${fromTeam ?? 'external'}->${toTeam}`;
  }

  /**
   * Get process by session ID
   */
  getProcessBySessionId(sessionId: string): ClaudeProcess | undefined {
    const poolKey = this.sessionToProcess.get(sessionId);
    if (!poolKey) return undefined;
    return this.processes.get(poolKey);
  }

  /**
   * Get or create a process for a team
   *
   * @param teamName - The team to get/create process for
   * @param sessionId - The session ID to use for this process
   * @param fromTeam - The requesting team (null for external requests)
   */
  async getOrCreateProcess(
    teamName: string,
    sessionId: string,
    fromTeam: string | null = null,
  ): Promise<ClaudeProcess> {
    // Check if team exists in configuration
    const teamConfig = this.configManager.getTeamConfig(teamName);
    if (!teamConfig) {
      throw new TeamNotFoundError(teamName);
    }

    this.logger.debug("Using session for team pair", {
      fromTeam,
      toTeam: teamName,
      sessionId,
    });

    // Generate pool key for this team pair
    const poolKey = this.getPoolKey(fromTeam, teamName);

    // Update access order for LRU
    this.updateAccessOrder(poolKey);

    // Return existing process if available
    const existing = this.processes.get(poolKey);
    if (existing && existing.getMetrics().status !== "stopped") {
      this.logger.debug("Using existing process", { poolKey, sessionId });
      return existing;
    }

    // Check pool limit
    if (this.processes.size >= this.config.maxProcesses) {
      await this.evictLRU();
    }

    // Create new process
    this.logger.info("Creating new process", {
      poolKey,
      teamName,
      sessionId,
    });

    const process = new ClaudeProcess(
      teamName,
      teamConfig,
      teamConfig.idleTimeout || this.config.idleTimeout,
      sessionId,
    );

    // Set up event forwarding
    process.on("spawned", (data) => this.emit("process-spawned", data));
    process.on("terminated", (data) => {
      this.emit("process-terminated", data);
      this.processes.delete(poolKey);
      this.sessionToProcess.delete(sessionId);
      this.removeFromAccessOrder(poolKey);
    });
    process.on("exited", (data) => {
      this.emit("process-exited", data);
      this.processes.delete(poolKey);
      this.sessionToProcess.delete(sessionId);
      this.removeFromAccessOrder(poolKey);
    });
    process.on("error", (data) => this.emit("process-error", data));
    process.on("message-sent", (data) => this.emit("message-sent", data));
    process.on("message-response", (data) =>
      this.emit("message-response", data),
    );

    // Spawn the process
    await process.spawn();

    // Add to pool with pool key
    this.processes.set(poolKey, process);
    this.sessionToProcess.set(sessionId, poolKey);
    this.updateAccessOrder(poolKey);

    return process;
  }

  /**
   * Send a message to a team
   *
   * @param teamName - The team to send message to
   * @param sessionId - The session ID to use
   * @param message - The message content
   * @param timeout - Optional timeout in ms
   * @param fromTeam - The requesting team (null for external requests)
   */
  async sendMessage(
    teamName: string,
    sessionId: string,
    message: string,
    timeout?: number,
    fromTeam: string | null = null,
  ): Promise<string> {
    const process = await this.getOrCreateProcess(teamName, sessionId, fromTeam);
    return process.sendMessage(message, timeout);
  }

  /**
   * Terminate a specific process
   */
  async terminateProcess(teamName: string): Promise<void> {
    // Find the process by team name (it could be in any pool key)
    const process = this.getProcess(teamName);

    if (process) {
      // Just call terminate - the event handlers will clean up the maps
      await process.terminate();
    }
  }

  /**
   * Terminate all processes
   */
  async terminateAll(): Promise<void> {
    this.logger.info('Terminating all processes');

    // Copy the processes array to avoid modifying while iterating
    const processesToTerminate = Array.from(this.processes.values());

    const promises: Promise<void>[] = [];
    for (const process of processesToTerminate) {
      promises.push(process.terminate());
    }

    await Promise.all(promises);

    // Event handlers should have cleaned up, but ensure everything is cleared
    this.processes.clear();
    this.sessionToProcess.clear();
    this.accessOrder = [];

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get pool status with session information
   */
  getStatus(): ProcessPoolStatus {
    const processes: Record<string, any> = {};

    for (const [poolKey, process] of this.processes) {
      const metrics = process.getMetrics();

      // Find associated session ID
      let sessionId: string | undefined;
      for (const [sid, pk] of this.sessionToProcess) {
        if (pk === poolKey) {
          sessionId = sid;
          break;
        }
      }

      processes[poolKey] = {
        ...metrics,
        sessionId,
        poolKey,
      };
    }

    return {
      totalProcesses: this.processes.size,
      maxProcesses: this.config.maxProcesses,
      processes,
      activeSessions: this.sessionToProcess.size,
    };
  }

  /**
   * Get process for a team (if exists)
   * @deprecated Use getProcessBySessionId or getOrCreateProcess instead
   */
  getProcess(teamName: string): ClaudeProcess | undefined {
    // Try to find by team name in any pool key
    for (const [poolKey, process] of this.processes) {
      if (poolKey.endsWith(`->${teamName}`)) {
        return process;
      }
    }
    return undefined;
  }

  /**
   * Send a command to a process (for compaction, etc.)
   */
  async sendCommandToSession(sessionId: string, command: string): Promise<string | null> {
    const process = this.getProcessBySessionId(sessionId);
    if (!process) {
      this.logger.warn("No process found for session", { sessionId });
      return null;
    }

    try {
      const response = await process.sendMessage(command);
      this.logger.info("Command sent to session", { sessionId, command });
      return response;
    } catch (error) {
      this.logger.error("Failed to send command to session", {
        sessionId,
        command,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Evict least recently used process
   */
  private async evictLRU(): Promise<void> {
    if (this.accessOrder.length === 0) {
      throw new ProcessPoolLimitError(this.config.maxProcesses);
    }

    // Find first process that's not currently processing
    let victimIndex = -1;
    for (let i = 0; i < this.accessOrder.length; i++) {
      const teamName = this.accessOrder[i];
      const process = this.processes.get(teamName);

      if (process && process.getMetrics().status === 'idle') {
        victimIndex = i;
        break;
      }
    }

    if (victimIndex === -1) {
      // All processes are busy, evict the oldest anyway
      victimIndex = 0;
    }

    const victimTeam = this.accessOrder[victimIndex];
    this.logger.info('Evicting LRU process', { teamName: victimTeam });

    await this.terminateProcess(victimTeam);
  }

  /**
   * Update access order for LRU tracking
   */
  private updateAccessOrder(teamName: string): void {
    // Remove if exists
    this.removeFromAccessOrder(teamName);

    // Add to end (most recently used)
    this.accessOrder.push(teamName);
  }

  /**
   * Remove team from access order
   */
  private removeFromAccessOrder(teamName: string): void {
    const index = this.accessOrder.indexOf(teamName);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check on all processes
   */
  private performHealthCheck(): void {
    const processesToRemove: string[] = [];

    for (const [teamName, process] of this.processes) {
      const metrics = process.getMetrics();

      // Remove stopped processes
      if (metrics.status === 'stopped') {
        processesToRemove.push(teamName);
        continue;
      }

      // Log metrics
      this.logger.debug('Process health check', {
        teamName,
        status: metrics.status,
        messagesProcessed: metrics.messagesProcessed,
        uptime: metrics.uptime,
        queueLength: metrics.queueLength,
      });
    }

    // Clean up stopped processes
    for (const teamName of processesToRemove) {
      this.logger.info('Removing stopped process from pool', { teamName });
      this.processes.delete(teamName);
      this.removeFromAccessOrder(teamName);
    }

    // Emit health check event
    this.emit('health-check', this.getStatus());
  }
}
