/**
 * Iris MCP Dashboard - Processes API Routes
 * Session-based process monitoring (fromTeam->toTeam)
 */

import { Router } from 'express';
import type { DashboardStateBridge } from '../state-bridge.js';
import { Logger } from '../../../utils/logger.js';

const logger = new Logger('api:processes');
const router = Router();

export function createProcessesRouter(bridge: DashboardStateBridge): Router {
  /**
   * GET /api/processes
   * Returns all active sessions (fromTeam->toTeam pairs)
   */
  router.get('/', (req, res) => {
    try {
      const sessions = bridge.getActiveSessions();
      const poolStatus = bridge.getPoolStatus();

      res.json({
        success: true,
        sessions,
        poolStatus,
      });
    } catch (error: any) {
      logger.error('Failed to get sessions', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve sessions',
      });
    }
  });

  /**
   * GET /api/processes/:fromTeam/:toTeam
   * Returns detailed metrics for a specific session
   */
  router.get('/:fromTeam/:toTeam', (req, res) => {
    try {
      const { fromTeam, toTeam } = req.params;
      const metrics = bridge.getSessionMetrics(fromTeam, toTeam);

      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: `Session not found: ${fromTeam}->${toTeam}`,
        });
      }

      res.json({
        success: true,
        metrics,
      });
    } catch (error: any) {
      logger.error('Failed to get session metrics', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve session metrics',
      });
    }
  });

  /**
   * GET /api/processes/cache/:sessionId
   * Returns cache entries for a specific session
   */
  router.get('/cache/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const cache = bridge.getSessionCache(sessionId);

      res.json({
        success: true,
        sessionId,
        entries: cache,
      });
    } catch (error: any) {
      logger.error('Failed to get session cache', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve session cache',
      });
    }
  });

  return router;
}
