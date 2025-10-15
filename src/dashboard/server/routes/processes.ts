/**
 * Iris MCP Dashboard - Processes API Routes
 * Session-based process monitoring (fromTeam->toTeam)
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import type { DashboardStateBridge } from '../state-bridge.js';
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('dashboard:routes:processes');
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
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, 'Failed to get sessions');
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
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, 'Failed to get session metrics');
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve session metrics',
      });
    }
  });

  /**
   * GET /api/processes/report/:fromTeam/:toTeam
   * Returns cache report for a team pair
   */
  router.get('/report/:fromTeam/:toTeam', async (req, res) => {
    try {
      const { fromTeam, toTeam } = req.params;
      const report = await bridge.getSessionReport(fromTeam, toTeam);

      res.json(report);
    } catch (error: any) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, 'Failed to get session report');
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve session report',
      });
    }
  });

  /**
   * POST /api/processes/terminal/launch
   * Launches a terminal in the team's folder with --resume
   * Executes the user-configured terminal script (terminal.sh/bat/ps1)
   */
  router.post('/terminal/launch', (req, res) => {
    try {
      const { sessionId, toTeam } = req.body;

      if (!sessionId || !toTeam) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: sessionId and toTeam',
        });
      }

      // Check if terminal script is configured
      const terminalScriptPath = bridge.getTerminalScriptPath();

      if (!terminalScriptPath) {
        return res.status(404).json({
          success: false,
          error: 'Terminal script not found. Create terminal.sh (or terminal.bat/ps1 on Windows) in your IRIS_HOME directory.',
        });
      }

      // Get team path
      const teamPath = bridge.getTeamPath(toTeam);

      if (!teamPath) {
        return res.status(404).json({
          success: false,
          error: `Team not found: ${toTeam}`,
        });
      }

      logger.info(
        { sessionId, toTeam, teamPath, terminalScriptPath },
        'Launching terminal for session'
      );

      try {
        // Execute the terminal script with sessionId and teamPath arguments
        execSync(`"${terminalScriptPath}" "${sessionId}" "${teamPath}"`, {
          timeout: 5000,
          stdio: 'ignore' // Ignore output since terminal will be launched async
        });

        logger.info({ sessionId, toTeam }, 'Terminal launched successfully');

        return res.json({
          success: true,
          message: 'Terminal launched successfully',
        });
      } catch (execError: any) {
        logger.error({
          err: execError instanceof Error ? execError : new Error(String(execError)),
          sessionId,
          toTeam,
          terminalScriptPath
        }, 'Failed to execute terminal script');

        return res.status(500).json({
          success: false,
          error: 'Failed to launch terminal. Check terminal script execution.',
        });
      }
    } catch (error: any) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, 'Failed to launch terminal');

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to launch terminal',
      });
    }
  });

  return router;
}
