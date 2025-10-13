/**
 * Iris MCP Module: sleep
 * Put a team to sleep by removing its process from the pool
 */

import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";

const logger = getChildLogger("action:sleep");

export interface SleepInput {
  /** Team to put to sleep */
  team: string;

  /** Team requesting the sleep */
  fromTeam: string;

  /** Force termination even if process is busy */
  force?: boolean;
}

export interface SleepOutput {
  /** Team that was put to sleep */
  team: string;

  /** Status of the sleep operation */
  status: "asleep" | "already_asleep" | "sleeping";

  /** Process ID that was terminated (if applicable) */
  pid?: number | null;

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
  const { team, fromTeam, force = false } = input;

  // Validate team names
  validateTeamName(team);
  validateTeamName(fromTeam);

  logger.info({ team, fromTeam, force }, "Putting team to sleep");

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

      logger.info({ team }, "Team already asleep");

      return {
        team,
        status: "already_asleep",
        message: `Team ${team} is already asleep`,
        duration,
        timestamp: Date.now(),
      };
    }

    // Get process metrics before termination
    const metrics = existingProcess.getBasicMetrics();
    const pid = metrics.pid;
    const sessionId = metrics.sessionId;
    const pendingMessages = metrics.messageCount;

    logger.info({
      team,
      pid,
      sessionId,
      pendingMessages,
      force
    }, "Terminating team process");

    try {
      // Terminate the process
      await processPool.terminateProcess(team);

      const duration = Date.now() - startTime;

      logger.info({
        team,
        pid,
        duration
      }, "Team put to sleep successfully");

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
      logger.error({
        err: error instanceof Error ? error : new Error(String(error)),
        team
      }, "Failed to terminate team process");

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
    logger.error({
      err: error instanceof Error ? error : new Error(String(error)),
      team
    }, "Sleep operation failed");
    throw error;
  }
}