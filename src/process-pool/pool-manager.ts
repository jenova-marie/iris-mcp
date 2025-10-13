/**
 * Iris MCP - Process Pool Manager
 * Manages a pool of Claude Code processes with LRU eviction
 */

import { EventEmitter } from "events";
import { ClaudeProcess } from "./claude-process.js";
import type { ProcessPoolStatus, ProcessPoolConfig } from "./types.js";
import { TeamsConfigManager } from "../config/teams-config.js";
import { getChildLogger } from "../utils/logger.js";
import { TeamNotFoundError, ProcessPoolLimitError } from "../utils/errors.js";
import { CacheEntryImpl } from "../cache/cache-entry.js";
import { CacheEntryType } from "../cache/types.js";
import { filter } from "rxjs/operators";

export class ClaudeProcessPool extends EventEmitter {
  private processes = new Map<string, ClaudeProcess>();
  private sessionToProcess = new Map<string, string>(); // sessionId -> poolKey mapping
  private accessOrder: string[] = []; // For LRU tracking
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private logger = getChildLogger("pool:manager");

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
   * Format: "fromTeam->toTeam"
   * This maintains conversation isolation between different team pairs
   */
  private getPoolKey(fromTeam: string, toTeam: string): string {
    return `${fromTeam}->${toTeam}`;
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
   * @param fromTeam - The requesting team
   */
  async getOrCreateProcess(
    teamName: string,
    sessionId: string,
    fromTeam: string,
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
    if (existing && existing.getBasicMetrics().status !== "stopped") {
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

    const process = new ClaudeProcess(teamName, teamConfig, sessionId);

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

    // Spawn the process with a temporary cache entry for init ping
    try {
      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await process.spawn(spawnCacheEntry);

      // Add to pool with pool key
      this.processes.set(poolKey, process);
      this.sessionToProcess.set(sessionId, poolKey);
      this.updateAccessOrder(poolKey);

      this.logger.info("Process successfully added to pool", {
        poolKey,
        teamName,
        sessionId,
        totalProcesses: this.processes.size,
      });

      return process;
    } catch (error) {
      // CRITICAL: Clean up the failed process
      // The process object exists but spawn failed, so it's in a zombie state
      this.logger.error({
        err: error instanceof Error ? error : new Error(String(error)),
        poolKey,
        teamName,
        sessionId,
      }, "Process spawn failed, cleaning up");

      // Terminate the zombie process to clean up any resources
      await process.terminate().catch((termError) => {
        this.logger.warn({
          err: termError instanceof Error ? termError : new Error(String(termError)),
          poolKey,
        }, "Failed to terminate zombie process");
      });

      // Re-throw the original error
      throw error;
    }
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
    this.logger.info("Terminating all processes");

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
      const metrics = process.getBasicMetrics();

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
   * Log current pool state for debugging
   */
  logPoolState(context: string): void {
    const status = this.getStatus();

    this.logger.debug("Pool state snapshot", {
      context,
      totalProcesses: status.totalProcesses,
      maxProcesses: status.maxProcesses,
      activeSessions: status.activeSessions,
      processes: Object.entries(status.processes).map(([key, proc]) => ({
        poolKey: key,
        status: proc.status,
        pid: proc.pid,
        sessionId: proc.sessionId,
        messageCount: proc.messageCount,
      })),
      accessOrder: this.accessOrder,
      sessionMappings: Array.from(this.sessionToProcess.entries()),
    });
  }

  /**
   * Get process for a team (if exists)
   * @deprecated Use getProcessBySessionId or getOrCreateProcess instead
   */
  getProcess(teamName: string): ClaudeProcess | undefined {
    // Search for any process where toTeam matches (pool key format: "fromTeam->toTeam")
    for (const [poolKey, process] of this.processes) {
      if (poolKey.endsWith(`->${teamName}`)) {
        return process;
      }
    }
    return undefined;
  }

  /**
   * Send a command to a process (for compaction, etc.)
   * Creates a temporary cache entry to send the command using the new architecture
   */
  async sendCommandToSession(
    sessionId: string,
    command: string,
  ): Promise<string | null> {
    const process = this.getProcessBySessionId(sessionId);
    if (!process) {
      this.logger.warn("No process found for session", { sessionId });
      return null;
    }

    try {
      // Create temporary cache entry for this command
      const commandEntry = new CacheEntryImpl(CacheEntryType.TELL, command);

      // Execute the command (non-blocking)
      process.executeTell(commandEntry);

      // Wait for result with timeout
      const response = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Command timeout after 30s"));
        }, 30000);

        // Subscribe to result message
        const subscription = commandEntry.messages$
          .pipe(filter((msg) => msg.type === "result"))
          .subscribe(() => {
            clearTimeout(timeout);
            subscription.unsubscribe();

            // Extract response from assistant messages
            const messages = commandEntry.getMessages();
            const assistantMessages = messages.filter(
              (m) => m.type === "assistant",
            );
            const response = assistantMessages
              .map((m) => m.data.message?.content?.[0]?.text || "")
              .join("\n");

            resolve(response);
          });
      });

      this.logger.info({ sessionId, command }, "Command sent to session");
      return response;
    } catch (error) {
      this.logger.error({
        err: error instanceof Error ? error : new Error(String(error)),
        sessionId,
        command,
      }, "Failed to send command to session");
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

      if (process && process.getBasicMetrics().status === "idle") {
        victimIndex = i;
        break;
      }
    }

    if (victimIndex === -1) {
      // All processes are busy, evict the oldest anyway
      victimIndex = 0;
    }

    const victimPoolKey = this.accessOrder[victimIndex];
    const victimProcess = this.processes.get(victimPoolKey);

    if (!victimProcess) {
      // Pool key exists in accessOrder but process is gone - clean up and retry
      this.removeFromAccessOrder(victimPoolKey);
      return this.evictLRU();
    }

    this.logger.info("Evicting LRU process", { poolKey: victimPoolKey });

    // Directly terminate the process - event handlers will clean up the maps
    await victimProcess.terminate();
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
      const metrics = process.getBasicMetrics();

      // Remove stopped processes
      if (metrics.status === "stopped") {
        processesToRemove.push(teamName);
        continue;
      }

      // Log metrics
      this.logger.debug("Process health check", {
        teamName,
        status: metrics.status,
        messagesProcessed: metrics.messagesProcessed,
        uptime: metrics.uptime,
        queueLength: metrics.queueLength,
      });
    }

    // Clean up stopped processes
    for (const teamName of processesToRemove) {
      this.logger.info("Removing stopped process from pool", { teamName });
      this.processes.delete(teamName);
      this.removeFromAccessOrder(teamName);
    }

    // Emit health check event
    this.emit("health-check", this.getStatus());
  }
}
