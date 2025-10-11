/**
 * Iris MCP - Claude Process Wrapper
 * Manages a single Claude Code process with stdio communication
 *
 * This implementation follows the Claude Code headless mode specification
 * documented in docs/HEADLESS_CLAUDE.md. All message formats and communication
 * patterns adhere to that specification.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import type {
  ProcessMessage,
  ProcessStatus,
  ProcessMetrics,
  TeamConfig,
} from "./types.js";
import { Logger } from "../utils/logger.js";
import { ProcessError, TimeoutError } from "../utils/errors.js";
import { ClaudeCache } from "./claude-cache.js";

export class ClaudeProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: ProcessStatus = "stopped";
  private messageQueue: ProcessMessage[] = [];
  private currentMessage: ProcessMessage | null = null;
  private responseBuffer: string = "";
  private textAccumulator: string = "";

  // Track the cache message ID for current message
  private currentCacheMessageId: string | null = null;

  private messagesProcessed = 0;
  private startTime = 0;
  private logger: Logger;
  private idleTimer: NodeJS.Timeout | null = null;
  private initPromise: Promise<void> | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;
  private initPingCompleted = false;
  private debugLogPath: string | null = null;

  // Centralized cache for process I/O
  private cache: ClaudeCache;

  constructor(
    private teamName: string,
    private teamConfig: TeamConfig,
    private idleTimeout: number,
    private sessionId?: string,
  ) {
    super();
    this.logger = new Logger(`process:${teamName}`);
    this.cache = new ClaudeCache(teamName);
  }

  /**
   * Initialize a session file using claude --session-id
   * This creates the actual .jsonl file in ~/.claude/projects/
   *
   * This is a static method that can be called without a ClaudeProcess instance.
   * Used by SessionManager during startup to create session files for all teams.
   *
   * @param teamConfig - Team configuration containing path
   * @param sessionId - UUID for the session
   * @param sessionInitTimeout - Optional timeout in ms (default: 30000)
   */
  static async initializeSessionFile(
    teamConfig: TeamConfig,
    sessionId: string,
    sessionInitTimeout = 30000,
  ): Promise<void> {
    const logger = new Logger(`session-init:${teamConfig.path}`);
    const projectPath = teamConfig.path;

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

      // Use absolute path to claude binary to avoid PATH resolution issues
      const claudePath =
        "/Users/jenova/.asdf/installs/nodejs/22.16.0/bin/claude";

      // Log the exact command being run
      const command = `${claudePath} ${args.join(" ")}`;
      logger.info("Spawning claude process", {
        sessionId,
        command,
        cwd: projectPath,
      });

      // Spawn Claude
      const claudeProcess = spawn(claudePath, args, {
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
        logger.error("Process spawn error", {
          sessionId,
          error: err.message,
          stack: err.stack,
        });
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
            logger.error("Process exited with spawn error", {
              sessionId,
              code,
              stdoutLength: stdoutData.length,
              stderrLength: stderrData.length,
              stdout: stdoutData.substring(0, 1000),
              stderr: stderrData.substring(0, 1000),
            });
            reject(spawnError);
          } else if (code !== 0 && code !== 143) {
            // 143 is SIGTERM which is ok
            logger.error(
              "Session initialization failed with non-zero exit code",
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
              "Session initialization completed but no response received",
              {
                sessionId,
                code,
                command: `${claudePath} ${args.join(" ")}`,
                cwd: projectPath,
                stdoutLength: stdoutData.length,
                stderrLength: stderrData.length,
                stdout: stdoutData,
                stderr: stderrData,
                debugLogPath,
              },
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
          logger.error("Session initialization timed out", {
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
          });
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

      logger.info("Session file initialized successfully", {
        sessionId,
        filePath: sessionFilePath,
      });
    } catch (error) {
      logger.error("Failed to initialize session file", error);
      throw error;
    }
  }

  /**
   * Get the path to a session file
   * Helper method for determining where Claude stores session files
   */
  static getSessionFilePath(projectPath: string, sessionId: string): string {
    // Claude stores sessions in ~/.claude/projects/{escaped-path}/{sessionId}.jsonl
    const homedir = process.env.HOME || process.env.USERPROFILE || "";
    const escapedPath = projectPath.replace(/\//g, "-");
    return `${homedir}/.claude/projects/${escapedPath}/${sessionId}.jsonl`;
  }

  /**
   * Get debug log path if debug mode was enabled
   */
  getDebugLogPath(): string | null {
    return this.debugLogPath;
  }

  /**
   * Clear the output cache
   */
  clearOutputCache(): void {
    this.cache.clear();
    this.logger.debug("Output cache cleared");
  }

  /**
   * Get the current output cache
   * Returns the text content cache, not the raw JSON protocol cache
   */
  getOutputCache(): { stdout: string; stderr: string } {
    return this.cache.getText();
  }

  /**
   * Get a report of recent messages and cache status
   * Useful for monitoring and debugging
   */
  getReport(): {
    recentMessages: any[];
    pendingMessages: any[];
    errorMessages: any[];
    cacheReport: any;
  } {
    return {
      recentMessages: this.cache.getRecentMessages(5),
      pendingMessages: this.cache.getPendingMessages(),
      errorMessages: this.cache.getErrorMessages(),
      cacheReport: this.cache.getReport(),
    };
  }

  /**
   * Export messages for debugging
   */
  exportMessages(format: 'json' | 'text' = 'text'): string {
    return this.cache.exportMessages(format);
  }

  /**
   * Spawn the Claude Code process
   */
  async spawn(): Promise<void> {
    if (this.process) {
      throw new ProcessError("Process already running", this.teamName);
    }

    this.status = "spawning";
    this.startTime = Date.now();

    try {
      const projectPath = this.teamConfig.path;

      this.logger.info("Spawning Claude Code process", {
        path: projectPath,
        sessionId: this.sessionId,
        skipPermissions: this.teamConfig.skipPermissions,
      });

      // Spawn Claude CLI in headless mode with stream-json I/O
      // Use --resume to continue existing session if sessionId provided
      // See docs/HEADLESS_CLAUDE.md and docs/SESSION.md for reference
      const args: string[] = [];

      // Only use --resume if we have a sessionId and not in test mode
      // In test mode, session files don't exist so we can't resume
      if (this.sessionId && process.env.NODE_ENV !== "test") {
        args.push("--resume", this.sessionId);
      }

      // Enable debug mode in test environment for better diagnostics
      if (process.env.NODE_ENV === "test" || process.env.DEBUG) {
        args.push("--debug");
      }

      args.push(
        "--print", // Non-interactive headless mode
        "--verbose", // Required for stream-json output
        "--input-format", // Accept JSON messages via stdin
        "stream-json",
        "--output-format", // Emit JSON messages via stdout
        "stream-json",
      );

      if (this.teamConfig.skipPermissions) {
        args.push("--dangerously-skip-permissions");
      }

      this.process = spawn("claude", args, {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
        },
      });

      // Handle process events
      this.process.on("error", (error) => {
        this.logger.error("Process error", error);
        this.handleProcessError(error);
      });

      this.process.on("exit", (code, signal) => {
        this.logger.info("Process exited", { code, signal });
        this.handleProcessExit(code, signal);
      });

      // Handle stdout (responses from Claude)
      if (this.process.stdout) {
        this.process.stdout.on("data", (data) => {
          this.handleStdout(data);
        });
      }

      // Handle stderr (logs from Claude)
      if (this.process.stderr) {
        this.process.stderr.on("data", (data) => {
          const output = data.toString();

          // Cache the stderr output (both protocol and text are the same for stderr)
          this.cache.appendStderr(output);

          // Capture debug log path from stderr
          // Claude outputs: "Logging to: /path/to/debug.txt"
          const logPathMatch = output.match(/Logging to: (.+)/);
          if (logPathMatch) {
            this.debugLogPath = logPathMatch[1].trim();
            this.logger.info("Claude debug logs available", {
              path: this.debugLogPath,
            });
          }

          this.logger.debug("Claude stderr", { output });
        });
      }

      // Claude in stream-json mode sends init AFTER receiving first message
      // So we need to send a dummy message to trigger initialization
      // We send "ping" which triggers init AND generates a response that we need to consume
      this.logger.info("Sending initialization ping to trigger init message");

      const initMessage =
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "ping",
              },
            ],
          },
        }) + "\n";

      this.process.stdin!.write(initMessage);

      // Wait for process to be ready (init message + response to init ping)
      // The init ping will generate a full response cycle that we need to wait for
      await this.waitForReady();

      // CRITICAL: The init ping generates a "pong" response that gets accumulated
      // in textAccumulator. We MUST clear it or it will contaminate the first real message
      this.textAccumulator = "";
      this.logger.debug("Text accumulator cleared after initialization");

      // Also clear output cache (for report action)
      this.clearOutputCache();
      this.logger.debug("Output cache cleared after initialization");

      this.status = "idle";
      this.resetIdleTimer();

      this.logger.info("Process spawned successfully", {
        pid: this.process.pid,
      });

      this.emit("spawned", { teamName: this.teamName, pid: this.process.pid });
    } catch (error) {
      this.status = "stopped";
      throw new ProcessError(
        `Failed to spawn process: ${error instanceof Error ? error.message : error}`,
        this.teamName,
      );
    }
  }

  /**
   * Send a message to the Claude Code process
   */
  async sendMessage(message: string, timeout = 30000): Promise<string> {
    if (!this.process || this.status === "stopped") {
      throw new ProcessError("Process not running", this.teamName);
    }

    this.logger.debug("Enqueueing message", {
      messageLength: message.length,
      messagePreview: message.substring(0, 100),
      timeout,
      currentStatus: this.status,
      queueLength: this.messageQueue.length,
      hasCurrentMessage: !!this.currentMessage,
    });

    return new Promise((resolve, reject) => {
      const messageObj: ProcessMessage = { message, resolve, reject };

      this.messageQueue.push(messageObj);
      this.processNextMessage();

      // Timeout handling
      const timeoutId = setTimeout(() => {
        if (this.currentMessage === messageObj) {
          this.currentMessage = null;
          reject(new TimeoutError("Message send", timeout));
          this.processNextMessage();
        } else {
          const index = this.messageQueue.indexOf(messageObj);
          if (index > -1) {
            this.messageQueue.splice(index, 1);
            reject(new TimeoutError("Message queued", timeout));
          }
        }
      }, timeout);

      // Clear timeout on resolution
      const originalResolve = messageObj.resolve;
      const originalReject = messageObj.reject;

      messageObj.resolve = (value: any) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };

      messageObj.reject = (error: Error) => {
        clearTimeout(timeoutId);
        originalReject(error);
      };
    });
  }

  /**
   * Terminate the process gracefully
   */
  async terminate(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.status = "terminating";
    this.clearIdleTimer();

    this.logger.info("Terminating process");

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.process = null;
        this.status = "stopped";
        this.emit("terminated", { teamName: this.teamName });
        resolve();
      };

      // Force kill after 5 seconds
      const killTimer = setTimeout(() => {
        if (this.process) {
          this.logger.warn("Force killing process");
          this.process.kill("SIGKILL");
        }
      });

      this.process.once("exit", () => {
        clearTimeout(killTimer);
        cleanup();
      });

      // Try graceful shutdown first
      this.process.kill("SIGTERM");
    });
  }

  /**
   * Get process metrics
   */
  getMetrics(): ProcessMetrics {
    const now = Date.now();
    return {
      pid: this.process?.pid,
      status: this.status,
      messagesProcessed: this.messagesProcessed,
      lastUsed: now,
      uptime: this.startTime ? now - this.startTime : 0,
      idleTimeRemaining: this.idleTimer ? this.idleTimeout : 0,
      queueLength: this.messageQueue.length,
      sessionId: this.sessionId,
      messageCount: this.messagesProcessed,
      lastActivity: now,
    };
  }

  /**
   * Process the next message in the queue
   */
  private processNextMessage(): void {
    if (this.currentMessage || this.messageQueue.length === 0) {
      this.logger.debug("Skipping message processing", {
        hasCurrentMessage: !!this.currentMessage,
        queueLength: this.messageQueue.length,
        status: this.status,
      });
      return;
    }

    if (!this.process || !this.process.stdin) {
      this.logger.warn(
        "Process stdin not available, rejecting queued messages",
        {
          processExists: !!this.process,
          stdinExists: !!this.process?.stdin,
          queueLength: this.messageQueue.length,
        },
      );
      // Reject all queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        msg.reject(
          new ProcessError("Process stdin not available", this.teamName),
        );
      }
      return;
    }

    this.currentMessage = this.messageQueue.shift()!;
    this.status = "processing";
    this.textAccumulator = ""; // Reset accumulator for new message
    this.resetIdleTimer();

    // Start tracking this message in the cache
    this.currentCacheMessageId = this.cache.startMessage(this.currentMessage.message);

    this.logger.debug("Processing message", {
      messageLength: this.currentMessage.message.length,
      messagePreview: this.currentMessage.message.substring(0, 100),
      messagesProcessed: this.messagesProcessed,
      status: this.status,
      cacheMessageId: this.currentCacheMessageId,
    });

    try {
      // Write message to Claude's stdin in stream-json format
      // Format per docs: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: string }] } }
      const jsonMessage =
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: this.currentMessage.message,
              },
            ],
          },
        }) + "\n";

      this.logger.debug("Writing message to stdin", {
        jsonLength: jsonMessage.length,
        jsonPreview: jsonMessage.substring(0, 200),
      });

      this.process.stdin.write(jsonMessage);
      this.messagesProcessed++;

      this.emit("message-sent", {
        teamName: this.teamName,
        message: this.currentMessage.message,
      });
    } catch (error) {
      this.logger.error("Failed to write message to stdin", {
        error: error instanceof Error ? error.message : error,
        messagePreview: this.currentMessage.message.substring(0, 100),
      });

      // Error the cache message
      if (this.currentCacheMessageId) {
        this.cache.errorCurrentMessage(
          `Failed to write to stdin: ${error instanceof Error ? error.message : error}`
        );
        this.currentCacheMessageId = null;
      }

      this.currentMessage.reject(
        new ProcessError(
          `Failed to write to stdin: ${error instanceof Error ? error.message : error}`,
          this.teamName,
        ),
      );
      this.currentMessage = null;
      this.status = "idle";
      this.processNextMessage();
    }
  }

  /**
   * Handle stdout data from Claude (stream-json format)
   *
   * Message format reference: docs/HEADLESS_CLAUDE.md
   *
   * Claude CLI sends multiple message types:
   * - system/init: Initial session info
   * - stream_event: Real-time streaming events (message_start, content_block_delta, message_stop)
   * - user: Echo of user message
   * - assistant: Complete assistant response
   * - result: Final stats
   */
  private handleStdout(data: Buffer): void {
    const rawData = data.toString();
    this.logger.debug("Raw stdout data received", {
      data: rawData.substring(0, 1000), // First 1000 chars for debugging
      length: rawData.length,
      bufferLength: this.responseBuffer.length,
      currentMessageId: this.currentMessage ? "active" : "none",
    });

    // Cache the raw protocol output
    this.cache.appendStdoutProtocol(rawData);

    this.responseBuffer += rawData;

    // Parse newline-delimited JSON responses
    const lines = this.responseBuffer.split("\n");

    // Keep the last incomplete line in buffer
    this.responseBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      this.logger.debug("Attempting to parse JSON line", {
        line: line.substring(0, 200), // First 200 chars for debugging
        fullLineLength: line.length,
      });

      try {
        const jsonResponse = JSON.parse(line);

        this.logger.debug("Successfully parsed JSON", {
          type: jsonResponse.type,
          subtype: jsonResponse.subtype,
          hasMessage: !!jsonResponse.message,
          hasEvent: !!jsonResponse.event,
          eventType: jsonResponse.event?.type,
          messageContent: jsonResponse.message?.content ? "present" : "missing",
          sessionId: jsonResponse.session_id ? "present" : "missing",
        });

        // Handle different message types from Claude stream-json output
        // Based on actual Claude headless documentation (see docs/HEADLESS_CLAUDE.md)
        if (jsonResponse.type === "system" && jsonResponse.subtype === "init") {
          // Initial system message with session ID and configuration
          // NOTE: We don't resolve initPromise here anymore - we wait for message_stop
          // to ensure the init ping response is fully received before proceeding
          this.logger.debug("Received init message", {
            sessionId: jsonResponse.session_id,
            model: jsonResponse.model,
            tools: jsonResponse.tools,
          });
        } else if (jsonResponse.type === "user") {
          // Echo of user message
          this.logger.debug("Received user message echo");
        } else if (jsonResponse.type === "stream_event") {
          // Real-time streaming events
          const event = jsonResponse.event;

          if (event?.type === "message_start") {
            // Reset accumulator for new message
            this.textAccumulator = "";
            this.logger.debug("Stream event: message_start");
          } else if (
            event?.type === "content_block_delta" &&
            event?.delta?.type === "text_delta"
          ) {
            // Accumulate text chunks from streaming
            const deltaText = event.delta.text || "";
            this.textAccumulator += deltaText;

            // Update the cache with streaming text
            this.cache.appendToCurrentMessage(deltaText);

            // Mark message as streaming if it's just starting
            this.cache.markMessageStreaming();

            this.logger.debug("Stream event: text_delta", {
              chunkLength: deltaText.length,
              chunk: deltaText.substring(0, 100),
              accumulatedLength: this.textAccumulator.length,
              hasCurrentMessage: !!this.currentMessage,
            });
          } else if (event?.type === "message_stop") {
            // Message complete, resolve with accumulated text
            this.logger.debug("Stream event: message_stop", {
              finalLength: this.textAccumulator.length,
              hasCurrentMessage: !!this.currentMessage,
              hasAccumulatedText: this.textAccumulator.length > 0,
              responsePreview: this.textAccumulator.substring(0, 200),
              initPingCompleted: this.initPingCompleted,
            });

            if (this.currentMessage) {
              if (this.textAccumulator.length > 0) {
                this.logger.debug("Resolving message with accumulated text");
                this.currentMessage.resolve(this.textAccumulator);

                // Complete the cache message with final response
                this.cache.completeCurrentMessage(this.textAccumulator);

                this.emit("message-response", {
                  teamName: this.teamName,
                  response: this.textAccumulator,
                });
              } else {
                this.logger.warn(
                  "Message stop received but no accumulated text",
                );
                this.currentMessage.resolve("");

                // Complete the cache message even if empty
                this.cache.completeCurrentMessage("");
              }

              this.currentMessage = null;
              this.currentCacheMessageId = null;
              this.status = "idle";
              this.textAccumulator = "";
              this.processNextMessage();
            } else if (!this.initPingCompleted && this.initResolve) {
              // This is the message_stop for the init ping response
              // Mark as completed so waitForReady() can complete
              this.logger.debug("Init ping response completed", {
                accumulatedLength: this.textAccumulator.length,
                accumulatedPreview: this.textAccumulator.substring(0, 100),
              });
              this.initPingCompleted = true;
              this.initResolve();
              this.initResolve = null;
              this.initReject = null;
              this.initPromise = null;
            } else {
              this.logger.warn("Message stop received but no current message");
            }
          }
        } else if (jsonResponse.type === "assistant") {
          // Complete assistant message with full response
          // In stream-json format, this contains the actual response text
          this.logger.debug("Received assistant message", {
            stopReason: jsonResponse.message?.stop_reason,
            hasContent: !!jsonResponse.message?.content,
            hasCurrentMessage: !!this.currentMessage,
            initPingCompleted: this.initPingCompleted,
          });

          // Extract text from assistant message
          if (
            this.currentMessage &&
            jsonResponse.message?.content &&
            Array.isArray(jsonResponse.message.content)
          ) {
            const textContent = jsonResponse.message.content
              .filter((block: any) => block.type === "text")
              .map((block: any) => block.text)
              .join("\n");

            if (textContent) {
              this.logger.debug("Resolving message with assistant content", {
                responseLength: textContent.length,
                responsePreview: textContent.substring(0, 200),
              });

              // Complete the cache message with assistant response
              this.cache.completeCurrentMessage(textContent);

              this.currentMessage.resolve(textContent);

              this.emit("message-response", {
                teamName: this.teamName,
                response: textContent,
              });

              this.currentMessage = null;
              this.currentCacheMessageId = null;
              this.status = "idle";
              this.processNextMessage();
            }
          } else if (!this.initPingCompleted && this.initResolve) {
            // This is the assistant message for the init ping response
            // (Some Claude versions send assistant message instead of stream_events)
            this.logger.debug(
              "Init ping response completed (assistant message)",
              {
                hasContent: !!jsonResponse.message?.content,
              },
            );
            this.initPingCompleted = true;
            this.initResolve();
            this.initResolve = null;
            this.initReject = null;
            this.initPromise = null;
          }
        } else if (jsonResponse.type === "result") {
          // Final result message with stats
          if (jsonResponse.is_error && this.currentMessage) {
            // Mark cache message as errored
            this.cache.errorCurrentMessage("Claude returned error");

            this.currentMessage.reject(new Error("Claude returned error"));
            this.currentMessage = null;
            this.currentCacheMessageId = null;
            this.status = "idle";
            this.processNextMessage();
          }
          this.logger.debug("Received result message", {
            cost: jsonResponse.total_cost_usd,
            duration: jsonResponse.duration_ms,
            error: jsonResponse.is_error,
          });
        } else if (jsonResponse.type === "error") {
          // Error from Claude
          if (this.currentMessage) {
            const errorMsg = `Claude error: ${jsonResponse.error?.message || JSON.stringify(jsonResponse.error)}`;

            // Mark cache message as errored
            this.cache.errorCurrentMessage(errorMsg);

            this.currentMessage.reject(
              new ProcessError(errorMsg, this.teamName),
            );
            this.currentMessage = null;
            this.currentCacheMessageId = null;
            this.status = "idle";
            this.processNextMessage();
          }
        }
        // Ignore other message types
      } catch (error) {
        this.logger.debug("Failed to parse JSON response", {
          line: line.substring(0, 200),
          fullLineLength: line.length,
          error: error instanceof Error ? error.message : error,
          parsingContext: {
            bufferLength: this.responseBuffer.length,
            hasCurrentMessage: !!this.currentMessage,
            status: this.status,
          },
        });
        // Continue processing other lines
      }
    }
  }

  /**
   * Handle process errors
   */
  private handleProcessError(error: Error): void {
    this.logger.error("Process error", error);

    // Error the current cache message if any
    if (this.currentCacheMessageId) {
      this.cache.errorCurrentMessage(`Process error: ${error.message}`);
      this.currentCacheMessageId = null;
    }

    // Reject current and queued messages
    if (this.currentMessage) {
      this.currentMessage.reject(
        new ProcessError(error.message, this.teamName),
      );
      this.currentMessage = null;
    }

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      msg.reject(new ProcessError("Process crashed", this.teamName));
    }

    this.emit("error", { teamName: this.teamName, error });
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.status = "stopped";
    this.process = null;
    this.clearIdleTimer();

    // Error the current cache message if any
    if (this.currentCacheMessageId) {
      this.cache.errorCurrentMessage(`Process exited (code: ${code}, signal: ${signal})`);
      this.currentCacheMessageId = null;
    }

    // Reject any pending messages
    if (this.currentMessage) {
      this.currentMessage.reject(
        new ProcessError("Process exited", this.teamName),
      );
      this.currentMessage = null;
    }

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      msg.reject(new ProcessError("Process exited", this.teamName));
    }

    this.emit("exited", { teamName: this.teamName, code, signal });
  }

  /**
   * Wait for process to be ready by waiting for init message
   */
  private async waitForReady(timeout = 20000): Promise<void> {
    // Create promise that will be resolved when init message is received
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });

    // Set up timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        if (this.initReject) {
          this.initReject(
            new TimeoutError("Waiting for init message", timeout),
          );
          this.initResolve = null;
          this.initReject = null;
          this.initPromise = null;
        }
        reject(new TimeoutError("Process failed to initialize", timeout));
      }, timeout);
    });

    // Handle process errors during initialization
    const errorHandler = (error: Error) => {
      if (this.initReject) {
        this.initReject(error);
        this.initResolve = null;
        this.initReject = null;
        this.initPromise = null;
      }
    };
    this.process?.once("error", errorHandler);

    try {
      // Wait for either init message or timeout
      await Promise.race([this.initPromise, timeoutPromise]);

      // Clean up error handler
      this.process?.removeListener("error", errorHandler);
    } catch (error) {
      // Clean up on error
      this.process?.removeListener("error", errorHandler);
      throw error;
    }
  }

  /**
   * Reset idle timeout timer
   */
  private resetIdleTimer(): void {
    this.clearIdleTimer();

    this.idleTimer = setTimeout(() => {
      this.logger.info("Process idle timeout reached, terminating");
      this.terminate();
    }, this.idleTimeout);
  }

  /**
   * Clear idle timeout timer
   */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
