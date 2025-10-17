/**
 * Local Transport - Direct child_process.spawn execution
 *
 * This transport executes Claude Code locally using child_process.spawn.
 * It's the default transport and mirrors the original ClaudeProcess behavior.
 */

import { spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BehaviorSubject, Subject, Observable, firstValueFrom } from "rxjs";
import { filter, take, timeout } from "rxjs/operators";
import type { CacheEntry } from "../cache/types.js";
import type {
  Transport,
  TransportMetrics,
  TransportStatus,
} from "./transport.interface.js";
import { TransportStatus as Status } from "./transport.interface.js";
import type { IrisConfig } from "../process-pool/types.js";
import { getChildLogger } from "../utils/logger.js";
import { ProcessError } from "../utils/errors.js";

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
 * Load and render team identity prompt template
 */
function loadTeamIdentityPrompt(teamName: string): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const templatePath = join(__dirname, "..", "team-identity-prompt.txt");
    const template = readFileSync(templatePath, "utf8");

    // Simple template rendering: replace {{teamName}} with actual team name
    return template.replace(/\{\{teamName\}\}/g, teamName);
  } catch (error) {
    // Fallback if template file not found
    return `# Iris MCP ${teamName}\n\nThis is the **${teamName}** team configured in the Iris MCP server for cross-project Claude coordination.`;
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
    spawnTimeout = 20000,
  ): Promise<void> {
    if (this.childProcess) {
      throw new ProcessError("Process already spawned", this.teamName);
    }

    this.logger.info("Spawning local Claude process", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      cacheEntryType: spawnCacheEntry.cacheEntryType,
    });

    // Emit SPAWNING status
    this.statusSubject.next(Status.SPAWNING);

    // Set current cache entry for init messages
    this.currentCacheEntry = spawnCacheEntry;
    this.startTime = Date.now();

    // Build args
    const args: string[] = [];

    // Resume existing session (not in test mode)
    if (process.env.NODE_ENV !== "test") {
      args.push("--resume", this.sessionId);
    }

    // Enable debug mode in test/debug environment
    if (process.env.NODE_ENV === "test" || process.env.DEBUG) {
      args.push("--debug");
    }

    args.push(
      "--print", // Non-interactive headless mode
      "--verbose", // Required for stream-json output
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    );

    if (this.irisConfig.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (this.irisConfig.allowedTools) {
      args.push("--allowed-tools", this.irisConfig.allowedTools);
    }

    if (this.irisConfig.disallowedTools) {
      args.push("--disallowed-tools", this.irisConfig.disallowedTools);
    }

    // Build system prompt: team identity + custom append
    const teamIdentity = loadTeamIdentityPrompt(this.teamName);
    const systemPrompt = this.irisConfig.appendSystemPrompt
      ? `${teamIdentity}\n\n${this.irisConfig.appendSystemPrompt}`
      : teamIdentity;

    args.push("--append-system-prompt", systemPrompt);

    // Add MCP config to override global config with session-specific path
    // This enables permission detection via sessionId
    const mcpPort = 1615; // TODO: Get from config
    const mcpUrl = `http://localhost:${mcpPort}/mcp/${this.sessionId}`;

    const mcpConfig = {
      mcpServers: {
        iris: {
          type: "http",
          url: mcpUrl,
        },
      },
    };

    args.push("--mcp-config", JSON.stringify(mcpConfig));

    this.logger.debug("Added MCP config to local Claude command", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      mcpUrl,
    });

    // Use custom claudePath if provided, otherwise default to 'claude'
    const claudeExecutable = this.irisConfig.claudePath || "claude";

    // Spawn process
    this.childProcess = spawn(claudeExecutable, args, {
      cwd: this.irisConfig.path,
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
      this.childProcess.once("exit", () => {
        clearTimeout(killTimer);
        this.childProcess = null;
        this.ready = false;
        this.currentCacheEntry = null;

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
}
