/**
 * Iris MCP Module: wake
 * Wake up a team by ensuring its process is active in the pool
 */

import type { IrisOrchestrator } from "../iris.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";

const logger = getChildLogger("action:wake");

export interface WakeInput {
  /** Team to wake up */
  team: string;

  /** Team requesting the wake */
  fromTeam: string;
}

export interface WakeOutput {
  /** Team that was checked/woken */
  team: string;

  /** Status of the wake operation */
  status: "awake" | "waking";

  /** Session ID used */
  sessionId?: string;

  /** Message if waking */
  message?: string;

  /** Duration of wake operation in milliseconds */
  duration: number;

  /** Timestamp of operation */
  timestamp: number;
}

export async function wake(
  input: WakeInput,
  iris: IrisOrchestrator,
  processPool: ClaudeProcessPool,
  sessionManager: SessionManager,
): Promise<WakeOutput> {
  const { team, fromTeam } = input;

  // Validate team names
  validateTeamName(team);
  validateTeamName(fromTeam);

  logger.info({ team, fromTeam }, "Checking team status for wake");

  const startTime = Date.now();

  try {
    // Check if team exists in configuration
    const config = processPool.getConfig();
    if (!config.teams[team]) {
      throw new ConfigurationError(`Unknown team: ${team}`);
    }

    // Check if team already has an active process
    const existingProcess = processPool.getProcess(team);

    if (existingProcess) {
      // Team is already awake
      const metrics = existingProcess.getBasicMetrics();
      const duration = Date.now() - startTime;

      logger.info(
        {
          team,
          pid: metrics.pid,
          status: metrics.status,
        },
        "Team already awake",
      );

      return {
        team,
        status: "awake",
        sessionId: metrics.sessionId,
        duration,
        timestamp: Date.now(),
      };
    }

    // Team is asleep, need to wake it up
    logger.info({ team, fromTeam }, "Waking up team");

    try {
      // Get or create session for fromTeam -> team
      const session = await sessionManager.getOrCreateSession(fromTeam, team);

      // Create process in pool (this will spawn it with session-specific pool key)
      const process = await processPool.getOrCreateProcess(
        team,
        session.sessionId,
        fromTeam,
      );
      const metrics = process.getBasicMetrics();

      // Update session with debug info (if available from transport)
      const launchCommand = process.getLaunchCommand?.();
      const teamConfigSnapshot = process.getTeamConfigSnapshot?.();

      if (launchCommand && teamConfigSnapshot) {
        sessionManager.updateDebugInfo(
          session.sessionId,
          launchCommand,
          teamConfigSnapshot,
        );
        logger.info({
          sessionId: session.sessionId,
          commandLength: launchCommand.length,
          configLength: teamConfigSnapshot.length,
        }, "PLACEHOLDER");
      } else {
        logger.warn({
          sessionId: session.sessionId,
          hasLaunchCommand: !!launchCommand,
          hasTeamConfig: !!teamConfigSnapshot,
        }, "PLACEHOLDER");
      }

      // Update session state to idle after spawn completes
      // This ensures the session is ready to accept messages
      sessionManager.updateProcessState(session.sessionId, "idle");

      const duration = Date.now() - startTime;

      logger.info(
        {
          team,
          pid: metrics.pid,
          sessionId: session.sessionId,
          duration,
        },
        "Team woken up successfully",
      );

      return {
        team,
        status: "waking",
        sessionId: session.sessionId,
        message: `Team ${team} is waking up and will be ready shortly`,
        duration,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          team,
        },
        "Failed to wake team",
      );

      // Return waking status with error message
      const duration = Date.now() - startTime;
      return {
        team,
        status: "waking",
        message: `Failed to wake team ${team}: ${error instanceof Error ? error.message : String(error)}`,
        duration,
        timestamp: Date.now(),
      };
    }
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        team,
      },
      "Wake operation failed",
    );
    throw error;
  }
}
