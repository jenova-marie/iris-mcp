/**
 * Transport Interface - Abstraction for local vs remote execution
 *
 * This interface defines the contract for executing Claude Code processes,
 * whether locally (child_process.spawn) or remotely (SSH tunneling).
 */

import { Observable } from "rxjs";
import type { CacheEntry } from "../cache/types.js";
import type { CommandInfo } from "../utils/command-builder.js";

// Re-export CommandInfo for convenience
export type { CommandInfo };

/**
 * Transport status enum - represents the lifecycle state of the transport
 */
export enum TransportStatus {
  STOPPED = "stopped",
  CONNECTING = "connecting",
  SPAWNING = "spawning",
  READY = "ready",
  BUSY = "busy",
  TERMINATING = "terminating",
  ERROR = "error",
}

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
 * - SSH2Transport: SSH tunneling to remote host
 * - Future: DockerTransport, KubernetesTransport, WSLTransport
 *
 * RxJS Reactive Streams:
 * - status$: Observable of transport status changes (BehaviorSubject - current value + updates)
 * - errors$: Observable stream of errors (Subject - no initial value)
 */
export interface Transport {
  /**
   * Observable stream of transport status changes
   *
   * Emits current status immediately on subscription (BehaviorSubject).
   * Status lifecycle: STOPPED → CONNECTING → SPAWNING → READY → BUSY → READY → TERMINATING → STOPPED
   */
  status$: Observable<TransportStatus>;

  /**
   * Observable stream of transport errors
   *
   * Emits errors as they occur (does not emit initial value).
   * Errors include spawn failures, connection issues, and execution errors.
   */
  errors$: Observable<Error>;
  /**
   * Spawn Claude process (local or remote)
   *
   * For local: spawns `claude` via child_process
   * For remote: spawns `ssh user@host 'cd /path && claude ...'`
   *
   * @param spawnCacheEntry - Cache entry for initialization message (type=SPAWN, tellString='ping')
   * @param commandInfo - Pre-built command information (executable, args, cwd)
   * @param spawnTimeout - Timeout in ms for spawn init (default: 20000)
   * @throws ProcessError if spawn fails
   */
  spawn(
    spawnCacheEntry: CacheEntry,
    commandInfo: CommandInfo,
    spawnTimeout?: number,
  ): Promise<void>;

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
   * Get process ID (local only)
   *
   * Returns the OS process ID for local transports.
   * Returns null for remote transports (PID is on remote host, not locally meaningful).
   *
   * @returns number | null - PID or null if not applicable
   */
  getPid(): number | null;

  /**
   * Send ESC character to stdin (attempt to cancel current operation)
   *
   * This is experimental - may or may not work depending on Claude's headless mode.
   * For remote: sends ESC through SSH tunnel.
   *
   * @throws ProcessError if stdin not available
   */
  cancel?(): void;

  /**
   * Get the full command used to launch this session (for debugging)
   *
   * Returns the complete command string including executable and all arguments.
   * Useful for reproducing issues or understanding spawn configuration.
   *
   * @returns string | null - Command string or null if not yet spawned
   */
  getLaunchCommand?(): string | null;

  /**
   * Get snapshot of team config at spawn time (for debugging)
   *
   * Returns JSON string of server-side configuration that affects process behavior
   * but isn't visible in the command (e.g., grantPermission, idleTimeout).
   *
   * @returns string | null - JSON config snapshot or null if not yet spawned
   */
  getTeamConfigSnapshot?(): string | null;
}
