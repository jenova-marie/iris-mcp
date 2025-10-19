/**
 * Iris MCP - Remote SSH Client Transport
 * Executes Claude via local OpenSSH client (default remote transport)
 *
 * Uses the local `ssh` command to connect and execute Claude remotely.
 * Leverages ~/.ssh/config, SSH agent, ProxyJump, and all OpenSSH features automatically.
 *
 * Advantages:
 * - Simple: No manual config parsing needed
 * - Secure: Uses SSH agent (no passphrases in config)
 * - Full features: ProxyJump, ControlMaster, etc. work out of the box
 *
 * Trade-offs:
 * - Requires OpenSSH installed on local machine
 * - Less granular error handling than ssh2 library
 */

import { ChildProcess, spawn } from "child_process";
import {
  BehaviorSubject,
  Subject,
  Observable,
  firstValueFrom,
  filter,
  take,
  timeout,
} from "rxjs";
import { getChildLogger } from "../utils/logger.js";
import { ProcessError, TimeoutError } from "../utils/errors.js";
import type { IrisConfig } from "../process-pool/types.js";
import type {
  Transport,
  TransportStatus,
  CommandInfo,
} from "./transport.interface.js";
import { TransportStatus as Status } from "./transport.interface.js";
import type { CacheEntry } from "../cache/types.js";
import { ClaudeCommandBuilder } from "../utils/command-builder.js";
import { writeMcpConfigRemote } from "../utils/mcp-config-writer.js";

export class SSHTransport implements Transport {
  private sshProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private ready = false;
  private startTime = 0;
  private responseBuffer = "";
  private stderrBuffer = "";
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
    this.logger = getChildLogger("transport:ssh-client");

    if (!irisConfig.remote) {
      throw new ProcessError(
        `SSHTransport requires remote configuration`,
        teamName,
      );
    }

    // Expose observables
    this.status$ = this.statusSubject.asObservable();
    this.errors$ = this.errorsSubject.asObservable();
  }

  /**
   * Build SSH command array for spawning
   * Example: ['ssh', '-T', '-o', 'ServerAliveInterval=30', 'user@host', 'cd /path && claude ...']
   */
  private buildSSHCommand(commandInfo: CommandInfo): string[] {
    const sshArgs: string[] = [];

    // Parse remote string (e.g., "ssh inanna" or "ssh -J bastion user@host")
    const remoteParts = this.irisConfig.remote!.split(/\s+/);
    const sshExecutable = remoteParts[0]; // Should be "ssh"
    const userSshArgs = remoteParts.slice(1); // User-provided args and host

    if (sshExecutable !== "ssh") {
      this.logger.warn('Remote string does not start with "ssh"', {
        teamName: this.teamName,
        remote: this.irisConfig.remote,
      });
    }

    // Add reverse MCP tunnel if enabled
    if (this.irisConfig.enableReverseMcp) {
      const tunnelPort = this.irisConfig.reverseMcpPort || 1615;
      // Use environment variable or default to 1615 for Iris HTTP port
      const irisHttpPort = process.env.IRIS_HTTP_PORT || "1615";
      sshArgs.push("-R", `${tunnelPort}:localhost:${irisHttpPort}`);
      this.logger.debug("Adding reverse MCP tunnel to SSH command", {
        teamName: this.teamName,
        tunnelPort,
        irisHttpPort,
      });
    }

    // Add Iris-managed SSH options
    sshArgs.push(
      "-T", // Disable PTY allocation (cleaner stdio)
      "-o",
      "ServerAliveInterval=30", // Keepalive every 30s
      "-o",
      "ServerAliveCountMax=3", // Max 3 missed keepalives
      "-o",
      "BatchMode=yes", // Disable interactive prompts
    );

    // Apply remoteOptions overrides (if any)
    const opts = this.irisConfig.remoteOptions || {};

    if (opts.port !== undefined) {
      sshArgs.push("-p", String(opts.port));
    }

    if (opts.strictHostKeyChecking === false) {
      sshArgs.push("-o", "StrictHostKeyChecking=no");
    }

    if (opts.compression) {
      sshArgs.push("-C");
    }

    if (opts.forwardAgent) {
      sshArgs.push("-A");
    }

    if (opts.identity) {
      sshArgs.push("-i", opts.identity);
    }

    if (opts.connectTimeout !== undefined) {
      sshArgs.push(
        "-o",
        `ConnectTimeout=${Math.floor(opts.connectTimeout / 1000)}`,
      );
    }

    // Apply extra SSH args from remoteOptions
    if (opts.extraSshArgs) {
      sshArgs.push(...opts.extraSshArgs);
    }

    // Append user SSH args (e.g., "-J bastion user@host" or just "inanna")
    sshArgs.push(...userSshArgs);

    // Append remote command (built from CommandInfo)
    const remoteCommand = this.buildRemoteCommand(commandInfo);
    sshArgs.push(remoteCommand);

    return ["ssh", ...sshArgs];
  }

  /**
   * Build remote command string from CommandInfo
   * Example: "cd /opt/containers && claude --resume <sessionId> --print --verbose ..."
   */
  private buildRemoteCommand(commandInfo: CommandInfo): string {
    // Change to project directory
    const cdCmd = `cd ${this.escapeShellArg(commandInfo.cwd)}`;

    // Build Claude command with properly escaped arguments
    const escapedArgs = commandInfo.args.map((arg) => this.escapeShellArg(arg));
    const claudeCmd = `${commandInfo.executable} ${escapedArgs.join(" ")}`;

    return `${cdCmd} && ${claudeCmd}`;
  }

  /**
   * Escape shell argument (basic single-quote escaping)
   * Example: "/path with spaces" -> '/path with spaces'
   */
  private escapeShellArg(arg: string): string {
    // Replace single quotes with '\'' (end quote, escaped quote, start quote)
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Extract SSH host from remote configuration string
   * Example: "ssh user@host" -> "user@host"
   * Example: "ssh -J bastion user@host" -> "user@host"
   */
  private extractSshHost(): string {
    const remoteParts = this.irisConfig.remote!.split(/\s+/);
    // Last argument is typically the host
    return remoteParts[remoteParts.length - 1];
  }

  /**
   * Spawn SSH process and connect to remote Claude
   */
  async spawn(
    spawnCacheEntry: CacheEntry,
    commandInfo: CommandInfo,
    spawnTimeout = 20000,
  ): Promise<void> {
    this.logger.info("Spawning SSH process", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      remote: this.irisConfig.remote,
      executable: commandInfo.executable,
      argsCount: commandInfo.args.length,
    });

    // Emit SPAWNING status
    this.statusSubject.next(Status.SPAWNING);

    this.startTime = Date.now();
    this.currentCacheEntry = spawnCacheEntry;

    // Build and write MCP config file if session MCP is enabled
    if (this.irisConfig.sessionMcpEnabled) {
      this.logger.debug("Building MCP config for remote transport", {
        teamName: this.teamName,
        sessionId: this.sessionId,
      });

      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        this.irisConfig,
        this.sessionId,
      );

      // Extract SSH host from remote string
      const sshHost = this.extractSshHost();

      const sessionMcpPath =
        this.irisConfig.sessionMcpPath ?? ".claude/iris/mcp";

      this.mcpConfigFilePath = await writeMcpConfigRemote(
        mcpConfig,
        this.sessionId,
        sshHost,
        this.irisConfig.path,
        sessionMcpPath,
        this.irisConfig.mcpConfigScript,
      );

      this.logger.debug("MCP config file written to remote", {
        teamName: this.teamName,
        filePath: this.mcpConfigFilePath,
        sshHost,
      });

      // Add --mcp-config to args
      commandInfo.args.push("--mcp-config", this.mcpConfigFilePath);
    }

    // Build SSH command using pre-built CommandInfo
    const sshCommand = this.buildSSHCommand(commandInfo);
    const [command, ...args] = sshCommand;

    // Capture launch command for debugging
    this.launchCommand = sshCommand.join(" ");

    // Build remote command for logging
    const remoteCommand = this.buildRemoteCommand(commandInfo);

    // Capture team config snapshot for debugging
    this.teamConfigSnapshot = this.buildTeamConfigSnapshot();

    this.logger.debug(
      {
        teamName: this.teamName,
        sessionId: this.sessionId,
        sshCommand: this.launchCommand,
        remoteCommand: remoteCommand,
      },
      "Launch command for SSH transport",
    );

    // Spawn SSH process
    try {
      this.sshProcess = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false, // Direct execution, no shell interpretation
      });

      this.logger.debug("SSH process spawned", {
        teamName: this.teamName,
        pid: this.sshProcess.pid,
      });

      // Setup stdio handlers
      this.setupStdioHandlers(this.sshProcess);

      // Send spawn ping to trigger init
      this.writeToStdin(spawnCacheEntry.tellString);

      // Wait for init message from remote Claude
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

      this.logger.info("SSH transport ready", {
        teamName: this.teamName,
        pid: this.sshProcess.pid,
        spawnTime: Date.now() - this.startTime,
      });
    } catch (error) {
      this.logger.error("Failed to spawn SSH process", {
        teamName: this.teamName,
        error: error instanceof Error ? error.message : String(error),
      });

      // Cleanup on spawn failure
      if (this.sshProcess) {
        this.sshProcess.kill("SIGKILL");
        this.sshProcess = null;
      }

      throw new ProcessError(
        `Failed to spawn SSH process: ${error instanceof Error ? error.message : String(error)}`,
        this.teamName,
      );
    }
  }

  /**
   * Setup stdio handlers for SSH process
   */
  private setupStdioHandlers(process: ChildProcess): void {
    if (!process.stdout || !process.stderr || !process.stdin) {
      throw new ProcessError(
        "SSH process missing stdio streams",
        this.teamName,
      );
    }

    // Handle stdout (remote Claude JSON output)
    process.stdout.on("data", (data: Buffer) => {
      this.handleStdoutData(data);
    });

    // Handle stderr (SSH errors and remote Claude errors)
    process.stderr.on("data", (data: Buffer) => {
      this.handleStderrData(data);
    });

    // Handle process exit
    process.on("exit", (code, signal) => {
      this.logger.info("SSH process exited", {
        teamName: this.teamName,
        code,
        signal,
        uptime: Date.now() - this.startTime,
      });

      this.ready = false;

      // Emit STOPPED status
      this.statusSubject.next(Status.STOPPED);

      // Reject init if still waiting
      if (this.initReject) {
        this.initReject(
          new ProcessError(
            `SSH process exited during init (code: ${code}, signal: ${signal})`,
            this.teamName,
          ),
        );
        this.initReject = null;
        this.initResolve = null;
      }
    });

    // Handle process errors
    process.on("error", (error) => {
      this.logger.error("SSH process error", {
        teamName: this.teamName,
        error: error.message,
      });

      // Emit error to errors$ stream
      this.errorsSubject.next(error);

      // Emit ERROR status
      this.statusSubject.next(Status.ERROR);

      // Reject init if still waiting
      if (this.initReject) {
        this.initReject(error);
        this.initReject = null;
        this.initResolve = null;
      }
    });
  }

  /**
   * Handle stdout data (remote Claude JSON)
   */
  private handleStdoutData(data: Buffer): void {
    const rawData = data.toString();
    this.responseBuffer += rawData;

    // Parse newline-delimited JSON
    const lines = this.responseBuffer.split("\n");
    this.responseBuffer = lines.pop() || ""; // Keep last incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue; // Skip empty lines

      try {
        const json = JSON.parse(line);

        // DUMB PIPE: Just write to current cache entry
        if (this.currentCacheEntry) {
          this.currentCacheEntry.addMessage(json);
        }

        this.logger.debug("Received JSON from remote Claude", {
          teamName: this.teamName,
          type: json.type,
          subtype: json.subtype,
        });

        // Special handling for init (resolve spawn promise)
        if (json.type === "system" && json.subtype === "init") {
          if (this.initResolve) {
            this.logger.debug("Received init message from remote Claude", {
              teamName: this.teamName,
            });
            this.initResolve();
            this.initResolve = null;
            this.initReject = null;
            // Clear spawn cache entry - spawn phase is complete
            this.currentCacheEntry = null;
          }
        }

        // Clear current cache entry on result
        if (json.type === "result") {
          this.messagesProcessed++;
          this.lastResponseAt = Date.now();
          this.currentCacheEntry = null; // Ready for next tell

          // Emit READY status (back to idle)
          this.statusSubject.next(Status.READY);

          this.logger.debug("Received result from remote Claude", {
            teamName: this.teamName,
            messagesProcessed: this.messagesProcessed,
          });
        }
      } catch (e) {
        // Not JSON, log warning
        this.logger.debug("Non-JSON stdout line from remote Claude", {
          teamName: this.teamName,
          line: line.substring(0, 200),
        });
      }
    }
  }

  /**
   * Handle stderr data (SSH errors and remote Claude errors)
   */
  private handleStderrData(data: Buffer): void {
    const rawData = data.toString();
    this.stderrBuffer += rawData;

    // Log stderr lines
    const lines = this.stderrBuffer.split("\n");
    this.stderrBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      this.logger.warn(`SSH stderr: ${line}`, {
        teamName: this.teamName,
      });

      // Detect SSH authentication failures
      if (
        line.includes("Permission denied") ||
        line.includes("Authentication failed")
      ) {
        const error = new ProcessError(
          "SSH authentication failed",
          this.teamName,
        );
        this.errorsSubject.next(error);
      }

      // Detect SSH connection failures
      if (
        line.includes("Connection refused") ||
        line.includes("Connection timed out")
      ) {
        const error = new ProcessError("SSH connection failed", this.teamName);
        this.errorsSubject.next(error);
      }
    }
  }

  /**
   * Write message to stdin (formatted as stream-json)
   */
  private writeToStdin(message: string): void {
    if (!this.sshProcess || !this.sshProcess.stdin) {
      throw new ProcessError("SSH process stdin not available", this.teamName);
    }

    const userMessage = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    };

    this.sshProcess.stdin.write(JSON.stringify(userMessage) + "\n");

    this.logger.debug("Wrote message to remote stdin", {
      teamName: this.teamName,
      messageLength: message.length,
    });
  }

  /**
   * Wait for init message from remote Claude
   */
  private async waitForInit(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;

      // Timeout if init not received
      const timer = setTimeout(() => {
        if (this.initReject) {
          this.logger.error("Timeout waiting for init from remote Claude", {
            teamName: this.teamName,
            timeout,
          });

          this.initReject(
            new TimeoutError(
              `Timeout waiting for init from remote Claude after ${timeout}ms`,
              timeout,
            ),
          );
          this.initReject = null;
          this.initResolve = null;
        }
      }, timeout);

      // Clear timeout when resolved/rejected
      const originalResolve = this.initResolve;
      const originalReject = this.initReject;

      this.initResolve = () => {
        clearTimeout(timer);
        originalResolve();
      };

      this.initReject = (error: Error) => {
        clearTimeout(timer);
        originalReject(error);
      };
    });
  }

  /**
   * Execute tell operation (send message to remote Claude)
   */
  executeTell(cacheEntry: CacheEntry): void {
    if (!this.ready || !this.sshProcess || !this.sshProcess.stdin) {
      throw new ProcessError("SSH transport not ready for tell", this.teamName);
    }

    if (this.currentCacheEntry) {
      throw new ProcessError(
        "SSH transport busy with another message",
        this.teamName,
      );
    }

    // Emit BUSY status
    this.statusSubject.next(Status.BUSY);

    this.currentCacheEntry = cacheEntry;

    this.logger.debug("Executing tell on remote transport", {
      teamName: this.teamName,
      tellStringLength: cacheEntry.tellString.length,
    });

    // Send message via stdin
    this.writeToStdin(cacheEntry.tellString);
  }

  /**
   * Terminate SSH process
   */
  async terminate(): Promise<void> {
    if (!this.sshProcess) {
      this.logger.debug("SSH process already terminated", {
        teamName: this.teamName,
      });
      return;
    }

    this.logger.info("Terminating SSH process", {
      teamName: this.teamName,
      pid: this.sshProcess.pid,
    });

    // Emit TERMINATING status
    this.statusSubject.next(Status.TERMINATING);

    this.ready = false;

    return new Promise((resolve) => {
      if (!this.sshProcess) {
        resolve();
        return;
      }

      const process = this.sshProcess;

      // Close stdin to signal end
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }

      // Wait for graceful exit
      const timer = setTimeout(() => {
        this.logger.warn("SSH process did not exit gracefully, killing", {
          teamName: this.teamName,
          pid: process.pid,
        });
        process.kill("SIGKILL");
      }, 5000);

      process.once("exit", async () => {
        clearTimeout(timer);
        this.sshProcess = null;

        // Clean up remote MCP config file if it exists
        if (this.mcpConfigFilePath) {
          try {
            const sshHost = this.extractSshHost();
            const { spawn } = await import("child_process");

            // Use ssh to remove remote file
            const rmProc = spawn(
              "ssh",
              [sshHost, "rm", "-f", this.mcpConfigFilePath],
              {
                stdio: "ignore",
              },
            );

            rmProc.on("exit", (code) => {
              if (code === 0) {
                this.logger.debug("Deleted remote MCP config file", {
                  teamName: this.teamName,
                  filePath: this.mcpConfigFilePath,
                  sshHost,
                });
              } else {
                this.logger.warn("Failed to delete remote MCP config file", {
                  teamName: this.teamName,
                  filePath: this.mcpConfigFilePath,
                  sshHost,
                  exitCode: code,
                });
              }
            });
          } catch (error) {
            this.logger.warn("Error cleaning up remote MCP config file", {
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

      // Send SIGTERM for graceful shutdown
      process.kill("SIGTERM");
    });
  }

  /**
   * Cancel current operation
   */
  cancel(): void {
    if (!this.sshProcess || !this.sshProcess.stdin) {
      this.logger.debug("Cannot cancel - SSH process not running", {
        teamName: this.teamName,
      });
      return;
    }

    this.logger.info("Canceling current operation", {
      teamName: this.teamName,
    });

    // Send ESC to stdin (ASCII 27)
    this.sshProcess.stdin.write("\x1b", "utf8");

    // Clear current cache entry
    this.currentCacheEntry = null;
  }

  /**
   * Get process ID (local SSH client process)
   */
  getPid(): number | null {
    return this.sshProcess?.pid ?? null;
  }

  /**
   * Check if transport is ready
   */
  isReady(): boolean {
    return this.ready && this.sshProcess !== null;
  }

  /**
   * Check if currently processing a message
   */
  isBusy(): boolean {
    return this.currentCacheEntry !== null;
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      messagesProcessed: this.messagesProcessed,
      lastResponseAt: this.lastResponseAt,
      uptime: this.sshProcess ? Date.now() - this.startTime : 0,
      ready: this.ready,
    };
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

      // Remote execution
      remote: this.irisConfig.remote,
      ssh2: this.irisConfig.ssh2,
      remoteOptions: this.irisConfig.remoteOptions || {},

      // Project path
      path: this.irisConfig.path,

      // Description
      description: this.irisConfig.description,
    };

    return JSON.stringify(snapshot, null, 2);
  }
}
