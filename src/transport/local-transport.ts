/**
 * Local Transport - Direct child_process.spawn execution
 *
 * This transport executes Claude Code locally using child_process.spawn.
 * It's the default transport and mirrors the original ClaudeProcess behavior.
 */

import { spawn, type ChildProcess } from "child_process";
import { BehaviorSubject, Subject, Observable, firstValueFrom } from "rxjs";
import { filter, take, timeout } from "rxjs/operators";
import type { CacheEntry } from "../cache/types.js";
import type {
  Transport,
  TransportMetrics,
  TransportStatus,
  CommandInfo,
} from "./transport.interface.js";
import { TransportStatus as Status } from "./transport.interface.js";
import type { IrisConfig } from "../process-pool/types.js";
import { getChildLogger } from "../utils/logger.js";
import { ProcessError } from "../utils/errors.js";
import { ClaudeCommandBuilder } from "../utils/command-builder.js";
import { writeMcpConfigLocal } from "../utils/mcp-config-writer.js";

/**
 * Error thrown when process is busy
 */
export class ProcessBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessBusyError";
  }
}

/**
 * LocalTransport - Executes Claude locally via child_process
 */
export class LocalTransport implements Transport {
  private childProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private ready = false;
  private startTime = 0;
  private responseBuffer = "";
  private logger: ReturnType<typeof getChildLogger>;

  // RxJS Reactive Streams
  private statusSubject = new BehaviorSubject<TransportStatus>(Status.STOPPED);
  public status$: Observable<TransportStatus>;

  private errorsSubject = new Subject<Error>();
  public errors$: Observable<Error>;

  // Init promise for spawn()
  private initResolve: (() => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;

  // Metrics tracking
  private messagesProcessed = 0;
  private lastResponseAt: number | null = null;

  // Debug info (captured during spawn)
  private launchCommand: string | null = null;
  private teamConfigSnapshot: string | null = null;

  // MCP config file path (for cleanup)
  private mcpConfigFilePath: string | null = null;

  constructor(
    private teamName: string,
    private irisConfig: IrisConfig,
    private sessionId: string,
  ) {
    this.logger = getChildLogger(`transport:local:${teamName}`);

    // Expose observables
    this.status$ = this.statusSubject.asObservable();
    this.errors$ = this.errorsSubject.asObservable();
  }

  /**
   * Spawn Claude process locally
   */
  async spawn(
    spawnCacheEntry: CacheEntry,
    commandInfo: CommandInfo,
    spawnTimeout = 20000,
  ): Promise<void> {
    if (this.childProcess) {
      throw new ProcessError("Process already spawned", this.teamName);
    }

    this.logger.info("Spawning local Claude process", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      cacheEntryType: spawnCacheEntry.cacheEntryType,
      executable: commandInfo.executable,
      argsCount: commandInfo.args.length,
    });

    // Emit SPAWNING status
    this.statusSubject.next(Status.SPAWNING);

    // Set current cache entry for init messages
    this.currentCacheEntry = spawnCacheEntry;
    this.startTime = Date.now();

    // Capture launch command for debugging
    const quotedArgs = commandInfo.args.map((arg) =>
      arg.includes(" ") || arg.includes('"')
        ? `"${arg.replace(/"/g, '\\"')}"`
        : arg,
    );
    this.launchCommand = `${commandInfo.executable} ${quotedArgs.join(" ")}`;

    // Capture team config snapshot for debugging
    this.teamConfigSnapshot = this.buildTeamConfigSnapshot();

    // Build and write MCP config file if reverse MCP is enabled
    if (this.irisConfig.enableReverseMcp) {
      this.logger.debug("Building MCP config for local transport", {
        teamName: this.teamName,
        sessionId: this.sessionId,
      });

      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        this.irisConfig,
        this.sessionId,
      );

      this.mcpConfigFilePath = await writeMcpConfigLocal(
        mcpConfig,
        this.sessionId,
        this.irisConfig.mcpConfigScript,
      );

      this.logger.debug("MCP config file written", {
        teamName: this.teamName,
        filePath: this.mcpConfigFilePath,
      });

      // Add --mcp-config to args
      commandInfo.args.push("--mcp-config", this.mcpConfigFilePath);

      // Update launch command for debugging
      const updatedQuotedArgs = commandInfo.args.map((arg) =>
        arg.includes(" ") || arg.includes('"')
          ? `"${arg.replace(/"/g, '\\"')}"`
          : arg,
      );
      this.launchCommand = `${commandInfo.executable} ${updatedQuotedArgs.join(" ")}`;
    }

    this.logger.debug(
      {
        teamName: this.teamName,
        sessionId: this.sessionId,
        command: this.launchCommand,
      },
      "Launch command for local transport",
    );

    // Spawn process using pre-built command info
    this.childProcess = spawn(commandInfo.executable, commandInfo.args, {
      cwd: commandInfo.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.logger.info("Local process spawned", {
      teamName: this.teamName,
      pid: this.childProcess.pid,
    });

    // Setup stdio handlers
    this.setupStdioHandlers();

    // Send spawn ping
    this.writeToStdin(spawnCacheEntry.tellString);

    // Wait for init message
    await this.waitForInit(spawnTimeout);

    // Mark transport as ready
    this.ready = true;

    // Wait for the spawn ping to complete (result message received)
    // The handleStdoutData() will clear currentCacheEntry and emit Status.READY
    await firstValueFrom(
      this.status$.pipe(
        filter((status) => status === Status.READY),
        take(1),
        timeout(spawnTimeout),
      ),
    );

    this.logger.info("Local transport ready", { teamName: this.teamName });
  }

  /**
   * Execute tell by writing to stdin
   */
  executeTell(cacheEntry: CacheEntry): void {
    if (!this.ready) {
      throw new ProcessError("Process not ready", this.teamName);
    }

    if (this.currentCacheEntry) {
      throw new ProcessBusyError("Process already processing a request");
    }

    this.logger.debug("Executing tell on local transport", {
      teamName: this.teamName,
      cacheEntryType: cacheEntry.cacheEntryType,
      tellStringLength: cacheEntry.tellString.length,
    });

    // Emit BUSY status
    this.statusSubject.next(Status.BUSY);

    // Set current cache entry
    this.currentCacheEntry = cacheEntry;

    // Write to stdin
    this.writeToStdin(cacheEntry.tellString);
  }

  /**
   * Terminate local process
   */
  async terminate(): Promise<void> {
    if (!this.childProcess) return;

    this.logger.info("Terminating local process", { teamName: this.teamName });

    // Emit TERMINATING status
    this.statusSubject.next(Status.TERMINATING);

    return new Promise<void>((resolve) => {
      if (!this.childProcess) {
        resolve();
        return;
      }

      // Force kill after 5 seconds
      const killTimer = setTimeout(() => {
        if (this.childProcess) {
          this.logger.warn("Force killing local process");
          this.childProcess.kill("SIGKILL");
        }
      }, 5000);

      // Clean up on exit
      this.childProcess.once("exit", async () => {
        clearTimeout(killTimer);
        this.childProcess = null;
        this.ready = false;
        this.currentCacheEntry = null;

        // Clean up MCP config file if it exists
        if (this.mcpConfigFilePath) {
          try {
            const fs = await import("fs/promises");
            await fs.unlink(this.mcpConfigFilePath);
            this.logger.debug("Deleted MCP config file", {
              teamName: this.teamName,
              filePath: this.mcpConfigFilePath,
            });
          } catch (error) {
            this.logger.warn("Failed to delete MCP config file", {
              teamName: this.teamName,
              filePath: this.mcpConfigFilePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          this.mcpConfigFilePath = null;
        }

        // Emit STOPPED status
        this.statusSubject.next(Status.STOPPED);

        resolve();
      });

      // Try graceful shutdown first
      this.childProcess.kill("SIGTERM");
    });
  }

  /**
   * Check if transport is ready
   */
  isReady(): boolean {
    return this.ready && this.currentCacheEntry === null;
  }

  /**
   * Check if currently processing
   */
  isBusy(): boolean {
    return this.currentCacheEntry !== null;
  }

  /**
   * Get transport metrics
   */
  getMetrics(): TransportMetrics {
    return {
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      messagesProcessed: this.messagesProcessed,
      lastResponseAt: this.lastResponseAt,
    };
  }

  /**
   * Get process ID (local only)
   */
  getPid(): number | null {
    return this.childProcess?.pid ?? null;
  }

  /**
   * Send ESC character to stdin (attempt to cancel)
   */
  cancel(): void {
    if (!this.childProcess || !this.childProcess.stdin) {
      this.logger.warn("Cancel called but process stdin not available", {
        teamName: this.teamName,
        hasProcess: !!this.childProcess,
      });
      return; // Gracefully handle unspawned transport
    }

    this.logger.info("Sending ESC to local stdin (cancel attempt)", {
      teamName: this.teamName,
      pid: this.childProcess.pid,
      isBusy: this.currentCacheEntry !== null,
    });

    // Send ESC character (ASCII 27 / 0x1B)
    this.childProcess.stdin.write("\x1B");

    this.logger.debug("ESC character sent to local stdin");
  }

  /**
   * Setup stdio handlers
   */
  private setupStdioHandlers(): void {
    if (!this.childProcess) return;

    // Stdout handler
    this.childProcess.stdout!.on("data", (data) => {
      this.handleStdoutData(data);
    });

    // Stderr handler
    this.childProcess.stderr!.on("data", (data) => {
      this.logger.debug("Local Claude stderr", {
        teamName: this.teamName,
        output: data.toString().substring(0, 500),
      });
    });

    // Exit handler
    this.childProcess.on("exit", (code, signal) => {
      this.logger.info("Local process exited", {
        teamName: this.teamName,
        code,
        signal,
      });

      this.childProcess = null;
      this.ready = false;
      this.currentCacheEntry = null;
      this.startTime = 0; // Reset uptime so getMetrics() returns uptime: 0

      // Emit STOPPED status
      this.statusSubject.next(Status.STOPPED);
    });

    // Error handler
    this.childProcess.on("error", (error) => {
      this.logger.error(
        {
          err: error,
          teamName: this.teamName,
        },
        "Local process error",
      );

      // Emit error to errors$ stream
      this.errorsSubject.next(error);

      // Emit ERROR status
      this.statusSubject.next(Status.ERROR);
    });
  }

  /**
   * Handle stdout data (parse JSON and write to cache)
   */
  private handleStdoutData(data: Buffer): void {
    const rawData = data.toString();
    this.responseBuffer += rawData;

    // Parse newline-delimited JSON
    const lines = this.responseBuffer.split("\n");
    this.responseBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);

        this.logger.debug("Parsed JSON message from local transport", {
          type: json.type,
          subtype: json.subtype,
        });

        // DUMB PIPE: Just write to current cache entry
        if (this.currentCacheEntry) {
          this.currentCacheEntry.addMessage(json);
        }

        // Special handling for init (resolve spawn promise)
        if (json.type === "system" && json.subtype === "init") {
          if (this.initResolve) {
            this.initResolve();
            this.initResolve = null;
            this.initReject = null;
          }
        }

        // Clear current cache entry on result
        if (json.type === "result") {
          this.logger.debug("Result message received, clearing cache entry", {
            teamName: this.teamName,
          });

          // Update metrics
          this.messagesProcessed++;
          this.lastResponseAt = Date.now();

          this.currentCacheEntry = null;

          // Emit READY status (back to idle)
          this.statusSubject.next(Status.READY);
        }
      } catch (e) {
        // Not JSON, ignore
        this.logger.debug("Non-JSON stdout line from local transport", {
          line: line.substring(0, 200),
        });
      }
    }
  }

  /**
   * Write message to stdin
   */
  private writeToStdin(message: string): void {
    if (!this.childProcess || !this.childProcess.stdin) {
      throw new ProcessError("Process stdin not available", this.teamName);
    }

    const userMessage = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    };

    this.childProcess.stdin.write(JSON.stringify(userMessage) + "\n");

    this.logger.debug("Wrote message to local stdin", {
      teamName: this.teamName,
      messageLength: message.length,
    });
  }

  /**
   * Wait for init message during spawn
   */
  private async waitForInit(timeout = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;

      const timeoutId = setTimeout(() => {
        this.initReject = null;
        this.initResolve = null;
        reject(
          new ProcessError("Init timeout on local transport", this.teamName),
        );
      }, timeout);

      // Wrap resolve to clear timeout
      const originalResolve = this.initResolve;
      this.initResolve = () => {
        clearTimeout(timeoutId);
        originalResolve();
      };
    });
  }

  /**
   * Get launch command for debugging
   */
  getLaunchCommand(): string | null {
    return this.launchCommand;
  }

  /**
   * Get team config snapshot for debugging
   */
  getTeamConfigSnapshot(): string | null {
    return this.teamConfigSnapshot;
  }

  /**
   * Build team config snapshot (server-side parameters not in command)
   */
  private buildTeamConfigSnapshot(): string {
    const snapshot: Record<string, any> = {
      // Permission handling
      grantPermission: this.irisConfig.grantPermission || "yes",

      // Timeouts
      idleTimeout: this.irisConfig.idleTimeout,
      sessionInitTimeout: this.irisConfig.sessionInitTimeout,

      // MCP Reverse Tunneling
      enableReverseMcp: this.irisConfig.enableReverseMcp || false,
      reverseMcpPort: this.irisConfig.reverseMcpPort,
      allowHttp: this.irisConfig.allowHttp || false,

      // Remote execution (should be false for LocalTransport)
      remote: this.irisConfig.remote || null,
      ssh2: this.irisConfig.ssh2 || false,

      // Project path
      path: this.irisConfig.path,

      // Description
      description: this.irisConfig.description,
    };

    return JSON.stringify(snapshot, null, 2);
  }
}
