/**
 * Iris MCP - Teams Configuration Loader
 * Loads and validates teams.json configuration with Zod
 */

import { readFileSync, existsSync, watchFile } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { TeamsConfig } from '../process-pool/types.js';
import { Logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/errors.js';

const logger = new Logger('config');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  }),
  teams: z.record(z.string(), TeamConfigSchema),
});

export class TeamsConfigManager {
  private config: TeamsConfig | null = null;
  private configPath: string;
  private watchCallback?: (config: TeamsConfig) => void;

  constructor(configPath?: string) {
    // Default to teams.json in project root
    // Use IRIS_CONFIG_PATH env var, or resolve relative to this module's directory
    if (configPath) {
      this.configPath = configPath;
    } else if (process.env.IRIS_CONFIG_PATH) {
      this.configPath = resolve(process.env.IRIS_CONFIG_PATH);
    } else {
      // Resolve relative to the dist directory (2 levels up from config/)
      this.configPath = resolve(__dirname, '../../teams.json');
    }
  }

  /**
   * Load configuration from file
   */
  load(): TeamsConfig {
    try {
      if (!existsSync(this.configPath)) {
        throw new ConfigurationError(
          `Configuration file not found: ${this.configPath}\n` +
          'Create teams.json from teams.example.json'
        );
      }

      const content = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate with Zod
      const validated = TeamsConfigSchema.parse(parsed);

      // Validate team paths exist
      for (const [name, team] of Object.entries(validated.teams)) {
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
