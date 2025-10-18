/**
 * Iris MCP - Teams Configuration Loader
 * Loads and validates config.yaml configuration with Zod
 */

import { readFileSync, existsSync, watchFile } from "fs";
import { resolve, dirname, isAbsolute } from "path";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import type { TeamsConfig } from "../process-pool/types.js";
import { getChildLogger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";
import { getConfigPath, ensureIrisHome } from "../utils/paths.js";
import { interpolateObject } from "../utils/env-interpolation.js";

// Lazy logger getter to avoid initialization at module load time
let _logger: ReturnType<typeof getChildLogger> | null = null;
const getLogger = () => {
  if (!_logger) {
    _logger = getChildLogger("config:teams");
  }
  return _logger;
};

// Zod schema for validation
const IrisConfigSchema = z
  .object({
    path: z.string().min(1, "Path cannot be empty"),
    description: z.string(),
    idleTimeout: z.number().positive().optional(),
    sessionInitTimeout: z.number().positive().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
      .optional(),
    // Phase 2: Remote execution via SSH
    remote: z.string().optional(), // SSH connection string (e.g., "user@host")
    ssh2: z.boolean().optional(), // Use ssh2 library instead of OpenSSH client (default: false)
    remoteOptions: z
      .object({
        identity: z.string().optional(), // Path to SSH private key
        passphrase: z.string().optional(), // Passphrase for encrypted SSH key (ssh2 only)
        port: z.number().int().min(1).max(65535).optional(), // SSH port
        strictHostKeyChecking: z.boolean().optional(), // SSH host key checking
        connectTimeout: z.number().positive().optional(), // Connection timeout in ms
        serverAliveInterval: z.number().positive().optional(), // Keep-alive interval in seconds
        serverAliveCountMax: z.number().int().positive().optional(), // Max missed keep-alives
        compression: z.boolean().optional(), // Enable SSH compression
        forwardAgent: z.boolean().optional(), // Forward SSH agent
        extraSshArgs: z.array(z.string()).optional(), // Additional SSH arguments
      })
      .optional(),
    claudePath: z.string().optional(), // Custom path to Claude CLI executable (default: "claude", supports ~ expansion)
    // Reverse MCP tunneling
    enableReverseMcp: z.boolean().optional(), // Enable reverse MCP tunnel for this team
    reverseMcpPort: z.number().int().min(1).max(65535).optional(), // Port to tunnel (default: 1615)
    allowHttp: z.boolean().optional(), // Allow HTTP for reverse MCP (dev only, default: false)
    // Permission approval mode
    grantPermission: z
      .enum(["yes", "no", "ask", "forward"])
      .optional()
      .default("ask"), // How to handle permission requests (default: ask for safety)
    // Tool allowlist/denylist
    allowedTools: z.string().optional(), // Comma-separated list of allowed MCP tools (passed to Claude CLI --allowed-tools flag)
    disallowedTools: z.string().optional(), // Comma-separated list of denied MCP tools (passed to Claude CLI --disallowed-tools flag)
    // System prompt customization
    appendSystemPrompt: z.string().optional(), // Additional system prompt to append (passed to Claude CLI --append-system-prompt flag)
  })
  .refine(
    (data) => {
      // If remote is specified, claudePath is required
      if (data.remote && !data.claudePath) {
        return false;
      }
      return true;
    },
    {
      message: "claudePath is required when remote is specified",
      path: ["claudePath"],
    },
  )
  .refine(
    (data) => {
      // enableReverseMcp requires remote execution to be configured
      if (data.enableReverseMcp && !data.remote) {
        return false;
      }
      return true;
    },
    {
      message: "enableReverseMcp requires remote execution to be configured",
      path: ["enableReverseMcp"],
    },
  );

const TeamsConfigSchema = z.object({
  settings: z.object({
    sessionInitTimeout: z.number().positive().optional().default(30000),
    spawnTimeout: z.number().positive().optional().default(20000),
    responseTimeout: z.number().positive().optional().default(120000),
    idleTimeout: z.number().positive().optional().default(3600000),
    maxProcesses: z.number().int().min(1).max(50).optional().default(10),
    healthCheckInterval: z.number().positive().optional().default(30000),
    httpPort: z.number().int().min(1).max(65535).optional().default(1615),
    defaultTransport: z.enum(["stdio", "http"]).optional().default("stdio"),
    wonderLoggerConfig: z.string().optional().default("./wonder-logger.yaml"),
  }),
  dashboard: z
    .object({
      enabled: z.boolean().default(true),
      host: z.string().default("localhost"),
      http: z.number().int().min(0).max(65535).optional().default(0),
      https: z.number().int().min(0).max(65535).optional().default(3100),
      selfsigned: z.boolean().optional().default(false),
      certPath: z.string().optional(),
      keyPath: z.string().optional(),
    })
    .refine(
      (data) => {
        // At least one of http or https must be enabled (non-zero)
        if (data.http === 0 && data.https === 0) {
          return false;
        }
        return true;
      },
      {
        message:
          "At least one of http or https must be enabled (non-zero port)",
      },
    )
    .refine(
      (data) => {
        // If https is enabled, must have either selfsigned=true OR both certPath and keyPath
        if (data.https !== 0) {
          if (!data.selfsigned && (!data.certPath || !data.keyPath)) {
            return false;
          }
        }
        return true;
      },
      {
        message:
          "HTTPS requires either selfsigned=true or both certPath and keyPath",
      },
    )
    .optional()
    .default({
      enabled: true,
      host: "localhost",
      http: 3100,
      https: 0,
      selfsigned: false,
    }),
  database: z
    .object({
      path: z.string().optional().default("data/team-sessions.db"),
      inMemory: z.boolean().optional().default(false),
    })
    .optional()
    .default({
      path: "data/team-sessions.db",
      inMemory: false,
    }),
  teams: z.record(z.string(), IrisConfigSchema),
});

export class TeamsConfigManager {
  private config: TeamsConfig | null = null;
  private configPath: string;
  private watchCallback?: (config: TeamsConfig) => void;

  constructor(configPath?: string) {
    // Use provided path, or IRIS_CONFIG_PATH env var, or default to $IRIS_HOME/config.yaml (or ~/.iris/config.yaml)
    if (configPath) {
      this.configPath = configPath;
    } else if (process.env.IRIS_CONFIG_PATH) {
      this.configPath = resolve(process.env.IRIS_CONFIG_PATH);
    } else {
      // Use $IRIS_HOME/config.yaml or ~/.iris/config.yaml
      this.configPath = getConfigPath();
    }

    // Ensure IRIS_HOME directory structure exists
    ensureIrisHome();
  }

  /**
   * Detect fork script in IRIS_HOME directory
   */
  private detectForkScript(): string | undefined {
    const configDir = dirname(resolve(this.configPath));

    // Platform-specific script names
    const scriptNames =
      process.platform === "win32" ? ["fork.bat", "fork.ps1"] : ["fork.sh"];

    for (const scriptName of scriptNames) {
      const scriptPath = resolve(configDir, scriptName);
      if (existsSync(scriptPath)) {
        getLogger().info({ scriptPath }, "Fork script detected");
        return scriptPath;
      }
    }

    getLogger().debug("No fork script found - Fork feature will be disabled");
    return undefined;
  }

  /**
   * Load configuration from file
   */
  load(): TeamsConfig {
    try {
      // Check if config file exists
      if (!existsSync(this.configPath)) {
        console.error(
          "\n╔════════════════════════════════════════════════════════════════════╗",
        );
        console.error(
          "║           Iris MCP - Configuration Not Found                      ║",
        );
        console.error(
          "╚════════════════════════════════════════════════════════════════════╝\n",
        );
        console.error(`Configuration file not found: ${this.configPath}\n`);
        console.error(
          "Run the install command to create the default configuration:\n",
        );
        console.error("  $ iris install\n");
        console.error("This will:");
        console.error("  1. Create the Iris MCP configuration file");
        console.error("  2. Install Iris to your Claude CLI configuration\n");
        process.exit(0);
      }

      const content = readFileSync(this.configPath, "utf8");

      // Parse YAML
      const parsed = parseYaml(content);

      // Interpolate environment variables
      const interpolated = interpolateObject(parsed, true);

      // Validate with Zod
      const validated = TeamsConfigSchema.parse(interpolated);

      // Check if teams are configured
      if (Object.keys(validated.teams).length === 0) {
        console.error(
          "\n╔════════════════════════════════════════════════════════════════════╗",
        );
        console.error(
          "║           Iris MCP - No Teams Configured                          ║",
        );
        console.error(
          "╚════════════════════════════════════════════════════════════════════╝\n",
        );
        console.error(`Configuration file: ${this.configPath}\n`);
        console.error("No teams are configured. Add teams to get started:\n");
        console.error("Add a team using current directory:");
        console.error("  $ iris add-team <name>\n");
        console.error("Add a team with specific path:");
        console.error("  $ iris add-team <name> /path/to/project\n");
        console.error("Show add-team help:");
        console.error("  $ iris add-team --help\n");
        process.exit(0);
      }

      // Resolve team paths relative to config file directory
      const configDir = dirname(resolve(this.configPath));
      for (const [name, team] of Object.entries(validated.teams)) {
        // If path is relative, resolve it relative to config file directory
        if (!isAbsolute(team.path)) {
          team.path = resolve(configDir, team.path);
        }

        // Skip path validation for remote teams - paths exist on remote host
        if (team.remote) {
          getLogger().debug(
            { name, path: team.path, remote: team.remote },
            `Skipping path validation for remote team`,
          );
          continue;
        }

        // Validate local team paths exist
        if (!existsSync(team.path)) {
          getLogger().warn(
            { name, path: team.path },
            `Team "${name}" path does not exist`,
          );
        }
      }

      // Cast to TeamsConfig and detect fork script for Fork feature
      const config: TeamsConfig = validated as TeamsConfig;
      const forkScriptPath = this.detectForkScript();
      if (config.dashboard && forkScriptPath) {
        config.dashboard.forkScriptPath = forkScriptPath;
      }

      this.config = config;
      getLogger().info(
        {
          teams: Object.keys(validated.teams),
          maxProcesses: validated.settings.maxProcesses,
        },
        "Configuration loaded successfully",
      );

      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.errors.map(
          (e) => `${e.path.join(".")}: ${e.message}`,
        );
        throw new ConfigurationError(
          `Configuration validation failed:\n${messages.join("\n")}`,
        );
      }

      // YAML parse errors
      if (error instanceof Error && error.name === "YAMLParseError") {
        throw new ConfigurationError(
          `Invalid YAML in configuration file: ${error.message}`,
        );
      }

      // Environment variable interpolation errors
      if (
        error instanceof Error &&
        error.message.includes("Environment variable")
      ) {
        throw new ConfigurationError(error.message);
      }

      throw error;
    }
  }

  /**
   * Get current configuration (throws if not loaded)
   */
  getConfig(): TeamsConfig {
    if (!this.config) {
      throw new ConfigurationError(
        "Configuration not loaded. Call load() first.",
      );
    }
    return this.config;
  }

  /**
   * Get configuration for a specific team
   */
  getIrisConfig(teamName: string) {
    const config = this.getConfig();
    const team = config.teams[teamName];

    if (!team) {
      return null;
    }

    return {
      ...team,
      idleTimeout: team.idleTimeout || config.settings.idleTimeout,
    };
  }

  /**
   * Get list of all team names
   */
  getTeamNames(): string[] {
    return Object.keys(this.getConfig().teams);
  }

  /**
   * Watch configuration file for changes
   */
  watch(callback: (config: TeamsConfig) => void): void {
    this.watchCallback = callback;

    watchFile(this.configPath, { interval: 1000 }, () => {
      getLogger().info("Configuration file changed, reloading...");

      try {
        const newConfig = this.load();
        if (this.watchCallback) {
          this.watchCallback(newConfig);
        }
      } catch (error) {
        getLogger().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
          },
          "Failed to reload configuration",
        );
      }
    });

    getLogger().info("Watching configuration file for changes");
  }
}

// Singleton instance
let configManager: TeamsConfigManager | null = null;

export function getConfigManager(configPath?: string): TeamsConfigManager {
  if (!configManager) {
    configManager = new TeamsConfigManager(configPath);
  }
  return configManager;
}
