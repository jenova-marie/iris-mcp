/**
 * Iris MCP - Process Pool Manager
 * Manages a pool of Claude Code processes with LRU eviction
 */

import { EventEmitter } from 'events';
import { ClaudeProcess } from './claude-process.js';
import type { ProcessPoolStatus, ProcessPoolConfig } from './types.js';
import { TeamsConfigManager } from '../config/teams-config.js';
import { Logger } from '../utils/logger.js';
import { TeamNotFoundError, ProcessPoolLimitError } from '../utils/errors.js';

export class ClaudeProcessPool extends EventEmitter {
  private processes = new Map<string, ClaudeProcess>();
  private accessOrder: string[] = []; // For LRU tracking
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private logger = new Logger('pool');

  constructor(
    private configManager: TeamsConfigManager,
    private config: ProcessPoolConfig
  ) {
    super();
    this.startHealthCheck();
  }

  /**
   * Get or create a process for a team
   */
  async getOrCreateProcess(teamName: string): Promise<ClaudeProcess> {
    // Check if team exists in configuration
    const teamConfig = this.configManager.getTeamConfig(teamName);
    if (!teamConfig) {
      throw new TeamNotFoundError(teamName);
    }

    // Update access order for LRU
    this.updateAccessOrder(teamName);

    // Return existing process if available
    const existing = this.processes.get(teamName);
    if (existing && existing.getMetrics().status !== 'stopped') {
      this.logger.debug('Using existing process', { teamName });
      return existing;
    }

    // Check pool limit
    if (this.processes.size >= this.config.maxProcesses) {
      await this.evictLRU();
    }

    // Create new process
    this.logger.info('Creating new process', { teamName });

    const process = new ClaudeProcess(
      teamName,
      teamConfig,
      teamConfig.idleTimeout || this.config.idleTimeout
    );

    // Set up event forwarding
    process.on('spawned', (data) => this.emit('process-spawned', data));
    process.on('terminated', (data) => {
      this.emit('process-terminated', data);
      this.processes.delete(teamName);
      this.removeFromAccessOrder(teamName);
    });
    process.on('exited', (data) => {
      this.emit('process-exited', data);
      this.processes.delete(teamName);
      this.removeFromAccessOrder(teamName);
    });
    process.on('error', (data) => this.emit('process-error', data));
    process.on('message-sent', (data) => this.emit('message-sent', data));
    process.on('message-response', (data) => this.emit('message-response', data));

    // Spawn the process
    await process.spawn();

    // Add to pool
    this.processes.set(teamName, process);
    this.updateAccessOrder(teamName);

    return process;
  }

  /**
   * Send a message to a team
   */
  async sendMessage(teamName: string, message: string, timeout?: number): Promise<string> {
    const process = await this.getOrCreateProcess(teamName);
    return process.sendMessage(message, timeout);
  }

  /**
   * Terminate a specific process
   */
  async terminateProcess(teamName: string): Promise<void> {
    const process = this.processes.get(teamName);
    if (process) {
      await process.terminate();
      this.processes.delete(teamName);
      this.removeFromAccessOrder(teamName);
    }
  }

  /**
   * Terminate all processes
   */
  async terminateAll(): Promise<void> {
    this.logger.info('Terminating all processes');

    const promises: Promise<void>[] = [];
    for (const [teamName, process] of this.processes) {
      promises.push(process.terminate());
    }

    await Promise.all(promises);

    this.processes.clear();
    this.accessOrder = [];

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get pool status
   */
  getStatus(): ProcessPoolStatus {
    const processes: Record<string, any> = {};

    for (const [teamName, process] of this.processes) {
      processes[teamName] = process.getMetrics();
    }

    return {
      totalProcesses: this.processes.size,
      maxProcesses: this.config.maxProcesses,
      processes,
    };
  }

  /**
   * Get process for a team (if exists)
   */
  getProcess(teamName: string): ClaudeProcess | undefined {
    return this.processes.get(teamName);
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
