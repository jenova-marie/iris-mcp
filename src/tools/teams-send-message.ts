/**
 * Iris MCP Tool: teams_send_message
 * Send a message to a team with optional wait for response
 */

import type { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import { validateTeamName, validateMessage, validateTimeout } from '../utils/validation.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('tool:teams_send_message');

export interface TeamsSendMessageInput {
  fromTeam?: string;
  toTeam: string;
  message: string;
  waitForResponse?: boolean;
  timeout?: number;
}

export interface TeamsSendMessageOutput {
  from?: string;
  to: string;
  message: string;
  response?: string;
  duration?: number;
  timestamp: number;
  async: boolean;
}

export async function teamsSendMessage(
  input: TeamsSendMessageInput,
  processPool: ClaudeProcessPool
): Promise<TeamsSendMessageOutput> {
  const {
    fromTeam,
    toTeam,
    message,
    waitForResponse = true,
    timeout = 30000,
  } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateMessage(message);

  if (waitForResponse) {
    validateTimeout(timeout);
  }

  logger.info('Sending message to team', {
    from: fromTeam,
    to: toTeam,
    waitForResponse,
  });

  const startTime = Date.now();

  try {
    if (waitForResponse) {
      // Send and wait for response
      const response = await processPool.sendMessage(toTeam, message, timeout);
      const duration = Date.now() - startTime;

      logger.info('Received response from team', { toTeam, duration });

      return {
        from: fromTeam,
        to: toTeam,
        message,
        response,
        duration,
        timestamp: Date.now(),
        async: false,
      };
    } else {
      // Fire and forget (queue the message)
      processPool
        .sendMessage(toTeam, message, timeout)
        .catch((error) => {
          logger.error('Failed to send async message', error);
        });

      logger.info('Message queued (async)', { toTeam });

      return {
        from: fromTeam,
        to: toTeam,
        message,
        timestamp: Date.now(),
        async: true,
      };
    }
  } catch (error) {
    logger.error('Failed to send message to team', error);
    throw error;
  }
}
