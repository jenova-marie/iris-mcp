/**
 * Iris MCP Module: sleep
 * Put a team to sleep by removing its process from the pool
 */

import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { Logger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";

const logger = new Logger("mcp:sleep");

export interface SleepInput {
  /** Team to put to sleep */
  team: string;

  /** Optional: Team requesting the sleep */
  fromTeam?: string;

  /** Force termination even if process is busy */
  force?: boolean;

  /** Clear the output cache before sleeping (default: true) */
  clearCache?: boolean;
}

export interface SleepOutput {
  /** Team that was put to sleep */
  team: string;

  /** Status of the sleep operation */
  status: "asleep" | "already_asleep" | "sleeping";

  /** Process ID that was terminated (if applicable) */
  pid?: number;

  /** Session ID that was terminated (if applicable) */
  sessionId?: string;

  /** Number of pending messages that were lost (if force=true) */
  lostMessages?: number;

  /** Message describing the operation */
  message?: string;

  /** Duration of sleep operation in milliseconds */
  duration: number;

  /** Timestamp of operation */
  timestamp: number;
}

export async function sleep(
  input: SleepInput,
  processPool: ClaudeProcessPool,
): Promise<SleepOutput> {
  const { team, fromTeam, force = false, clearCache = true } = input;

  // Validate team name
  validateTeamName(team);
  if (fromTeam) {
    validateTeamName(fromTeam);
  }

  logger.info("Putting team to sleep", { team, fromTeam, force });

  const startTime = Date.now();

  try {
    // Check if team exists in configuration
    const config = processPool.getConfig();
    if (!config.teams[team]) {
      throw new ConfigurationError(`Unknown team: ${team}`);
    }

    // Check if team has an active process
    const existingProcess = processPool.getProcess(team);

    if (!existingProcess) {
      // Team is already asleep
      const duration = Date.now() - startTime;

      logger.info("Team already asleep", { team });

      return {
        team,
        status: "already_asleep",
        message: `Team ${team} is already asleep`,
        duration,
        timestamp: Date.now(),
      };
    }

    // Get process metrics before termination
    const metrics = existingProcess.getMetrics();
    const pid = metrics.pid;
    const sessionId = metrics.sessionId;
    const pendingMessages = metrics.messageCount;

    logger.info("Terminating team process", {
      team,
      pid,
      sessionId,
      pendingMessages,
      force,
      clearCache
    });

    try {
      // Clear cache if requested (before terminating)
      if (clearCache) {
        processPool.clearOutputCache(team);
        logger.debug("Output cache cleared before sleep", { team });
      }

      // Terminate the process
      await processPool.terminateProcess(team);

      const duration = Date.now() - startTime;

      logger.info("Team put to sleep successfully", {
        team,
        pid,
        duration
      });

      const output: SleepOutput = {
        team,
        status: "sleeping",
        pid,
        sessionId,
        message: `Team ${team} has been put to sleep`,
        duration,
        timestamp: Date.now(),
      };

      // Add lost messages count if force was used and there were pending messages
      if (force && pendingMessages > 0) {
        output.lostMessages = pendingMessages;
        output.message = `Team ${team} was forcefully put to sleep (${pendingMessages} messages lost)`;
      }

      return output;
    } catch (error) {
      logger.error("Failed to terminate team process", { team, error });

      const duration = Date.now() - startTime;
      return {
        team,
        status: "sleeping",
        pid,
        sessionId,
        message: `Failed to put team ${team} to sleep: ${error instanceof Error ? error.message : String(error)}`,
        duration,
        timestamp: Date.now(),
      };
    }
  } catch (error) {
    logger.error("Sleep operation failed", { team, error });
    throw error;
  }
}