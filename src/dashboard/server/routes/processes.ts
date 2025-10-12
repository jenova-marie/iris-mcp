/**
 * Iris MCP Dashboard - Processes API Routes
 * GET endpoints for process monitoring
 */

import { Router } from 'express';
import type { DashboardStateBridge } from '../state-bridge.js';
import { Logger } from '../../../utils/logger.js';

const logger = new Logger('api:processes');
const router = Router();

export function createProcessesRouter(bridge: DashboardStateBridge): Router {
  /**
   * GET /api/processes
   * Returns list of all processes with their status
   */
  router.get('/', (req, res) => {
    try {
      const processes = bridge.getActiveProcesses();
      const poolStatus = bridge.getPoolStatus();

      res.json({
        success: true,
        processes,
        poolStatus,
      });
    } catch (error: any) {
      logger.error('Failed to get processes', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve processes',
      });
    }
  });

  /**
   * GET /api/processes/:team
   * Returns detailed metrics for a specific team process
   */
  router.get('/:team', (req, res) => {
    try {
      const { team } = req.params;
      const metrics = bridge.getProcessMetrics(team);

      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: `Process not found for team: ${team}`,
        });
      }

      res.json({
        success: true,
        metrics,
      });
    } catch (error: any) {
      logger.error('Failed to get process metrics', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve process metrics',
      });
    }
  });

  /**
   * GET /api/processes/:team/cache
   * Returns process cache (stdout/stderr buffers)
   * Note: Cache streaming is handled via WebSocket
   */
  router.get('/:team/cache', (req, res) => {
    try {
      const { team } = req.params;
      const cache = bridge.getProcessCache(team);

      if (!cache) {
        return res.status(404).json({
          success: false,
          error: `Process not found for team: ${team}`,
        });
      }

      res.json({
        success: true,
        cache,
      });
    } catch (error: any) {
      logger.error('Failed to get process cache', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve process cache',
      });
    }
  });

  return router;
}
