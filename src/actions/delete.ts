/**
 * Iris MCP Module: delete
 * Terminate and remove a session completely
 *
 * Similar to sleep but also cleans up the session data.
 * This is a more permanent operation than sleep.
 */

import type { IrisOrchestrator } from "../iris.js";
import type { SessionManager } from "../session/session-manager.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:delete");

export interface DeleteInput {
  /** Team to delete session for */
  toTeam: string;

  /** Team requesting the delete */
  fromTeam: string;
}

export interface DeleteOutput {
  /** Team that requested the delete */
  from: string;

  /** Team that was deleted */
  to: string;

  /** Whether a session existed */
  hadSession: boolean;

  /** The deleted session ID (if existed) */
  sessionId?: string;

  /** Whether a process was terminated */
  processTerminated: boolean;

  /** Success message */
  message: string;

  /** Timestamp of operation */
  timestamp: number;
}

export async function deleteSession(
  input: DeleteInput,
  iris: IrisOrchestrator,
  sessionManager: SessionManager,
  processPool: ClaudeProcessPool,
): Promise<DeleteOutput> {
  const { fromTeam, toTeam } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateTeamName(fromTeam);

  logger.info(
    { fromTeam, toTeam },
    "Deleting session for team pair",
  );

  // Check if session exists
  const existingSession = sessionManager.getSession(fromTeam, toTeam);

  let hadSession = false;
  let sessionId: string | undefined;
  let processTerminated = false;

  if (existingSession) {
    hadSession = true;
    sessionId = existingSession.sessionId;

    logger.info(
      { fromTeam, toTeam, sessionId },
      "Found existing session - will terminate and delete",
    );

    // Step 1: Terminate existing process if running
    const existingProcess = processPool.getProcessBySessionId(sessionId);

    if (existingProcess) {
      logger.info(
        { fromTeam, toTeam, sessionId },
        "Terminating existing process",
      );

      try {
        await existingProcess.terminate();
        processTerminated = true;

        logger.info(
          { fromTeam, toTeam, sessionId },
          "Process terminated successfully",
        );
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            fromTeam,
            toTeam,
            sessionId,
          },
          "Failed to terminate process - continuing with session cleanup",
        );
      }
    }

    // Step 2: Clear message cache
    const messageCache = iris.getMessageCache(sessionId);
    if (messageCache) {
      logger.debug(
        { fromTeam, toTeam, sessionId },
        "Message cache found - will be orphaned when session deleted",
      );
    }

    // Step 3: Delete session (including filesystem)
    try {
      await sessionManager.deleteSession(sessionId, true);

      logger.info(
        { fromTeam, toTeam, sessionId },
        "Session deleted successfully",
      );
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          fromTeam,
          toTeam,
          sessionId,
        },
        "Failed to delete session",
      );
      throw error;
    }
  } else {
    logger.info(
      { fromTeam, toTeam },
      "No session found - nothing to delete",
    );
  }

  return {
    from: fromTeam,
    to: toTeam,
    hadSession,
    sessionId,
    processTerminated,
    message: hadSession
      ? `Session ${sessionId} deleted successfully`
      : `No session found for ${fromTeam}->${toTeam}`,
    timestamp: Date.now(),
  };
}
