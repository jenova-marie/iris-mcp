/**
 * Iris MCP - Teams Configuration Loader
 * Loads and validates config.json configuration with Zod
 */

import { readFileSync, existsSync, watchFile } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { z } from 'zod';
import type { TeamsConfig } from '../process-pool/types.js';
import { Logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/errors.js';
import { getConfigPath, ensureIrisHome } from '../utils/paths.js';

const logger = new Logger('config');

// Zod schema for validation
const TeamConfigSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
  description: z.string(),
  idleTimeout: z.number().positive().optional(),
  sessionInitTimeout: z.number().positive().optional(),
  skipPermissions: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
    .optional(),
});

const TeamsConfigSchema = z.object({
  settings: z.object({
    idleTimeout: z.number().positive(),
    maxProcesses: z.number().int().min(1).max(50),
    healthCheckInterval: z.number().positive(),
    sessionInitTimeout: z.number().positive(),
    httpPort: z.number().int().min(1).max(65535).optional().default(1615),
    defaultTransport: z.enum(["stdio", "http"]).optional().default("stdio"),
  }),
  dashboard: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1).max(65535).default(3100),
    host: z.string().default("localhost"),
  }).optional().default({
    enabled: true,
    port: 3100,
    host: "localhost",
  }),
  teams: z.record(z.string(), TeamConfigSchema),
});


export class TeamsConfigManager {
  private config: TeamsConfig | null = null;
  private configPath: string;
  private watchCallback?: (config: TeamsConfig) => void;

  constructor(configPath?: string) {
    // Use provided path, or IRIS_CONFIG_PATH env var, or default to $IRIS_HOME/config.json (or ~/.iris/config.json)
    if (configPath) {
      this.configPath = configPath;
    } else if (process.env.IRIS_CONFIG_PATH) {
      this.configPath = resolve(process.env.IRIS_CONFIG_PATH);
    } else {
      // Use $IRIS_HOME/config.json or ~/.iris/config.json
      this.configPath = getConfigPath();
    }

    // Ensure IRIS_HOME directory structure exists
    ensureIrisHome();
  }

  /**
   * Load configuration from file
   */
  load(): TeamsConfig {
    try {
      // Check if config file exists
      if (!existsSync(this.configPath)) {
        console.error('\n╔════════════════════════════════════════════════════════════════════╗');
        console.error('║           Iris MCP - Configuration Not Found                      ║');
        console.error('╚════════════════════════════════════════════════════════════════════╝\n');
        console.error(`Configuration file not found: ${this.configPath}\n`);
        console.error('Run the install command to create the default configuration:\n');
        console.error('  $ iris install\n');
        console.error('This will:');
        console.error('  1. Create the Iris MCP configuration file');
        console.error('  2. Install Iris to your Claude CLI configuration\n');
        process.exit(0);
      }

      const content = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate with Zod
      const validated = TeamsConfigSchema.parse(parsed);

      // Check if teams are configured
      if (Object.keys(validated.teams).length === 0) {
        console.error('\n╔════════════════════════════════════════════════════════════════════╗');
        console.error('║           Iris MCP - No Teams Configured                          ║');
        console.error('╚════════════════════════════════════════════════════════════════════╝\n');
        console.error(`Configuration file: ${this.configPath}\n`);
        console.error('No teams are configured. Add teams to get started:\n');
        console.error('Add a team using current directory:');
        console.error('  $ iris add-team <name>\n');
        console.error('Add a team with specific path:');
        console.error('  $ iris add-team <name> /path/to/project\n');
        console.error('Show add-team help:');
        console.error('  $ iris add-team --help\n');
        process.exit(0);
      }

      // Resolve team paths relative to config file directory
      const configDir = dirname(resolve(this.configPath));
      for (const [name, team] of Object.entries(validated.teams)) {
        // If path is relative, resolve it relative to config file directory
        if (!isAbsolute(team.path)) {
          team.path = resolve(configDir, team.path);
        }

        // Validate team paths exist
        if (!existsSync(team.path)) {
          logger.warn(`Team "${name}" path does not exist: ${team.path}`);
        }
      }

      this.config = validated;
      logger.info('Configuration loaded successfully', {
        teams: Object.keys(validated.teams),
        maxProcesses: validated.settings.maxProcesses,
      });

      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        throw new ConfigurationError(
          `Configuration validation failed:\n${messages.join('\n')}`
        );
      }

      if (error instanceof SyntaxError) {
        throw new ConfigurationError(
          `Invalid JSON in configuration file: ${error.message}`
        );
      }

      throw error;
    }
  }

  /**
   * Get current configuration (throws if not loaded)
   */
  getConfig(): TeamsConfig {
    if (!this.config) {
      throw new ConfigurationError('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Get configuration for a specific team
   */
  getTeamConfig(teamName: string) {
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
      logger.info('Configuration file changed, reloading...');

      try {
        const newConfig = this.load();
        if (this.watchCallback) {
          this.watchCallback(newConfig);
        }
      } catch (error) {
        logger.error('Failed to reload configuration', error);
      }
    });

    logger.info('Watching configuration file for changes');
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
