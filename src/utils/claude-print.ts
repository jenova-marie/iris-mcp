/**
 * Claude Print Executor - Execute one-off commands via claude --print
 *
 * This subsystem handles ephemeral command execution (slash commands, utilities)
 * as opposed to persistent streaming processes (Transport).
 *
 * Mirrors Transport pattern (local/remote abstraction) but implements
 * print-specific semantics:
 * - Command in CLI args (not stdin)
 * - Single response (not streaming)
 * - Process exits after completion
 */

import { spawn, ChildProcess } from "child_process";
import { getChildLogger } from "./logger.js";
import { ProcessError, TimeoutError } from "./errors.js";
import type { IrisConfig } from "../process-pool/types.js";

const logger = getChildLogger("utils:claude-print");

export interface ClaudePrintOptions {
  /** Command to execute (e.g., "ping", "/compact", "/help") */
  command: string;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Whether to use --resume (true) or --session-id (false) */
  resume?: boolean;

  /** Number of retry attempts for transient failures (default: 0) */
  retries?: number;

  /** Delay between retries in milliseconds (default: 1000, exponential backoff) */
  retryDelay?: number;
}

export interface ClaudePrintResult {
  /** Exit code from claude process */
  exitCode: number;

  /** stdout output */
  stdout: string;

  /** stderr output */
  stderr: string;

  /** Duration in milliseconds */
  duration: number;

  /** Whether command completed successfully */
  success: boolean;

  /** Debug log path (if available) */
  debugLogPath?: string;

  /** Number of retry attempts made (0 if succeeded on first try) */
  retryCount?: number;

  /** Total attempts made (including initial + retries) */
  totalAttempts?: number;
}

/**
 * Metrics for tracking print command performance
 */
export interface ClaudePrintMetrics {
  command: string;
  duration: number;
  success: boolean;
  remote: boolean;
  timestamp: number;
  retryCount: number;
  exitCode: number;
}

/**
 * ClaudePrintExecutor - Executes one-off commands via claude --print
 *
 * Factory pattern:
 * ```typescript
 * const executor = ClaudePrintExecutor.create(teamConfig, sessionId);
 * const result = await executor.execute({
 *   command: '/compact',
 *   resume: true,
 *   retries: 2  // Retry up to 2 times on failure
 * });
 * ```
 */
export class ClaudePrintExecutor {
  private metrics: ClaudePrintMetrics[] = [];

  private constructor(
    private irisConfig: IrisConfig,
    private sessionId: string,
  ) {}

  /**
   * Factory method - creates executor for team config
   */
  static create(
    irisConfig: IrisConfig,
    sessionId: string,
  ): ClaudePrintExecutor {
    return new ClaudePrintExecutor(irisConfig, sessionId);
  }

  /**
   * Execute command via claude --print with retry logic
   * Delegates to local or remote implementation based on config
   */
  async execute(options: ClaudePrintOptions): Promise<ClaudePrintResult> {
    const {
      command,
      timeout = 30000,
      resume = true,
      retries = 0,
      retryDelay = 1000,
    } = options;

    const maxAttempts = retries + 1; // Initial attempt + retries
    let lastError: Error | null = null;
    let retryCount = 0;

    logger.info("Executing claude --print command", {
      command,
      sessionId: this.sessionId,
      remote: !!this.irisConfig.remote,
      resume,
      timeout,
      maxAttempts,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.executeInternal(command, timeout, resume);

        // Record metrics
        this.recordMetrics({
          command,
          duration: result.duration,
          success: result.success,
          remote: !!this.irisConfig.remote,
          timestamp: Date.now(),
          retryCount,
          exitCode: result.exitCode,
        });

        // Add retry information to result
        return {
          ...result,
          retryCount,
          totalAttempts: attempt,
        };
      } catch (error) {
        lastError = error as Error;
        retryCount++;

        logger.warn(
          {
            command,
            attempt,
            maxAttempts,
            error: lastError.message,
          },
          "Command execution failed, will retry if attempts remain",
        );

        // If we have retries left, wait before retrying
        if (attempt < maxAttempts) {
          // Exponential backoff: delay * attempt
          const delay = retryDelay * attempt;
          logger.info({ delay, attempt, maxAttempts }, "Waiting before retry");
          await this.delay(delay);
        }
      }
    }

    // All attempts failed
    logger.error(
      {
        command,
        totalAttempts: maxAttempts,
        error: lastError?.message,
      },
      "All retry attempts exhausted",
    );

    // Record failure metrics
    this.recordMetrics({
      command,
      duration: 0,
      success: false,
      remote: !!this.irisConfig.remote,
      timestamp: Date.now(),
      retryCount: retries,
      exitCode: -1,
    });

    throw lastError;
  }

  /**
   * Internal execute method (without retry logic)
   */
  private async executeInternal(
    command: string,
    timeout: number,
    resume: boolean,
  ): Promise<ClaudePrintResult> {
    if (this.irisConfig.remote) {
      return this.executeRemote(command, timeout, resume);
    } else {
      return this.executeLocal(command, timeout, resume);
    }
  }

  /**
   * Get recorded metrics
   */
  getMetrics(): ClaudePrintMetrics[] {
    return [...this.metrics]; // Return copy to prevent mutation
  }

  /**
   * Clear recorded metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Record execution metrics
   */
  private recordMetrics(metric: ClaudePrintMetrics): void {
    this.metrics.push(metric);
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute locally via child_process.spawn
   * Command: claude --resume <sessionId> --print <command>
   */
  private async executeLocal(
    command: string,
    timeout: number,
    resume: boolean,
  ): Promise<ClaudePrintResult> {
    const startTime = Date.now();

    // Use custom claudePath if provided, otherwise default to 'claude'
    const claudeExecutable = this.irisConfig.claudePath || "claude";

    // Build command args
    const args = [
      resume ? "--resume" : "--session-id",
      this.sessionId,
      "--print",
      command,
    ];

    logger.debug("Spawning local claude process", {
      command: `${claudeExecutable} ${args.join(" ")}`,
      cwd: this.irisConfig.path,
    });

    // Spawn Claude
    const claudeProcess = spawn(claudeExecutable, args, {
      cwd: this.irisConfig.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    // Close stdin immediately - we're not sending input
    claudeProcess.stdin!.end();

    return this.waitForCompletion(claudeProcess, timeout, startTime);
  }

  /**
   * Execute remotely via SSH
   * Command: ssh <host> "cd <path> && claude --resume <sessionId> --print <command>"
   */
  private async executeRemote(
    command: string,
    timeout: number,
    resume: boolean,
  ): Promise<ClaudePrintResult> {
    const startTime = Date.now();

    // Use custom claudePath if provided, otherwise default to 'claude'
    const claudeExecutable = this.irisConfig.claudePath || "claude";

    // Build remote command
    const claudeArgs = [
      resume ? "--resume" : "--session-id",
      this.sessionId,
      "--print",
      command,
    ];

    const remoteCommand = `cd ${this.escapeShellArg(this.irisConfig.path)} && ${claudeExecutable} ${claudeArgs.join(" ")}`;

    // Parse SSH connection string (e.g., "ssh inanna" → ["ssh", "inanna"])
    const remoteParts = this.irisConfig.remote!.split(/\s+/);
    const sshExecutable = remoteParts[0]; // Should be "ssh"
    const sshArgs = remoteParts.slice(1); // Host and any SSH flags

    // Build SSH command: ssh <host> "cd <path> && claude ..."
    const fullArgs = [...sshArgs, remoteCommand];

    logger.debug("Spawning remote claude process via SSH", {
      command: `${sshExecutable} ${fullArgs.join(" ")}`,
      remote: this.irisConfig.remote,
    });

    // Spawn SSH process
    const sshProcess = spawn(sshExecutable, fullArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    // Close stdin immediately
    sshProcess.stdin!.end();

    return this.waitForCompletion(sshProcess, timeout, startTime);
  }

  /**
   * Wait for process to complete and collect output
   * Used by both local and remote execution
   */
  private async waitForCompletion(
    process: ChildProcess,
    timeout: number,
    startTime: number,
  ): Promise<ClaudePrintResult> {
    return new Promise((resolve, reject) => {
      let stdoutData = "";
      let stderrData = "";
      let debugLogPath: string | null = null;
      let spawnError: Error | null = null;
      let responseReceived = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Capture stdout
      process.stdout!.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutData += output;

        logger.debug("Print command stdout", {
          sessionId: this.sessionId,
          output: output.substring(0, 500),
        });

        if (output.length > 0) {
          responseReceived = true;
        }
      });

      // Capture stderr
      process.stderr!.on("data", (data: Buffer) => {
        const errorOutput = data.toString();
        stderrData += errorOutput;

        // Extract debug log path if present
        const logPathMatch = errorOutput.match(/Logging to: (.+)/);
        if (logPathMatch && !debugLogPath) {
          debugLogPath = logPathMatch[1].trim();
          logger.debug("Debug logs available", {
            sessionId: this.sessionId,
            debugLogPath,
          });
        }

        logger.debug("Print command stderr", {
          sessionId: this.sessionId,
          stderr: errorOutput,
        });
      });

      // Handle spawn errors
      process.on("error", (err) => {
        logger.error({ err, sessionId: this.sessionId }, "Process spawn error");
        spawnError = err;
      });

      // Handle process exit
      process.on("exit", (code) => {
        // Clear timeout immediately
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        const duration = Date.now() - startTime;
        const exitCode = code ?? -1;

        if (spawnError) {
          logger.error(
            {
              err: spawnError,
              sessionId: this.sessionId,
              exitCode,
              stdoutLength: stdoutData.length,
              stderrLength: stderrData.length,
            },
            "Process exited with spawn error",
          );

          reject(spawnError);
        } else if (exitCode !== 0 && exitCode !== 143) {
          // 143 is SIGTERM (ok)
          logger.warn(
            {
              sessionId: this.sessionId,
              exitCode,
              stdout: stdoutData,
              stderr: stderrData,
              debugLogPath,
            },
            "Command failed with non-zero exit code",
          );

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: false,
            debugLogPath: debugLogPath ?? undefined,
          });
        } else if (!responseReceived) {
          logger.warn(
            {
              sessionId: this.sessionId,
              exitCode,
              stdout: stdoutData,
              stderr: stderrData,
            },
            "Command completed but no response received",
          );

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: false,
            debugLogPath: debugLogPath ?? undefined,
          });
        } else {
          // Success
          logger.info("Command completed successfully", {
            sessionId: this.sessionId,
            exitCode,
            stdoutLength: stdoutData.length,
            duration,
          });

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: true,
            debugLogPath: debugLogPath ?? undefined,
          });
        }
      });

      // Timeout handler
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        logger.error(
          {
            sessionId: this.sessionId,
            timeout,
            responseReceived,
            stdout: stdoutData,
            stderr: stderrData,
          },
          "Command execution timed out",
        );

        process.kill();

        const errorMsg = [
          `Command execution timed out after ${timeout}ms`,
          `Response received: ${responseReceived}`,
          debugLogPath ? `Debug logs: ${debugLogPath}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        reject(new TimeoutError(errorMsg, timeout));
      }, timeout);
    });
  }

  /**
   * Escape shell argument for safe command execution
   * Used for remote SSH commands
   */
  private escapeShellArg(arg: string): string {
    // Single-quote the argument and escape any single quotes within
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
