/**
 * Iris MCP Module: cancel
 * Attempt to cancel a running operation by sending 'cancel' to stdin
 *
 * EXPERIMENTAL: This may or may not work depending on whether
 * Claude's headless mode implements cancel command handling
 */

import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:cancel");

export interface CancelInput {
  /** Team whose operation to cancel */
  team: string;

  /** Team requesting the cancel */
  fromTeam: string;
}

export interface CancelOutput {
  /** Team that was targeted */
  team: string;

  /** Requesting team */
  fromTeam: string;

  /** Whether cancel was attempted */
  attempted: boolean;

  /** Whether a process was found */
  processFound: boolean;

  /** Message describing what happened */
  message: string;

  /** Timestamp of request */
  timestamp: number;
}

export async function cancel(
  input: CancelInput,
  pool: ClaudeProcessPool,
): Promise<CancelOutput> {
  const { team, fromTeam } = input;

  // Validate team names
  validateTeamName(team);
  validateTeamName(fromTeam);

  const poolKey = `${fromTeam}->${team}`;

  logger.info(
    { team, fromTeam, poolKey },
    "Attempting to cancel operation by sending 'cancel' message"
  );

  // Check if process exists (using poolKey format)
  const process = pool.getProcess(team);

  if (!process) {
    logger.warn({ team, fromTeam }, "No process found to cancel");

    return {
      team,
      fromTeam,
      attempted: false,
      processFound: false,
      message: `No active process found for ${poolKey}`,
      timestamp: Date.now(),
    };
  }

  try {
    // Use the cancel() method (which delegates to transport)
    logger.info(
      { team, fromTeam, poolKey },
      "Sending cancel signal via transport"
    );

    process.cancel();

    logger.info(
      { team, fromTeam, poolKey },
      "Cancel signal sent to transport - waiting to see if Claude responds"
    );

    return {
      team,
      fromTeam,
      attempted: true,
      processFound: true,
      message: `'cancel' sent to ${poolKey}. If Claude supports cancel commands in headless mode, the operation should cancel.`,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        team,
        fromTeam,
      },
      "Failed to send cancel signal"
    );

    return {
      team,
      fromTeam,
      attempted: false,
      processFound: true,
      message: `Failed to send cancel: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: Date.now(),
    };
  }
}
