/**
 * Remote SSH Transport - Execute Claude Code on remote hosts via SSH
 *
 * This transport uses ssh2 to establish SSH connections and execute
 * Claude Code remotely, streaming stdio bidirectionally.
 */

import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { resolve, dirname, join } from "path";
import SSHConfig from "ssh-config";
import { BehaviorSubject, Subject, Observable } from "rxjs";
import type { CacheEntry } from "../cache/types.js";
import type { Transport, TransportMetrics, TransportStatus } from "./transport.interface.js";
import { TransportStatus as Status } from "./transport.interface.js";
import type { IrisConfig, RemoteOptions } from "../process-pool/types.js";
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
 * SSH2Transport - Executes Claude remotely via SSH
 */
export class SSH2Transport implements Transport {
  private sshClient: Client | null = null;
  private execChannel: ClientChannel | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private ready = false;
  private startTime = 0;
  private responseBuffer = "";
  private logger: ReturnType<typeof getChildLogger>;
  private remoteHost: string;
  private remoteOptions: RemoteOptions;

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
    this.logger = getChildLogger(`transport:remote:${teamName}`);

    if (!irisConfig.remote) {
      throw new ProcessError(
        "Remote host not specified in config",
        this.teamName,
      );
    }

    this.remoteHost = irisConfig.remote;
    this.remoteOptions = irisConfig.remoteOptions || {};

    // Expose observables
    this.status$ = this.statusSubject.asObservable();
    this.errors$ = this.errorsSubject.asObservable();
  }

  /**
   * Spawn Claude process remotely via SSH exec
   */
  async spawn(
    spawnCacheEntry: CacheEntry,
    spawnTimeout = 20000,
  ): Promise<void> {
    if (this.sshClient) {
      throw new ProcessError(
        "SSH connection already established",
        this.teamName,
      );
    }

    this.logger.info("Spawning remote Claude process via SSH", {
      teamName: this.teamName,
      sessionId: this.sessionId,
      remoteHost: this.remoteHost,
      cacheEntryType: spawnCacheEntry.cacheEntryType,
    });

    // Emit CONNECTING status
    this.statusSubject.next(Status.CONNECTING);

    // Set current cache entry for init messages
    this.currentCacheEntry = spawnCacheEntry;
    this.startTime = Date.now();

    // Establish SSH connection
    await this.connectSSH();

    // Emit SPAWNING status
    this.statusSubject.next(Status.SPAWNING);

    // Build Claude command
    const claudeCmd = this.buildClaudeCommand();

    this.logger.info("Executing remote Claude command", {
      teamName: this.teamName,
      command: claudeCmd,
    });

    // Execute Claude remotely
    await this.executeRemoteCommand(claudeCmd);

    // Send spawn ping
    this.writeToStdin(spawnCacheEntry.tellString);

    // Wait for init message
    await this.waitForInit(spawnTimeout);

    this.ready = true;

    // Emit READY status
    this.statusSubject.next(Status.READY);

    this.logger.info("Remote transport ready", {
      teamName: this.teamName,
      remoteHost: this.remoteHost,
    });
  }

  /**
   * Execute tell by writing to stdin
   */
  executeTell(cacheEntry: CacheEntry): void {
    if (!this.ready) {
      throw new ProcessError("Remote process not ready", this.teamName);
    }

    if (this.currentCacheEntry) {
      throw new ProcessBusyError("Process already processing a request");
    }

    this.logger.debug("Executing tell on remote transport", {
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
   * Terminate remote SSH connection
   */
  async terminate(): Promise<void> {
    if (!this.sshClient) return;

    this.logger.info("Terminating remote SSH connection", {
      teamName: this.teamName,
      remoteHost: this.remoteHost,
    });

    // Emit TERMINATING status
    this.statusSubject.next(Status.TERMINATING);

    return new Promise<void>((resolve) => {
      if (!this.sshClient) {
        resolve();
        return;
      }

      // Force disconnect after 5 seconds
      const disconnectTimer = setTimeout(() => {
        if (this.sshClient) {
          this.logger.warn("Force disconnecting SSH client");
          this.sshClient.destroy();
        }
      }, 5000);

      // Clean up on close
      this.sshClient.once("close", () => {
        clearTimeout(disconnectTimer);
        this.sshClient = null;
        this.execChannel = null;
        this.ready = false;
        this.currentCacheEntry = null;

        // Emit STOPPED status
        this.statusSubject.next(Status.STOPPED);

        resolve();
      });

      // Try graceful shutdown first - close the exec channel
      if (this.execChannel) {
        this.execChannel.close();
      } else {
        // No channel open, just end the connection
        this.sshClient.end();
      }
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
   * Get process ID (not applicable for ssh2 library - returns null)
   *
   * ssh2 is a pure JavaScript library with no local process.
   * Use SSHTransport (OpenSSH client) if you need PID tracking.
   */
  getPid(): number | null {
    return null;
  }

  /**
   * Send cancel string to stdin (attempt to cancel)
   */
  cancel(): void {
    if (!this.execChannel || !this.execChannel.writable) {
      this.logger.warn("Cancel called but exec channel not available", {
        teamName: this.teamName,
        hasChannel: !!this.execChannel,
        remoteHost: this.remoteHost,
      });
      return; // Gracefully handle unspawned transport
    }

    this.logger.info("Sending cancel string to remote stdin", {
      teamName: this.teamName,
      remoteHost: this.remoteHost,
      isBusy: this.currentCacheEntry !== null,
    });

    // Send cancel string as per cancel action
    this.execChannel.write("cancel\n");

    this.logger.debug("Cancel string sent to remote stdin");
  }

  /**
   * Establish SSH connection
   */
  private async connectSSH(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sshClient = new Client();

      // Build SSH config by parsing ~/.ssh/config and merging with remoteOptions
      const config = this.buildSSHConfig();

      this.logger.debug("Establishing SSH connection", {
        teamName: this.teamName,
        host: config.host,
        port: config.port,
        username: config.username,
      });

      // Setup event handlers
      this.sshClient.on("ready", () => {
        this.logger.info("SSH connection established", {
          teamName: this.teamName,
          remoteHost: this.remoteHost,
        });
        resolve();
      });

      this.sshClient.on("error", (error) => {
        this.logger.error(
          {
            err: error,
            teamName: this.teamName,
            remoteHost: this.remoteHost,
          },
          "SSH connection error",
        );

        // Emit error to errors$ stream
        this.errorsSubject.next(error);

        // Emit ERROR status
        this.statusSubject.next(Status.ERROR);

        reject(
          new ProcessError(
            `SSH connection failed: ${error.message}`,
            this.teamName,
          ),
        );
      });

      this.sshClient.on("close", () => {
        this.logger.info("SSH connection closed", {
          teamName: this.teamName,
          remoteHost: this.remoteHost,
        });

        this.sshClient = null;
        this.execChannel = null;
        this.ready = false;
        this.currentCacheEntry = null;

        // Emit STOPPED status
        this.statusSubject.next(Status.STOPPED);
      });

      // Connect
      this.sshClient.connect(config);
    });
  }

  /**
   * Execute remote command and setup stdio handlers
   */
  private async executeRemoteCommand(command: string): Promise<void> {
    if (!this.sshClient) {
      throw new ProcessError("SSH client not connected", this.teamName);
    }

    return new Promise((resolve, reject) => {
      this.sshClient!.exec(command, (err, channel) => {
        if (err) {
          return reject(
            new ProcessError(
              `Failed to execute remote command: ${err.message}`,
              this.teamName,
            ),
          );
        }

        this.execChannel = channel;

        // Setup stdio handlers
        this.setupStdioHandlers(channel);

        resolve();
      });
    });
  }

  /**
   * Build Claude command for remote execution
   */
  private buildClaudeCommand(): string {
    const args: string[] = ["claude"];

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

    args.push("--append-system-prompt", `'${systemPrompt.replace(/'/g, "'\\''")}'`);

    // Add MCP config for reverse tunnel if enabled
    if (this.irisConfig.enableReverseMcp) {
      const mcpPort = this.irisConfig.reverseMcpPort || 1615;
      const protocol = this.irisConfig.allowHttp ? "http" : "https";

      // Use sessionId as the unique path identifier
      const mcpUrl = `${protocol}://localhost:${mcpPort}/mcp/${this.sessionId}`;

      const mcpConfig = {
        mcpServers: {
          iris: {
            type: "http",
            url: mcpUrl,
          },
        },
      };

      args.push("--mcp-config", `'${JSON.stringify(mcpConfig)}'`);

      this.logger.debug("Added MCP config to remote Claude command", {
        teamName: this.teamName,
        sessionId: this.sessionId,
        mcpUrl,
      });
    }

    // Change to project directory
    const cdCmd = `cd ${this.escapeShellArg(this.irisConfig.path)}`;

    return `${cdCmd} && ${args.join(" ")}`;
  }

  /**
   * Setup stdio handlers for exec channel
   */
  private setupStdioHandlers(channel: ClientChannel): void {
    // Stdout handler
    channel.on("data", (data: Buffer) => {
      this.handleStdoutData(data);
    });

    // Stderr handler
    channel.stderr!.on("data", (data: Buffer) => {
      this.logger.debug("Remote Claude stderr", {
        teamName: this.teamName,
        output: data.toString().substring(0, 500),
      });
    });

    // Exit handler
    channel.on("exit", (code: number, signal: string) => {
      this.logger.info("Remote process exited", {
        teamName: this.teamName,
        remoteHost: this.remoteHost,
        code,
        signal,
      });

      this.execChannel = null;
      this.ready = false;
      this.currentCacheEntry = null;
    });

    // Close handler
    channel.on("close", () => {
      this.logger.debug("Remote exec channel closed", {
        teamName: this.teamName,
      });
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

        this.logger.debug("Parsed JSON message from remote transport", {
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
        this.logger.debug("Non-JSON stdout line from remote transport", {
          line: line.substring(0, 200),
        });
      }
    }
  }

  /**
   * Write message to stdin
   */
  private writeToStdin(message: string): void {
    if (!this.execChannel || !this.execChannel.writable) {
      throw new ProcessError(
        "Remote exec channel not available",
        this.teamName,
      );
    }

    const userMessage = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    };

    this.execChannel.write(JSON.stringify(userMessage) + "\n");

    this.logger.debug("Wrote message to remote stdin", {
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
          new ProcessError("Init timeout on remote transport", this.teamName),
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
   * Build SSH config by parsing ~/.ssh/config and merging with remoteOptions
   */
  private buildSSHConfig(): ConnectConfig {
    // Parse SSH config file
    const sshConfigPath = resolve(homedir(), ".ssh", "config");
    let parsedConfig: ReturnType<typeof SSHConfig.parse> | null = null;

    if (existsSync(sshConfigPath)) {
      try {
        const configContent = readFileSync(sshConfigPath, "utf8");
        parsedConfig = SSHConfig.parse(configContent);
        this.logger.debug("Loaded SSH config file", {
          teamName: this.teamName,
          path: sshConfigPath,
        });
      } catch (error) {
        this.logger.warn("Failed to parse SSH config", {
          teamName: this.teamName,
          error: error instanceof Error ? error.message : String(error),
          path: sshConfigPath,
        });
      }
    } else {
      this.logger.debug("SSH config file not found, using defaults", {
        teamName: this.teamName,
        path: sshConfigPath,
      });
    }

    // Extract host alias from remote string (e.g., "ssh inanna" → "inanna")
    const hostAlias = this.extractHostAlias(this.remoteHost);

    // Compute config for this host (merges Host sections with global settings)
    const hostConfig = parsedConfig?.compute(hostAlias);

    this.logger.debug("Computed SSH config for host", {
      teamName: this.teamName,
      hostAlias,
      hasConfig: !!hostConfig,
      HostName: hostConfig?.HostName,
      User: hostConfig?.User,
      Port: hostConfig?.Port,
      IdentityFile: hostConfig?.IdentityFile,
    });

    // Build ssh2 ConnectConfig with precedence:
    // 1. Explicit remoteOptions (highest)
    // 2. SSH config values
    // 3. Sensible defaults (lowest)

    // Helper to extract first value from string or array
    const getValue = (
      val: string | string[] | undefined,
    ): string | undefined => {
      if (!val) return undefined;
      return Array.isArray(val) ? val[0] : val;
    };

    const config: ConnectConfig = {
      host: getValue(hostConfig?.HostName) || hostAlias,
      port:
        this.remoteOptions.port ||
        (hostConfig?.Port
          ? parseInt(String(getValue(hostConfig.Port)), 10)
          : 22),
      username: getValue(hostConfig?.User) || process.env.USER || "root",
      readyTimeout: this.remoteOptions.connectTimeout || 30000,
      keepaliveInterval: this.remoteOptions.serverAliveInterval || 30000,
      keepaliveCountMax: this.remoteOptions.serverAliveCountMax || 3,
    };

    // Handle IdentityFile (prioritize explicit > SSH config)
    const identityFile =
      this.remoteOptions.identity ||
      (Array.isArray(hostConfig?.IdentityFile)
        ? hostConfig.IdentityFile[0]
        : hostConfig?.IdentityFile);

    if (identityFile) {
      try {
        // Expand tilde (~) to home directory
        const keyPath = String(identityFile).startsWith("~")
          ? resolve(homedir(), String(identityFile).slice(2))
          : String(identityFile);

        if (existsSync(keyPath)) {
          config.privateKey = readFileSync(keyPath);

          // Add passphrase if provided
          if (this.remoteOptions.passphrase) {
            config.passphrase = this.remoteOptions.passphrase;
            this.logger.debug("Using passphrase for SSH key", {
              teamName: this.teamName,
            });
          }

          this.logger.debug("Loaded SSH private key", {
            teamName: this.teamName,
            keyPath,
          });
        } else {
          this.logger.warn(
            "SSH key file not found, will attempt agent/password auth",
            {
              teamName: this.teamName,
              keyPath,
            },
          );
        }
      } catch (error) {
        this.logger.warn("Failed to read SSH key", {
          teamName: this.teamName,
          identityFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Handle StrictHostKeyChecking
    const strictHostKeyChecking =
      this.remoteOptions.strictHostKeyChecking ??
      hostConfig?.StrictHostKeyChecking;

    if (
      strictHostKeyChecking === false ||
      strictHostKeyChecking === "no" ||
      strictHostKeyChecking === "off"
    ) {
      // Disable host key verification (not recommended for production)
      config.hostVerifier = () => true;
      this.logger.warn("StrictHostKeyChecking disabled", {
        teamName: this.teamName,
        remoteHost: this.remoteHost,
      });
    }

    return config;
  }

  /**
   * Extract host alias from remote string
   * Examples:
   *  "ssh inanna" → "inanna"
   *  "inanna" → "inanna"
   *  "user@host" → "host"
   */
  private extractHostAlias(remoteHost: string): string {
    // Remove "ssh " prefix if present
    let host = remoteHost.replace(/^ssh\s+/, "");

    // If in user@host format, extract host
    const match = host.match(/@(.+)$/);
    if (match) {
      host = match[1];
    }

    return host;
  }

  /**
   * Escape shell argument for safe command execution
   */
  private escapeShellArg(arg: string): string {
    // Single-quote the argument and escape any single quotes within
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
