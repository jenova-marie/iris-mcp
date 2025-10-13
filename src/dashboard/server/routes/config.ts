/**
 * Iris MCP Dashboard - Config API Routes
 * GET/PUT endpoints for configuration management
 */

import { Router } from 'express';
import { writeFileSync } from 'fs';
import { z } from 'zod';
import type { DashboardStateBridge } from '../state-bridge.js';
import { getChildLogger } from '../../../utils/logger.js';
import { getConfigPath } from '../../../utils/paths.js';

const logger = getChildLogger('dashboard:routes:config');
const router = Router();

// Zod schema for config validation (same as TeamsConfigSchema)
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

const ConfigSchema = z.object({
  settings: z.object({
    idleTimeout: z.number().positive(),
    maxProcesses: z.number().int().min(1).max(50),
    healthCheckInterval: z.number().positive(),
    sessionInitTimeout: z.number().positive(),
    httpPort: z.number().int().min(1).max(65535).optional(),
    defaultTransport: z.enum(["stdio", "http"]).optional(),
  }),
  dashboard: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1).max(65535),
    host: z.string(),
  }).optional(),
  teams: z.record(z.string(), TeamConfigSchema),
});

export function createConfigRouter(bridge: DashboardStateBridge): Router {
  /**
   * GET /api/config
   * Returns current configuration
   */
  router.get('/', (req, res) => {
    try {
      const config = bridge.getConfig();

      res.json({
        success: true,
        config,
      });
    } catch (error: any) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, 'Failed to get config');
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve configuration',
      });
    }
  });

  /**
   * PUT /api/config
   * Saves new configuration to disk
   * Does NOT apply changes (requires restart)
   */
  router.put('/', (req, res) => {
    try {
      // Validate request body
      const validation = ConfigSchema.safeParse(req.body);

      if (!validation.success) {
        const errors = validation.error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        }));

        logger.warn({ errors }, 'Config validation failed');

        return res.status(400).json({
          success: false,
          error: 'Configuration validation failed',
          details: errors,
        });
      }

      const newConfig = validation.data;

      // Get config file path
      const configPath = getConfigPath();

      // Write to disk
      writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

      logger.info({ configPath }, 'Configuration saved to disk');

      // Emit event for WebSocket clients
      bridge.emit('ws:config-saved', {
        timestamp: Date.now(),
        configPath,
      });

      res.json({
        success: true,
        message: 'Configuration saved. Restart Iris MCP to apply changes.',
        configPath,
      });
    } catch (error: any) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, 'Failed to save config');
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to save configuration',
      });
    }
  });

  return router;
}
