/**
 * Iris MCP Module: wake
 * Wake up a team by ensuring its process is active in the pool
 */

import type { IrisOrchestrator } from "../iris.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { Logger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";

const logger = new Logger("mcp:wake");

export interface WakeInput {
  /** Team to wake up */
  team: string;

  /** Optional: Team requesting the wake */
  fromTeam?: string;

  /** Clear the output cache (default: true) */
  clearCache?: boolean;
}

export interface WakeOutput {
  /** Team that was checked/woken */
  team: string;

  /** Status of the wake operation */
  status: "awake" | "waking";

  /** Process ID if already awake */
  pid?: number;

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
  const { team, fromTeam, clearCache = true } = input;

  // Validate team name
  validateTeamName(team);
  if (fromTeam) {
    validateTeamName(fromTeam);
  }

  logger.info("Checking team status for wake", { team, fromTeam });

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
      const metrics = existingProcess.getMetrics();
      const duration = Date.now() - startTime;

      logger.info("Team already awake", {
        team,
        pid: metrics.pid,
        status: metrics.status,
        clearCache
      });

      // No cache to clear in bare-bones mode

      return {
        team,
        status: "awake",
        pid: metrics.pid,
        sessionId: metrics.sessionId,
        duration,
        timestamp: Date.now(),
      };
    }

    // Team is asleep, need to wake it up
    logger.info("Waking up team", { team, fromTeam });

    try {
      // Get or create session for fromTeam -> team (or external -> team if fromTeam not provided)
      const session = await sessionManager.getOrCreateSession(fromTeam ?? null, team);

      // Create process in pool (this will spawn it with session-specific pool key)
      const process = await processPool.getOrCreateProcess(team, session.sessionId, fromTeam ?? null);
      const metrics = process.getMetrics();

      // No cache to clear in bare-bones mode

      const duration = Date.now() - startTime;

      logger.info("Team woken up successfully", {
        team,
        pid: metrics.pid,
        sessionId: session.sessionId,
        duration,
        clearCache
      });

      return {
        team,
        status: "waking",
        pid: metrics.pid,
        sessionId: session.sessionId,
        message: `Team ${team} is waking up and will be ready shortly`,
        duration,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("Failed to wake team", { team, error });

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
    logger.error("Wake operation failed", { team, error });
    throw error;
  }
}