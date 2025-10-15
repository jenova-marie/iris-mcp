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

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import type { IrisConfig } from "./types.js";
import { getChildLogger } from "../utils/logger.js";
import { ProcessError } from "../utils/errors.js";
import { CacheEntry } from "../cache/types.js";
import { TransportFactory } from "../transport/transport-factory.js";
import type { Transport } from "../transport/transport.interface.js";
import { ProcessBusyError } from "../transport/local-transport.js";

// ProcessBusyError now exported from local-transport.ts
export { ProcessBusyError };

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

  constructor(
    public readonly teamName: string,
    private irisConfig: IrisConfig,
    public readonly sessionId: string,
  ) {
    super();
    this.logger = getChildLogger(`pool:process:${teamName}`);

    // Create transport using factory (Phase 1: LocalTransport only)
    this.transport = TransportFactory.create(teamName, irisConfig, sessionId);

    // Forward transport events to ClaudeProcess events
    // Transport implementations (LocalTransport, SSH2Transport) extend EventEmitter
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
    this.logger.info("Spawning Claude process via transport", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      cacheEntryType: spawnCacheEntry.cacheEntryType,
      transportType: this.transport.constructor.name,
    });

    this.spawnTime = Date.now();

    // Delegate to transport
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

    // Delegate to transport
    this.transport.executeTell(cacheEntry);
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

    // Derive status from transport state
    let status: "spawning" | "idle" | "processing" | "stopped";

    // If uptime is 0, process never started or was terminated
    if (transportMetrics.uptime === 0) {
      status = "stopped";
    }
    // If there's no PID but we have uptime, either spawning or terminated
    else if (pid === null) {
      // Check if we ever got ready - if so, it's now stopped
      if (transportMetrics.messagesProcessed > 0 || isReady) {
        status = "stopped";
      } else {
        status = "spawning";
      }
    }
    // Process is alive (has PID)
    else if (isBusy) {
      status = "processing";
    } else if (isReady) {
      status = "idle";
    } else {
      // Has PID but not ready yet = spawning
      status = "spawning";
    }

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
      isSpawning: status === "spawning",
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

    // Delegate to transport
    await this.transport.terminate();

    this.logger.info("Process terminated via transport", {
      teamName: this.teamName,
    });
  }
}
