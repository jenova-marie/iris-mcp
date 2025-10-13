/**
 * Iris MCP Module: tell
 * Core MCP functionality for sending messages to teams
 *
 * Modes:
 * 1. Synchronous (waitForResponse=true): Send message and wait for response (uses provided timeout)
 * 2. Asynchronous (waitForResponse=false): Send message without waiting (uses timeout=-1)
 */

import type { IrisOrchestrator } from "../iris.js";
import {
  validateTeamName,
  validateMessage,
  validateTimeout,
} from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:tell");

export interface TellInput {
  /** Team to send message to */
  toTeam: string;

  /** Message content */
  message: string;

  /** Team sending the message */
  fromTeam: string;

  /** Wait for response (default: true). Ignored if persist=true */
  waitForResponse?: boolean;

  /** Timeout in milliseconds (default: 30000). Only used when waitForResponse=true */
  timeout?: number;

  /** Use persistent queue for fire-and-forget (default: false) */
  persist?: boolean;

  /** TTL in days for persistent notifications (default: 30). Only used when persist=true */
  ttlDays?: number;
}

export interface TellOutput {
  /** Team that sent the message */
  from?: string;

  /** Team that received the message */
  to: string;

  /** Message content */
  message: string;

  /** Response from team (only when waitForResponse=true and persist=false) */
  response?: string;

  /** Duration in milliseconds (only when waitForResponse=true) */
  duration?: number;

  /** Timestamp of request */
  timestamp: number;

  /** Whether this was an async request */
  async: boolean;

  /** Notification ID (only when persist=true) */
  notificationId?: string;

  /** Expiration timestamp (only when persist=true) */
  expiresAt?: number;

  /** Task ID (only when async=true and using AsyncQueue) */
  taskId?: string;
}

export async function tell(
  input: TellInput,
  iris: IrisOrchestrator,
): Promise<TellOutput> {
  const {
    fromTeam,
    toTeam,
    message,
    waitForResponse = true,
    timeout = 30000,
    persist = false,
    ttlDays = 30,
  } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateTeamName(fromTeam);
  validateMessage(message);

  // Determine timeout value based on waitForResponse
  // waitForResponse=false → timeout=-1 (async mode)
  // waitForResponse=true → use provided timeout
  const actualTimeout = waitForResponse ? timeout : -1;

  if (waitForResponse) {
    validateTimeout(timeout);
  }

  const startTime = Date.now();

  logger.info({
    from: fromTeam,
    to: toTeam,
    async: !waitForResponse,
    timeout: actualTimeout,
    messageLength: message.length,
    messagePreview: message.substring(0, 50),
  }, "Sending message to team");

  try {
    const result = await iris.sendMessage(fromTeam, toTeam, message, {
      timeout: actualTimeout,
    });

    const duration = Date.now() - startTime;

    // Handle async response (result is an object)
    if (typeof result === "object" && result !== null) {
      const resultObj = result as any;

      // Async mode response
      if (resultObj.status === "async") {
        logger.info({
          toTeam,
          sessionId: resultObj.sessionId,
        }, "Message sent in async mode");

        return {
          from: fromTeam,
          to: toTeam,
          message,
          timestamp: Date.now(),
          async: true,
        };
      }

      // Busy or other status
      logger.warn({
        toTeam,
        status: resultObj.status,
        result: JSON.stringify(result),
      }, "Received non-string response");

      return {
        from: fromTeam,
        to: toTeam,
        message,
        response: resultObj.message || JSON.stringify(result),
        duration,
        timestamp: Date.now(),
        async: false,
      };
    }

    // Handle string response (successful completion)
    const response = result as string;

    logger.info({
      toTeam,
      duration,
      responseLength: response?.length || 0,
      responsePreview: response?.substring(0, 100),
      isEmpty: !response || response.length === 0,
    }, "Received response from team");

    if (!response || response.length === 0) {
      logger.warn({
        toTeam,
        fromTeam,
        message,
        duration,
        responseValue: JSON.stringify(response),
      }, "EMPTY RESPONSE DETECTED");
    }

    return {
      from: fromTeam,
      to: toTeam,
      message,
      response,
      duration,
      timestamp: Date.now(),
      async: false,
    };
  } catch (error) {
    logger.error({
      err: error instanceof Error ? error : new Error(String(error)),
      toTeam,
      fromTeam,
    }, "Failed to send message to team");
    throw error;
  }
}
