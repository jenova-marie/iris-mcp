/**
 * Iris MCP - Teams Configuration Loader
 * Loads and validates config.json configuration with Zod
 */

import { readFileSync, existsSync, watchFile, copyFileSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
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
  teams: z.record(z.string(), TeamConfigSchema),
});

/**
 * Copy config.default.json to config.json
 */
function createDefaultConfig(configPath: string): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const defaultConfigPath = resolve(__dirname, '../config.default.json');

  if (!existsSync(defaultConfigPath)) {
    throw new ConfigurationError(
      `Default configuration template not found: ${defaultConfigPath}`
    );
  }

  copyFileSync(defaultConfigPath, configPath);
  logger.info('Created default configuration', { path: configPath });
}

/**
 * Output instructions for configuring teams and exit
 */
function outputInstructionsAndExit(configPath: string): never {
  console.error('\n╔════════════════════════════════════════════════════════════════════╗');
  console.error('║           Iris MCP - Configuration Required                       ║');
  console.error('╚════════════════════════════════════════════════════════════════════╝\n');
  console.error(`Configuration file: ${configPath}\n`);
  console.error('No teams are configured. Please add team entries to the "teams" object.\n');
  console.error('Example configuration:\n');
  console.error('  "teams": {');
  console.error('    "frontend": {');
  console.error('      "path": "/absolute/path/to/your/project",');
  console.error('      "description": "Frontend application"');
  console.error('    },');
  console.error('    "backend": {');
  console.error('      "path": "/absolute/path/to/backend",');
  console.error('      "description": "Backend API service",');
  console.error('      "idleTimeout": 600000,');
  console.error('      "skipPermissions": false,');
  console.error('      "color": "#FF6B6B"');
  console.error('    }');
  console.error('  }\n');
  console.error('Optional team properties:');
  console.error('  - idleTimeout: milliseconds before process stops (default: 300000)');
  console.error('  - skipPermissions: auto-approve Claude actions (default: false)');
  console.error('  - color: hex color for UI (e.g., "#FF6B6B")\n');

  process.exit(0);
}

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
      // Step 1: If config.json doesn't exist, copy default and exit with instructions
      if (!existsSync(this.configPath)) {
        logger.info('Configuration file not found, creating from defaults', {
          path: this.configPath
        });
        createDefaultConfig(this.configPath);
        outputInstructionsAndExit(this.configPath);
      }

      const content = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate with Zod
      const validated = TeamsConfigSchema.parse(parsed);

      // Step 2: If no teams configured, output instructions and exit
      if (Object.keys(validated.teams).length === 0) {
        logger.warn('No teams configured in config file');
        outputInstructionsAndExit(this.configPath);
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
