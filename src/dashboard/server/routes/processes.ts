/**
 * Iris MCP Dashboard - Processes API Routes
 * Session-based process monitoring (fromTeam->toTeam)
 */

import { Router } from "express";
import type { DashboardStateBridge } from "../state-bridge.js";
import { getChildLogger } from "../../../utils/logger.js";

const logger = getChildLogger("dashboard:routes:processes");
const router = Router();

export function createProcessesRouter(bridge: DashboardStateBridge): Router {
  /**
   * GET /api/processes
   * Returns all active sessions (fromTeam->toTeam pairs)
   */
  router.get("/", (req, res) => {
    try {
      const sessions = bridge.getActiveSessions();
      const poolStatus = bridge.getPoolStatus();

      res.json({
        success: true,
        sessions,
        poolStatus,
      });
    } catch (error: any) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to get sessions",
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve sessions",
      });
    }
  });

  /**
   * GET /api/processes/:fromTeam/:toTeam
   * Returns detailed metrics for a specific session
   */
  router.get("/:fromTeam/:toTeam", (req, res) => {
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
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to get session metrics",
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve session metrics",
      });
    }
  });

  /**
   * GET /api/processes/report/:fromTeam/:toTeam
   * Returns cache report for a team pair
   */
  router.get("/report/:fromTeam/:toTeam", async (req, res) => {
    try {
      const { fromTeam, toTeam } = req.params;
      const report = await bridge.getSessionReport(fromTeam, toTeam);

      res.json(report);
    } catch (error: any) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to get session report",
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve session report",
      });
    }
  });

  /**
   * POST /api/processes/sleep/:fromTeam/:toTeam
   * Put a team session to sleep (terminate the process)
   */
  router.post("/sleep/:fromTeam/:toTeam", async (req, res) => {
    try {
      const { fromTeam, toTeam } = req.params;
      const { force = false } = req.body;

      logger.info({ fromTeam, toTeam, force }, "Putting session to sleep");

      const result = await bridge.sleepSession(fromTeam, toTeam, force);

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to put session to sleep",
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to put session to sleep",
      });
    }
  });

  /**
   * POST /api/processes/reboot/:fromTeam/:toTeam
   * Reboot a session (terminate process, delete old session, create new one)
   */
  router.post("/reboot/:fromTeam/:toTeam", async (req, res) => {
    try {
      const { fromTeam, toTeam } = req.params;

      logger.info({ fromTeam, toTeam }, "Rebooting session");

      const result = await bridge.rebootSession(fromTeam, toTeam);

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to clear session",
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to clear session",
      });
    }
  });

  /**
   * POST /api/processes/delete/:fromTeam/:toTeam
   * Delete a session permanently (terminate and remove)
   */
  router.post("/delete/:fromTeam/:toTeam", async (req, res) => {
    try {
      const { fromTeam, toTeam } = req.params;

      logger.info({ fromTeam, toTeam }, "Deleting session");

      const result = await bridge.deleteSession(fromTeam, toTeam);

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to delete session",
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to delete session",
      });
    }
  });

  /**
   * POST /api/processes/terminal/launch
   * Launches a terminal in the team's folder with --resume
   * Uses the team_fork MCP action for consistency with MCP server
   *
   * This endpoint now delegates to the fork MCP action instead of
   * directly executing the fork script. This ensures:
   * - Consistent behavior between Dashboard and MCP clients
   * - Centralized business logic in MCP actions
   * - Easier testing and maintenance
   */
  router.post("/terminal/launch", async (req, res) => {
    try {
      const { sessionId, toTeam, fromTeam = "dashboard" } = req.body;

      if (!toTeam) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: toTeam",
        });
      }

      logger.info(
        { toTeam, fromTeam, sessionId },
        "Dashboard requesting terminal fork via MCP action",
      );

      try {
        // Use the fork MCP action (same logic as MCP clients)
        const result = await bridge.forkSession(fromTeam, toTeam);

        logger.info(
          { toTeam, fromTeam, result },
          "Terminal fork launched successfully via MCP action",
        );

        return res.json({
          success: true,
          message: result.message,
          sessionId: result.sessionId,
          remote: result.remote,
        });
      } catch (forkError: any) {
        logger.error(
          {
            err:
              forkError instanceof Error
                ? forkError
                : new Error(String(forkError)),
            toTeam,
            fromTeam,
          },
          "Failed to fork session via MCP action",
        );

        return res.status(500).json({
          success: false,
          error: forkError.message || "Failed to launch terminal fork",
        });
      }
    } catch (error: any) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to launch terminal",
      );

      res.status(500).json({
        success: false,
        error: error.message || "Failed to launch terminal",
      });
    }
  });

  return router;
}
