/**
 * Claude Process - Dumb Pipe for stdio communication
 *
 * Phase 1 Refactor: Now uses Transport abstraction for local/remote execution.
 *
 * This is a SIMPLIFIED process wrapper that:
 * - Delegates to Transport for actual execution (local or remote)
 * - Provides consistent interface regardless of execution method
 * - Does NOT handle completion detection (that's Iris's job)
 * - Does NOT manage timeouts (that's Iris's job)
 * - Does NOT queue messages (return "busy" instead)
 *
 * Business logic lives in Iris, NOT here.
 */

import { EventEmitter } from "events";
import { existsSync } from "fs";
import { BehaviorSubject, Observable, Subject, Subscription } from "rxjs";
import type { IrisConfig } from "./types.js";
import { getChildLogger } from "../utils/logger.js";
import { ProcessError } from "../utils/errors.js";
import { CacheEntry, CacheEntryType, CacheEntryStatus } from "../cache/types.js";
import { TransportFactory } from "../transport/transport-factory.js";
import type { Transport } from "../transport/transport.interface.js";
import { TransportStatus } from "../transport/transport.interface.js";
import { ProcessBusyError } from "../transport/local-transport.js";
import { ClaudePrintExecutor } from "../utils/claude-print.js";
import { CacheEntryImpl } from "../cache/cache-entry.js";

// ProcessBusyError now exported from local-transport.ts
export { ProcessBusyError };

/**
 * Process status enum
 */
export enum ProcessStatus {
  STOPPED = "stopped",
  SPAWNING = "spawning",
  IDLE = "idle",
  PROCESSING = "processing",
}

/**
 * Basic process metrics - compatible with ProcessMetrics interface
 */
export interface BasicProcessMetrics {
  teamName: string;
  pid: number | null;
  status: ProcessStatus;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  idleTimeRemaining: number;
  queueLength: number;
  sessionId: string;
  messageCount: number;
  lastActivity: number;
  // Helper properties derived from status
  isReady: boolean;
  isSpawning: boolean;
  isBusy: boolean;
}

/**
 * Claude Process - Minimal wrapper delegating to Transport
 *
 * Phase 1: Uses Transport abstraction for execution
 */
export class ClaudeProcess extends EventEmitter {
  private transport: Transport;
  private logger: ReturnType<typeof getChildLogger>;
  private spawnTime = 0;

  // Metrics tracking (for compatibility with existing code)
  private messageCount = 0;
  private lastUsed = 0;

  // RxJS reactive status tracking
  private statusSubject = new BehaviorSubject<ProcessStatus>(ProcessStatus.STOPPED);
  public status$: Observable<ProcessStatus>;

  // RxJS reactive error tracking
  private errorsSubject = new Subject<Error>();
  public errors$: Observable<Error>;

  // Subscriptions for cleanup
  private subscriptions: Subscription[] = [];

  constructor(
    public readonly teamName: string,
    private irisConfig: IrisConfig,
    public readonly sessionId: string,
  ) {
    super();
    this.logger = getChildLogger(`pool:process:${teamName}`);

    // Expose status and errors observables
    this.status$ = this.statusSubject.asObservable();
    this.errors$ = this.errorsSubject.asObservable();

    // Create transport using factory (Phase 1: LocalTransport only)
    this.transport = TransportFactory.create(teamName, irisConfig, sessionId);

    // Subscribe to transport observables (replaces event forwarding)
    this.setupTransportSubscriptions();

    // Forward transport events to ClaudeProcess events (backward compatibility during migration)
    // TODO: Remove this once all consumers use observables
    const transportEmitter = this.transport as unknown as EventEmitter;

    transportEmitter.on("process-spawned", (data) => {
      this.emit("process-spawned", data);
    });

    transportEmitter.on("process-exited", (data) => {
      this.emit("process-exited", data);
    });

    transportEmitter.on("process-error", (data) => {
      this.emit("process-error", data);
    });

    transportEmitter.on("process-terminated", (data) => {
      this.emit("process-terminated", data);
    });

    this.logger.debug("ClaudeProcess created with transport", {
      teamName,
      transportType: this.transport.constructor.name,
    });
  }

  /**
   * Setup subscriptions to transport observables
   * Maps Transport status → ClaudeProcess status
   */
  private setupTransportSubscriptions(): void {
    // Subscribe to transport status changes
    const statusSub = this.transport.status$.subscribe((transportStatus) => {
      this.logger.debug("Transport status changed", {
        teamName: this.teamName,
        transportStatus,
      });

      // Map TransportStatus → ProcessStatus
      switch (transportStatus) {
        case TransportStatus.STOPPED:
          this.statusSubject.next(ProcessStatus.STOPPED);
          break;
        case TransportStatus.CONNECTING:
        case TransportStatus.SPAWNING:
          this.statusSubject.next(ProcessStatus.SPAWNING);
          break;
        case TransportStatus.READY:
          this.statusSubject.next(ProcessStatus.IDLE);
          break;
        case TransportStatus.BUSY:
          this.statusSubject.next(ProcessStatus.PROCESSING);
          break;
        case TransportStatus.TERMINATING:
          // Keep current status during termination
          break;
        case TransportStatus.ERROR:
          // Emit error event for backward compatibility
          // Status remains unchanged (will be set to STOPPED on exit)
          break;
      }
    });

    // Subscribe to transport errors
    const errorsSub = this.transport.errors$.subscribe((error) => {
      this.logger.error(
        {
          err: error,
          teamName: this.teamName,
        },
        "Transport error received",
      );

      // Emit to errors$ observable
      this.errorsSubject.next(error);

      // Emit process-error event for backward compatibility
      this.emit("process-error", {
        teamName: this.teamName,
        error,
      });
    });

    // Store subscriptions for cleanup
    this.subscriptions.push(statusSub, errorsSub);
  }

  /**
   * Static method: Initialize session file
   * Phase 3 Migration: Now uses ClaudePrintExecutor for local AND remote support
   */
  static async initializeSessionFile(
    irisConfig: IrisConfig,
    sessionId: string,
    sessionInitTimeout = 30000,
  ): Promise<void> {
    const logger = getChildLogger(`pool:session-init:${irisConfig.path}`);
    const projectPath = irisConfig.path;

    logger.info("Initializing session file", {
      sessionId,
      projectPath,
      sessionInitTimeout,
      remote: !!irisConfig.remote,
    });

    try {
      // Use ClaudePrintExecutor for session initialization
      // This automatically handles both local and remote execution
      const executor = ClaudePrintExecutor.create(irisConfig, sessionId);

      const result = await executor.execute({
        command: "ping", // Required: creates session conversation
        resume: false, // Use --session-id (create new session)
        timeout: sessionInitTimeout,
      });

      // Log debug log path if captured
      if (result.debugLogPath) {
        logger.info("Claude debug logs available at", {
          sessionId,
          debugLogPath: result.debugLogPath,
        });
      }

      // Check if execution was successful
      if (!result.success) {
        const errorMsg = [
          `Session initialization failed with exit code ${result.exitCode}`,
          result.debugLogPath ? `Debug logs: ${result.debugLogPath}` : null,
          `stderr: ${result.stderr}`,
        ]
          .filter(Boolean)
          .join("\n");

        throw new ProcessError(errorMsg, projectPath);
      }

      // Log successful completion
      logger.info("Session initialization process completed successfully", {
        sessionId,
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        duration: result.duration,
        response: result.stdout.substring(0, 100),
        remote: !!irisConfig.remote,
      });

      // Verify session file was created (only for local teams)
      // For remote teams, the session file exists on the remote host
      if (!irisConfig.remote) {
        const sessionFilePath = ClaudeProcess.getSessionFilePath(
          projectPath,
          sessionId,
        );

        if (!existsSync(sessionFilePath)) {
          throw new ProcessError(
            `Session file was not created at ${sessionFilePath}`,
            projectPath,
          );
        }

        logger.info(
          { sessionId, filePath: sessionFilePath },
          "Session file initialized successfully",
        );
      } else {
        logger.info(
          { sessionId, remote: irisConfig.remote },
          "Remote session file initialized successfully",
        );
      }
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to initialize session file",
      );
      throw error;
    }
  }

  /**
   * Get the path to a session file
   */
  static getSessionFilePath(projectPath: string, sessionId: string): string {
    const homedir = process.env.HOME || process.env.USERPROFILE || "";
    const escapedPath = projectPath.replace(/\//g, "-");
    return `${homedir}/.claude/projects/${escapedPath}/${sessionId}.jsonl`;
  }

  /**
   * Spawn Claude process with spawn ping
   * @param spawnCacheEntry - CacheEntry with type=SPAWN, tellString='ping'
   * @param spawnTimeout - Timeout in ms for spawn init (from config)
   */
  async spawn(
    spawnCacheEntry: CacheEntry,
    spawnTimeout = 20000,
  ): Promise<void> {
    this.logger.info("Spawning Claude process via transport", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      cacheEntryType: spawnCacheEntry.cacheEntryType,
      transportType: this.transport.constructor.name,
    });

    this.spawnTime = Date.now();

    // Delegate to transport (status updates happen via transport.status$ subscription)
    await this.transport.spawn(spawnCacheEntry, spawnTimeout);

    this.logger.info("Process ready via transport", {
      teamName: this.teamName,
    });
  }

  /**
   * Execute tell
   * @param cacheEntry - CacheEntry with type=TELL, tellString=message
   */
  executeTell(cacheEntry: CacheEntry): void {
    this.logger.debug("Executing tell via transport", {
      teamName: this.teamName,
      cacheEntryType: cacheEntry.cacheEntryType,
      tellStringLength: cacheEntry.tellString.length,
    });

    // Update metrics
    this.messageCount++;
    this.lastUsed = Date.now();

    // Delegate to transport (status updates happen via transport.status$ subscription)
    this.transport.executeTell(cacheEntry);
  }

  /**
   * Convenience method for tests: Send a tell message
   * Creates a CacheEntry, delegates to executeTell, and emits events when complete
   * @param message - Message to send
   */
  tell(message: string): void {
    // Create a cache entry
    const cacheEntry = new CacheEntryImpl(CacheEntryType.TELL, message);

    // Subscribe to messages to detect completion
    cacheEntry.messages$.subscribe((msg) => {
      if (msg.type === "result") {
        // Tell completed - emit message-response event for tests
        this.emit("message-response", {
          teamName: this.teamName,
          success: msg.data.subtype === "success",
          message: msg.data,
        });
      }
    });

    this.executeTell(cacheEntry);
  }

  // Private methods removed - now in LocalTransport (and SSH2Transport in Phase 2)

  /**
   * Get basic metrics - returns all ProcessMetrics properties
   */
  getBasicMetrics(): BasicProcessMetrics {
    // Get metrics from transport
    const transportMetrics = this.transport.getMetrics();
    const isReady = this.transport.isReady();
    const isBusy = this.transport.isBusy();
    const pid = this.transport.getPid();

    // Use the current status from the BehaviorSubject (single source of truth)
    const status = this.statusSubject.value;

    return {
      teamName: this.teamName,
      pid,
      status,
      messagesProcessed: transportMetrics.messagesProcessed,
      lastUsed: this.lastUsed || this.spawnTime,
      uptime: transportMetrics.uptime,
      idleTimeRemaining: 0, // Iris manages timeouts, not ClaudeProcess
      queueLength: 0, // No queue in dumb pipe model
      sessionId: this.sessionId,
      messageCount: this.messageCount,
      lastActivity: transportMetrics.lastResponseAt || this.spawnTime,
      // Helper properties
      isReady,
      isSpawning: status === ProcessStatus.SPAWNING,
      isBusy,
    };
  }

  /**
   * Check if spawning
   */
  isSpawning(): boolean {
    const transportMetrics = this.transport.getMetrics();
    return !this.transport.isReady() && transportMetrics.uptime > 0;
  }

  /**
   * Send ESC character to stdin (attempt to cancel current operation)
   * This is experimental - may or may not work depending on Claude's headless mode implementation
   */
  cancel(): void {
    this.logger.info("Canceling via transport", {
      teamName: this.teamName,
      isBusy: this.transport.isBusy(),
    });

    // Delegate to transport (if supported)
    if (this.transport.cancel) {
      this.transport.cancel();
    } else {
      this.logger.warn("Cancel not supported by transport", {
        transportType: this.transport.constructor.name,
      });
    }
  }

  /**
   * Terminate process via transport
   */
  async terminate(): Promise<void> {
    this.logger.info("Terminating process via transport", {
      teamName: this.teamName,
      transportType: this.transport.constructor.name,
    });

    // Unsubscribe from transport observables
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Delegate to transport (status updates happen via transport.status$ subscription)
    await this.transport.terminate();

    // Complete observables (no more emissions after termination)
    this.statusSubject.complete();
    this.errorsSubject.complete();

    this.logger.info("Process terminated via transport", {
      teamName: this.teamName,
    });
  }
}
