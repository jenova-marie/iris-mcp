/**
 * Transport Interface - Abstraction for local vs remote execution
 *
 * This interface defines the contract for executing Claude Code processes,
 * whether locally (child_process.spawn) or remotely (SSH tunneling).
 */

import type { CacheEntry } from '../cache/types.js';

/**
 * Transport metrics for monitoring performance
 */
export interface TransportMetrics {
  /** Uptime in milliseconds since spawn */
  uptime: number;

  /** Number of messages successfully processed */
  messagesProcessed: number;

  /** Timestamp of last response received (null if never) */
  lastResponseAt: number | null;
}

/**
 * Transport abstraction for Claude Code execution
 *
 * Implementations:
 * - LocalTransport: Direct child_process.spawn (existing behavior)
 * - RemoteSSHTransport: SSH tunneling to remote host
 * - Future: DockerTransport, KubernetesTransport, WSLTransport
 */
export interface Transport {
  /**
   * Spawn Claude process (local or remote)
   *
   * For local: spawns `claude` via child_process
   * For remote: spawns `ssh user@host 'cd /path && claude ...'`
   *
   * @param spawnCacheEntry - Cache entry for initialization message (type=SPAWN, tellString='ping')
   * @param spawnTimeout - Timeout in ms for spawn init (default: 20000)
   * @throws ProcessError if spawn fails
   */
  spawn(spawnCacheEntry: CacheEntry, spawnTimeout?: number): Promise<void>;

  /**
   * Execute tell by writing to stdin
   *
   * Writes user message to Claude's stdin (local or remote).
   *
   * @param cacheEntry - Cache entry containing message (type=TELL)
   * @throws ProcessError if transport not ready
   * @throws ProcessBusyError if already processing
   */
  executeTell(cacheEntry: CacheEntry): void;

  /**
   * Terminate process gracefully
   *
   * Sends SIGTERM and waits for exit, with SIGKILL fallback after 5s.
   * For remote: terminates SSH connection.
   */
  terminate(): Promise<void>;

  /**
   * Check if transport is ready to receive messages
   *
   * Returns true if:
   * - Process spawned successfully
   * - Init message received
   * - Not currently processing a message
   */
  isReady(): boolean;

  /**
   * Check if currently processing a message
   *
   * Returns true if a tell is in progress (currentCacheEntry !== null)
   */
  isBusy(): boolean;

  /**
   * Get transport metrics (uptime, messages, etc.)
   */
  getMetrics(): TransportMetrics;

  /**
   * Send ESC character to stdin (attempt to cancel current operation)
   *
   * This is experimental - may or may not work depending on Claude's headless mode.
   * For remote: sends ESC through SSH tunnel.
   *
   * @throws ProcessError if stdin not available
   */
  cancel?(): void;
}
