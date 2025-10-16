/**
 * Iris MCP Module: compact
 * Compact a team's session to reduce context size
 *
 * Uses claude --print /compact to compress the session history
 * while preserving important context. This is useful when a session
 * has grown large and needs optimization.
 */

import type { IrisOrchestrator } from "../iris.js";
import type { SessionManager } from "../session/session-manager.js";
import type { TeamsConfigManager } from "../config/iris-config.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";
import { ClaudePrintExecutor } from "../utils/claude-print.js";
import { TeamNotFoundError } from "../utils/errors.js";

const logger = getChildLogger("action:compact");

export interface CompactInput {
  /** Team to compact session for */
  toTeam: string;

  /** Team requesting the compact */
  fromTeam: string;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Number of retry attempts (default: 2) */
  retries?: number;
}

export interface CompactOutput {
  /** Team that requested the compact */
  from: string;

  /** Team that was compacted */
  to: string;

  /** Session ID that was compacted */
  sessionId: string;

  /** Whether compact succeeded */
  success: boolean;

  /** Duration in milliseconds */
  duration: number;

  /** Exit code from claude process */
  exitCode: number;

  /** Any output from the compact command */
  output?: string;

  /** Success message */
  message: string;

  /** Timestamp of operation */
  timestamp: number;

  /** Number of retry attempts made */
  retryCount?: number;
}

export async function compact(
  input: CompactInput,
  iris: IrisOrchestrator,
  sessionManager: SessionManager,
  configManager: TeamsConfigManager,
): Promise<CompactOutput> {
  const { fromTeam, toTeam, timeout = 30000, retries = 2 } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateTeamName(fromTeam);

  logger.info(
    { fromTeam, toTeam, timeout, retries },
    "Compacting session for team pair",
  );

  // Check if session exists
  const session = sessionManager.getSession(fromTeam, toTeam);

  if (!session) {
    const errorMsg = `No session found for ${fromTeam}->${toTeam}. Create a session first by waking the team.`;
    logger.error({ fromTeam, toTeam }, errorMsg);
    throw new TeamNotFoundError(errorMsg);
  }

  const sessionId = session.sessionId;

  logger.info(
    { fromTeam, toTeam, sessionId },
    "Found session - executing compact command",
  );

  // Get team config
  const teamConfig = configManager.getIrisConfig(toTeam);

  if (!teamConfig) {
    throw new TeamNotFoundError(`Team configuration not found: ${toTeam}`);
  }

  // Create executor and run /compact command
  const executor = ClaudePrintExecutor.create(teamConfig, sessionId);

  try {
    const result = await executor.execute({
      command: "/compact",
      timeout,
      resume: true,
      retries,
    });

    logger.info(
      {
        fromTeam,
        toTeam,
        sessionId,
        exitCode: result.exitCode,
        duration: result.duration,
        success: result.success,
        retryCount: result.retryCount,
      },
      "Compact command completed",
    );

    return {
      from: fromTeam,
      to: toTeam,
      sessionId,
      success: result.success,
      duration: result.duration,
      exitCode: result.exitCode,
      output: result.stdout || result.stderr || undefined,
      message: result.success
        ? `Session compacted successfully for ${fromTeam}->${toTeam}`
        : `Compact failed with exit code ${result.exitCode}`,
      timestamp: Date.now(),
      retryCount: result.retryCount,
    };
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        fromTeam,
        toTeam,
        sessionId,
      },
      "Failed to compact session",
    );

    throw error;
  }
}
