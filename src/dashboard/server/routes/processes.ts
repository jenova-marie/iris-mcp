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
   * Executes the user-configured fork script (fork.sh/bat/ps1)
   * For remote teams, passes SSH host and options to the script
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

      // Check if fork script is configured
      const forkScriptPath = bridge.getForkScriptPath();

      if (!forkScriptPath) {
        return res.status(404).json({
          success: false,
          error: 'Fork script not found. Create fork.sh (or fork.bat/ps1 on Windows) in your IRIS_HOME directory.',
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

      // Check if team is remote
      const remoteInfo = bridge.getTeamRemoteInfo(toTeam);

      let command: string;
      if (remoteInfo) {
        // Remote team: pass sessionId, teamPath, sshHost, sshOptions
        logger.info(
          { sessionId, toTeam, teamPath, forkScriptPath, remoteInfo },
          'Launching remote fork for session'
        );

        // Build command with SSH host and options
        command = `"${forkScriptPath}" "${sessionId}" "${teamPath}" "${remoteInfo.sshHost}"`;
        if (remoteInfo.sshOptions) {
          command += ` "${remoteInfo.sshOptions}"`;
        }
      } else {
        // Local team: pass sessionId, teamPath only
        logger.info(
          { sessionId, toTeam, teamPath, forkScriptPath },
          'Launching local fork for session'
        );

        command = `"${forkScriptPath}" "${sessionId}" "${teamPath}"`;
      }

      try {
        // Execute the fork script with appropriate arguments
        execSync(command, {
          timeout: 5000,
          stdio: 'ignore' // Ignore output since terminal will be launched async
        });

        logger.info({ sessionId, toTeam, remote: !!remoteInfo }, 'Terminal fork launched successfully');

        return res.json({
          success: true,
          message: 'Terminal fork launched successfully',
        });
      } catch (execError: any) {
        logger.error({
          err: execError instanceof Error ? execError : new Error(String(execError)),
          sessionId,
          toTeam,
          forkScriptPath,
          command
        }, 'Failed to execute fork script');

        return res.status(500).json({
          success: false,
          error: 'Failed to launch terminal fork. Check fork script execution.',
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
