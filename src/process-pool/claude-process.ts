/**
 * Claude Process - Dumb Pipe for stdio communication
 *
 * This is a SIMPLIFIED process wrapper that:
 * - Spawns Claude CLI in headless mode
 * - Pipes stdio/stderr messages to cache entries
 * - Does NOT handle completion detection (that's Iris's job)
 * - Does NOT manage timeouts (that's Iris's job)
 * - Does NOT queue messages (return "busy" instead)
 *
 * Business logic lives in Iris, NOT here.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import type { IrisConfig } from "./types.js";
import { getChildLogger } from "../utils/logger.js";
import { ProcessError } from "../utils/errors.js";
import { CacheEntry } from "../cache/types.js";

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
 * Basic process metrics - compatible with ProcessMetrics interface
 */
export interface BasicProcessMetrics {
  teamName: string;
  pid: number | null;
  status: "spawning" | "idle" | "processing" | "stopped";
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
 * Claude Process - Minimal wrapper for Claude CLI
 */
export class ClaudeProcess extends EventEmitter {
  private childProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private isReady = false;
  private spawnTime = 0;
  private responseBuffer = "";
  private logger: ReturnType<typeof getChildLogger>;

  // Init promise for spawn()
  private initResolve: (() => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;

  // Metrics tracking
  private messagesProcessed = 0;
  private messageCount = 0;
  private lastActivity = 0;
  private lastUsed = 0;

  constructor(
    public readonly teamName: string,
    private irisConfig: IrisConfig,
    public readonly sessionId: string,
  ) {
    super();
    this.logger = getChildLogger(`pool:process:${teamName}`);
  }

  /**
   * Static method: Initialize session file
   * UNCHANGED from original - this works perfectly
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
    });

    try {
      // Build command args for session creation
      const args = [
        "--session-id", // Create NEW session (not resume)
        sessionId,
        "--print", // Non-interactive mode
        "ping", // REQUIRED: Add a ping command to create session conversation
      ];

      // Use 'claude' command from PATH
      const claudeCommand = "claude";

      // Log the exact command being run
      const command = `${claudeCommand} ${args.join(" ")}`;
      logger.info("Spawning claude process", {
        sessionId,
        command,
        cwd: projectPath,
      });

      // Spawn Claude
      const claudeProcess = spawn(claudeCommand, args, {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env, // Inherit environment
      });

      // Close stdin immediately - we're not sending input, just need EOF
      claudeProcess.stdin!.end();

      // Capture any errors
      let spawnError: Error | null = null;
      let stdoutData = "";
      let stderrData = "";
      let debugLogPath: string | null = null;

      claudeProcess.on("error", (err) => {
        logger.error(
          {
            err,
            sessionId,
          },
          "Process spawn error",
        );
        spawnError = err;
      });

      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        let responseReceived = false;
        let timeoutHandle: NodeJS.Timeout | null = null;

        // Listen for stdout data (response from Claude)
        claudeProcess.stdout!.on("data", (data) => {
          const output = data.toString();
          stdoutData += output;

          logger.debug("Session init stdout", {
            sessionId,
            output: output.substring(0, 500),
          });

          // If we got any response, consider it successful
          if (output.length > 0) {
            responseReceived = true;
          }
        });

        // Listen for stderr data (errors from Claude)
        claudeProcess.stderr!.on("data", (data) => {
          const errorOutput = data.toString();
          stderrData += errorOutput;

          // Capture debug log path if present
          const logPathMatch = errorOutput.match(/Logging to: (.+)/);
          if (logPathMatch && !debugLogPath) {
            debugLogPath = logPathMatch[1].trim();
            logger.info("Claude debug logs available at", {
              sessionId,
              debugLogPath,
            });
          }

          // Log stderr in real-time for debugging
          logger.info("Session init stderr", {
            sessionId,
            stderr: errorOutput,
          });
        });

        claudeProcess.on("exit", (code) => {
          // Clear timeout immediately to prevent spurious timeout errors
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }

          if (spawnError) {
            logger.error(
              {
                err: spawnError,
                sessionId,
                code,
                stdoutLength: stdoutData.length,
                stderrLength: stderrData.length,
                stdout: stdoutData.substring(0, 1000),
                stderr: stderrData.substring(0, 1000),
              },
              "Process exited with spawn error",
            );
            reject(spawnError);
          } else if (code !== 0 && code !== 143) {
            // 143 is SIGTERM which is ok
            logger.error(
              {
                sessionId,
                code,
                command: `claude ${args.join(" ")}`,
                cwd: projectPath,
                stdoutLength: stdoutData.length,
                stderrLength: stderrData.length,
                stdout: stdoutData,
                stderr: stderrData,
                debugLogPath,
              },
              "Session initialization failed with non-zero exit code",
            );

            const errorMsg = [
              `Session initialization failed with exit code ${code}`,
              debugLogPath ? `Debug logs: ${debugLogPath}` : null,
              `stderr: ${stderrData}`,
            ]
              .filter(Boolean)
              .join("\n");

            reject(new ProcessError(errorMsg, projectPath));
          } else if (!responseReceived) {
            logger.error(
              {
                sessionId,
                code,
                command: `${claudeCommand} ${args.join(" ")}`,
                cwd: projectPath,
                stdoutLength: stdoutData.length,
                stderrLength: stderrData.length,
                stdout: stdoutData,
                stderr: stderrData,
                debugLogPath,
              },
              "Session initialization completed but no response received",
            );

            const errorMsg = [
              "Session initialization completed but no response received",
              debugLogPath ? `Debug logs: ${debugLogPath}` : null,
              `stderr: ${stderrData}`,
            ]
              .filter(Boolean)
              .join("\n");

            reject(new ProcessError(errorMsg, projectPath));
          } else {
            // Accept any response - session file creation is what matters
            logger.info(
              "Session initialization process completed successfully",
              {
                sessionId,
                code,
                stdoutLength: stdoutData.length,
                stderrLength: stderrData.length,
                response: stdoutData.substring(0, 100),
              },
            );
            resolve();
          }
        });

        // Timeout after configured duration
        timeoutHandle = setTimeout(() => {
          timeoutHandle = null; // Clear reference
          logger.error(
            {
              sessionId,
              timeout: sessionInitTimeout,
              responseReceived,
              command: `claude ${args.join(" ")}`,
              cwd: projectPath,
              stdoutLength: stdoutData.length,
              stderrLength: stderrData.length,
              stdout: stdoutData,
              stderr: stderrData,
              debugLogPath,
            },
            "Session initialization timed out",
          );
          claudeProcess.kill();

          const errorMsg = [
            `Session initialization timed out after ${sessionInitTimeout}ms.`,
            `Response received: ${responseReceived}`,
            debugLogPath ? `Debug logs: ${debugLogPath}` : null,
            `stderr: ${stderrData}`,
          ]
            .filter(Boolean)
            .join("\n");

          reject(new ProcessError(errorMsg, projectPath));
        }, sessionInitTimeout);
      });

      // Verify session file was created
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
    if (this.childProcess) {
      throw new ProcessError("Process already spawned", this.teamName);
    }

    this.logger.info("Spawning Claude process", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      cacheEntryType: spawnCacheEntry.cacheEntryType,
    });

    // Set current cache entry for init messages
    this.currentCacheEntry = spawnCacheEntry;
    this.spawnTime = Date.now();

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

    // Spawn process
    this.childProcess = spawn("claude", args, {
      cwd: this.irisConfig.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.logger.info("Process spawned", {
      teamName: this.teamName,
      pid: this.childProcess.pid,
    });

    // Setup stdio handlers
    this.setupStdioHandlers();

    // Emit spawned event
    this.emit("process-spawned", {
      teamName: this.teamName,
      pid: this.childProcess.pid,
    });

    // Send spawn ping
    this.writeToStdin(spawnCacheEntry.tellString);

    // Wait for init message
    await this.waitForInit(spawnTimeout);

    this.isReady = true;
    this.logger.info("Process ready", { teamName: this.teamName });
  }

  /**
   * Execute tell
   * @param cacheEntry - CacheEntry with type=TELL, tellString=message
   */
  executeTell(cacheEntry: CacheEntry): void {
    if (!this.isReady) {
      throw new ProcessError("Process not ready", this.teamName);
    }

    if (this.currentCacheEntry) {
      throw new ProcessBusyError("Process already processing a request");
    }

    this.logger.debug("Executing tell", {
      teamName: this.teamName,
      cacheEntryType: cacheEntry.cacheEntryType,
      tellStringLength: cacheEntry.tellString.length,
    });

    // Set current cache entry
    this.currentCacheEntry = cacheEntry;

    // Update metrics
    this.messageCount++;
    this.lastUsed = Date.now();

    // Write to stdin
    this.writeToStdin(cacheEntry.tellString);
  }

  /**
   * Setup stdio handlers (SIMPLIFIED - just pipes to cache)
   */
  private setupStdioHandlers(): void {
    if (!this.childProcess) return;

    // Stdout handler
    this.childProcess.stdout!.on("data", (data) => {
      this.handleStdoutData(data);
    });

    // Stderr handler
    this.childProcess.stderr!.on("data", (data) => {
      this.logger.debug("Claude stderr", {
        teamName: this.teamName,
        output: data.toString().substring(0, 500),
      });
    });

    // Exit handler
    this.childProcess.on("exit", (code, signal) => {
      this.logger.info("Process exited", {
        teamName: this.teamName,
        code,
        signal,
      });

      this.emit("process-exited", {
        teamName: this.teamName,
        code,
        signal,
      });

      this.childProcess = null;
      this.isReady = false;
      this.currentCacheEntry = null;
    });

    // Error handler
    this.childProcess.on("error", (error) => {
      this.logger.error(
        {
          err: error,
          teamName: this.teamName,
        },
        "Process error",
      );

      this.emit("process-error", {
        teamName: this.teamName,
        error,
      });
    });
  }

  /**
   * Handle stdout data (DUMB PIPE - just write to cache)
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

        this.logger.debug("Parsed JSON message", {
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

        // Clear current cache entry on result (but don't notify anyone - that's Iris's job)
        if (json.type === "result") {
          this.logger.debug("Result message received, clearing cache entry", {
            teamName: this.teamName,
          });

          // Update metrics
          this.messagesProcessed++;
          this.lastActivity = Date.now();

          this.currentCacheEntry = null;
        }
      } catch (e) {
        // Not JSON, ignore
        this.logger.debug("Non-JSON stdout line", {
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

    this.logger.debug("Wrote message to stdin", {
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
        reject(new ProcessError("Init timeout", this.teamName));
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
   * Get basic metrics - returns all ProcessMetrics properties
   */
  getBasicMetrics(): BasicProcessMetrics {
    // Derive status from internal state
    let status: "spawning" | "idle" | "processing" | "stopped";
    if (!this.childProcess) {
      status = "stopped";
    } else if (!this.isReady) {
      status = "spawning";
    } else if (this.currentCacheEntry) {
      status = "processing";
    } else {
      status = "idle";
    }

    return {
      teamName: this.teamName,
      pid: this.childProcess?.pid ?? null,
      status,
      messagesProcessed: this.messagesProcessed,
      lastUsed: this.lastUsed || this.spawnTime,
      uptime: this.childProcess ? Date.now() - this.spawnTime : 0,
      idleTimeRemaining: 0, // Iris manages timeouts, not ClaudeProcess
      queueLength: 0, // No queue in dumb pipe model
      sessionId: this.sessionId,
      messageCount: this.messageCount,
      lastActivity: this.lastActivity || this.spawnTime,
      // Helper properties
      isReady: this.isReady,
      isSpawning: !this.isReady && this.childProcess !== null,
      isBusy: this.currentCacheEntry !== null,
    };
  }

  /**
   * Check if spawning
   */
  isSpawning(): boolean {
    return !this.isReady && this.childProcess !== null;
  }

  /**
   * Send ESC character to stdin (attempt to cancel current operation)
   * This is experimental - may or may not work depending on Claude's headless mode implementation
   */
  cancel(): void {
    if (!this.childProcess || !this.childProcess.stdin) {
      throw new ProcessError("Process stdin not available", this.teamName);
    }

    this.logger.info("Sending ESC to stdin (cancel attempt)", {
      teamName: this.teamName,
      pid: this.childProcess.pid,
      isBusy: this.currentCacheEntry !== null,
    });

    // Send ESC character (ASCII 27 / 0x1B)
    this.childProcess.stdin.write('\x1B');

    this.logger.debug("ESC character sent to stdin");
  }

  /**
   * Terminate process
   */
  async terminate(): Promise<void> {
    if (!this.childProcess) return;

    this.logger.info("Terminating process", { teamName: this.teamName });

    return new Promise<void>((resolve) => {
      if (!this.childProcess) {
        resolve();
        return;
      }

      // Force kill after 5 seconds
      const killTimer = setTimeout(() => {
        if (this.childProcess) {
          this.logger.warn("Force killing process");
          this.childProcess.kill("SIGKILL");
        }
      }, 5000);

      // Clean up on exit
      this.childProcess.once("exit", () => {
        clearTimeout(killTimer);
        this.childProcess = null;
        this.isReady = false;
        this.currentCacheEntry = null;
        this.emit("process-terminated", { teamName: this.teamName });
        resolve();
      });

      // Try graceful shutdown first
      this.childProcess.kill("SIGTERM");
    });
  }
}
