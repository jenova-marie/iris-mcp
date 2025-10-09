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
import type {
  ProcessMessage,
  ProcessStatus,
  ProcessMetrics,
  TeamConfig,
} from "./types.js";
import { Logger } from "../utils/logger.js";
import { ProcessError, TimeoutError } from "../utils/errors.js";

export class ClaudeProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: ProcessStatus = "stopped";
  private messageQueue: ProcessMessage[] = [];
  private currentMessage: ProcessMessage | null = null;
  private responseBuffer: string = "";
  private textAccumulator: string = "";

  private messagesProcessed = 0;
  private startTime = 0;
  private logger: Logger;
  private idleTimer: NodeJS.Timeout | null = null;
  private initPromise: Promise<void> | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;

  constructor(
    private teamName: string,
    private teamConfig: TeamConfig,
    private idleTimeout: number,
    private sessionId: string,
  ) {
    super();
    this.logger = new Logger(`process:${teamName}`);
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
      const projectPath = this.teamConfig.project || this.teamConfig.path;

      this.logger.info("Spawning Claude Code process", {
        path: projectPath,
        sessionId: this.sessionId,
        skipPermissions: this.teamConfig.skipPermissions,
      });

      // Spawn Claude CLI in headless mode with stream-json I/O
      // Use --resume to continue existing session
      // See docs/HEADLESS_CLAUDE.md and docs/SESSION.md for reference
      const args = [
        "--resume", // Resume existing session
        this.sessionId,
        "--print", // Non-interactive headless mode
        "--verbose", // Required for stream-json output
        "--input-format", // Accept JSON messages via stdin
        "stream-json",
        "--output-format", // Emit JSON messages via stdout
        "stream-json",
      ];

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
          this.logger.debug("Claude stderr", { output: data.toString() });
        });
      }

      // Claude in stream-json mode sends init AFTER receiving first message
      // So we need to send a dummy message to trigger initialization
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

      // Now wait for process to be ready (init message will arrive)
      await this.waitForReady();

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
      }, 5000);

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

    this.logger.debug("Processing message", {
      messageLength: this.currentMessage.message.length,
      messagePreview: this.currentMessage.message.substring(0, 100),
      messagesProcessed: this.messagesProcessed,
      status: this.status,
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
          this.logger.debug("Received init message", {
            sessionId: jsonResponse.session_id,
            model: jsonResponse.model,
            tools: jsonResponse.tools,
          });

          // Resolve the init promise if waiting
          if (this.initResolve) {
            this.initResolve();
            this.initResolve = null;
            this.initReject = null;
            this.initPromise = null;
          }
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
            });

            if (this.currentMessage) {
              if (this.textAccumulator.length > 0) {
                this.logger.debug("Resolving message with accumulated text");
                this.currentMessage.resolve(this.textAccumulator);

                this.emit("message-response", {
                  teamName: this.teamName,
                  response: this.textAccumulator,
                });
              } else {
                this.logger.warn(
                  "Message stop received but no accumulated text",
                );
                this.currentMessage.resolve("");
              }

              this.currentMessage = null;
              this.status = "idle";
              this.textAccumulator = "";
              this.processNextMessage();
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

              this.currentMessage.resolve(textContent);

              this.emit("message-response", {
                teamName: this.teamName,
                response: textContent,
              });

              this.currentMessage = null;
              this.status = "idle";
              this.processNextMessage();
            }
          }
        } else if (jsonResponse.type === "result") {
          // Final result message with stats
          if (jsonResponse.is_error && this.currentMessage) {
            this.currentMessage.reject(new Error("Claude returned error"));
            this.currentMessage = null;
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
            this.currentMessage.reject(
              new ProcessError(
                `Claude error: ${jsonResponse.error?.message || JSON.stringify(jsonResponse.error)}`,
                this.teamName,
              ),
            );
            this.currentMessage = null;
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
