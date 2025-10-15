/**
 * Iris MCP Module: clear
 * Create a fresh new session for a team pair
 *
 * Terminates existing process, deletes old session, and creates
 * a brand new session with a fresh UUID. This gives a clean slate
 * for starting over with no message history.
 */

import type { IrisOrchestrator } from "../iris.js";
import type { SessionManager } from "../session/session-manager.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:clear");

export interface ClearInput {
  /** Team to create fresh session for */
  toTeam: string;

  /** Team requesting the clear */
  fromTeam: string;
}

export interface ClearOutput {
  /** Team that requested the clear */
  from: string;

  /** Team that was cleared */
  to: string;

  /** Whether a session existed before */
  hadPreviousSession: boolean;

  /** The old session ID (if existed) */
  oldSessionId?: string;

  /** The new session ID */
  newSessionId: string;

  /** Whether a process was terminated */
  processTerminated: boolean;

  /** Success message */
  message: string;

  /** Timestamp of operation */
  timestamp: number;
}

export async function clear(
  input: ClearInput,
  iris: IrisOrchestrator,
  sessionManager: SessionManager,
  processPool: ClaudeProcessPool,
): Promise<ClearOutput> {
  const { fromTeam, toTeam } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateTeamName(fromTeam);

  logger.info(
    { fromTeam, toTeam },
    "Creating fresh new session for team pair",
  );

  // Check if session exists
  const existingSession = sessionManager.getSession(fromTeam, toTeam);

  let hadPreviousSession = false;
  let oldSessionId: string | undefined;
  let processTerminated = false;

  if (existingSession) {
    hadPreviousSession = true;
    oldSessionId = existingSession.sessionId;

    logger.info(
      { fromTeam, toTeam, oldSessionId },
      "Found existing session - will terminate and create new",
    );

    // Step 1: Terminate existing process if running
    const existingProcess = processPool.getProcessBySessionId(oldSessionId);

    if (existingProcess) {
      logger.info(
        { fromTeam, toTeam, oldSessionId },
        "Terminating existing process",
      );

      try {
        await existingProcess.terminate();
        processTerminated = true;

        logger.info(
          { fromTeam, toTeam, oldSessionId },
          "Process terminated successfully",
        );
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            fromTeam,
            toTeam,
            oldSessionId,
          },
          "Failed to terminate process - continuing with session cleanup",
        );
      }
    }

    // Step 2: Clear message cache
    const messageCache = iris.getMessageCache(oldSessionId);
    if (messageCache) {
      logger.debug(
        { fromTeam, toTeam, oldSessionId },
        "Message cache found - will be orphaned when session deleted",
      );
    }

    // Step 3: Delete old session (including filesystem)
    try {
      await sessionManager.deleteSession(oldSessionId, true);

      logger.info(
        { fromTeam, toTeam, oldSessionId },
        "Old session deleted successfully",
      );
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          fromTeam,
          toTeam,
          oldSessionId,
        },
        "Failed to delete old session",
      );
      throw error;
    }
  } else {
    logger.info(
      { fromTeam, toTeam },
      "No existing session found - creating first session",
    );
  }

  // Step 4: Create new session with fresh UUID
  const newSession = await sessionManager.createSession(fromTeam, toTeam);

  logger.info(
    {
      fromTeam,
      toTeam,
      newSessionId: newSession.sessionId,
      oldSessionId,
    },
    "Fresh new session created successfully",
  );

  return {
    from: fromTeam,
    to: toTeam,
    hadPreviousSession,
    oldSessionId,
    newSessionId: newSession.sessionId,
    processTerminated,
    message: hadPreviousSession
      ? `Fresh new session created. Old session ${oldSessionId} terminated and cleared. New session ID: ${newSession.sessionId}`
      : `First session created for ${fromTeam}->${toTeam}. Session ID: ${newSession.sessionId}`,
    timestamp: Date.now(),
  };
}
