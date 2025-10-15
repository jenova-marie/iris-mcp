/**
 * Iris MCP Module: cancel
 * Attempt to cancel a running operation by sending ESC to stdin
 *
 * EXPERIMENTAL: This may or may not work depending on whether
 * Claude's headless mode implements ESC interrupt handling
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
    "Attempting to cancel operation via ESC"
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
    // Send ESC character to stdin
    process.cancel();

    logger.info(
      { team, fromTeam, poolKey },
      "ESC sent to process - waiting to see if Claude responds"
    );

    return {
      team,
      fromTeam,
      attempted: true,
      processFound: true,
      message: `ESC sent to ${poolKey}. If Claude supports ESC in headless mode, the operation should cancel.`,
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
