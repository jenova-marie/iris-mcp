/**
 * Iris MCP Tool: teams_ask
 * Ask a team a question and wait for synchronous response
 */

import type { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import { validateTeamName, validateMessage, validateTimeout } from '../utils/validation.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('tool:teams_ask');

export interface TeamsAskInput {
  team: string;
  question: string;
  fromTeam?: string;
  timeout?: number;
}

export interface TeamsAskOutput {
  team: string;
  question: string;
  response: string;
  duration: number;
  timestamp: number;
}

export async function teamsAsk(
  input: TeamsAskInput,
  processPool: ClaudeProcessPool,
): Promise<TeamsAskOutput> {
  const { team, question, fromTeam, timeout = 30000 } = input;

  // Validate inputs
  validateTeamName(team);
  validateMessage(question);
  validateTimeout(timeout);

  if (fromTeam) {
    validateTeamName(fromTeam);
  }

  logger.info("Asking team", {
    fromTeam,
    team,
    question: question.substring(0, 50) + "...",
  });

  const startTime = Date.now();

  try {
    // Send message to team and wait for response
    const response = await processPool.sendMessage(
      team,
      question,
      timeout,
      fromTeam || null,
    );

    const duration = Date.now() - startTime;

    logger.info("Received response from team", { team, duration });

    return {
      team,
      question,
      response,
      duration,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error("Failed to get response from team", error);
    throw error;
  }
}
