/**
 * Iris MCP Module: tell
 * Core MCP functionality for telling messages to teams
 *
 * Modes:
 * 1. Synchronous (waitForResponse=true, persist=false): Tell message and wait for response
 * 2. Asynchronous (waitForResponse=false, persist=false): Tell message without waiting
 * 3. Persistent (persist=true): Fire-and-forget to persistent queue
 */

import type { IrisOrchestrator } from "../iris.js";
// import type { NotificationQueue } from "../messages/queue.js";
import {
  validateTeamName,
  validateMessage,
  validateTimeout,
} from "../utils/validation.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("mcp:tell");

export interface TellInput {
  /** Team to send message to */
  toTeam: string;

  /** Message content */
  message: string;

  /** Team sending the message (optional) */
  fromTeam?: string;

  /** Wait for response (default: true). Ignored if persist=true */
  waitForResponse?: boolean;

  /** Timeout in milliseconds (default: 30000). Only used when waitForResponse=true */
  timeout?: number;

  /** Use persistent queue for fire-and-forget (default: false) */
  persist?: boolean;

  /** TTL in days for persistent notifications (default: 30). Only used when persist=true */
  ttlDays?: number;

  /** Clear the output cache before sending (default: true) */
  clearCache?: boolean;
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
  // notificationQueue?: NotificationQueue,
): Promise<TellOutput> {
  const {
    fromTeam,
    toTeam,
    message,
    waitForResponse = true,
    timeout = 30000,
    persist = false,
    ttlDays = 30,
    clearCache = true,
  } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateMessage(message);

  if (fromTeam) {
    validateTeamName(fromTeam);
  }

  // Live request via IrisOrchestrator
  if (waitForResponse) {
    validateTimeout(timeout);
  }

  // Asynchronous request (use AsyncQueue)
  if (!waitForResponse) {
    // Check if team is awake first
    if (!iris.isAwake(fromTeam || null, toTeam)) {
      logger.warn("Team is asleep, cannot enqueue async message", {
        fromTeam,
        toTeam,
      });

      return {
        from: fromTeam,
        to: toTeam,
        message,
        response: "Team is asleep. Use 'wake' action first.",
        timestamp: Date.now(),
        async: true,
      };
    }

    // No cache to clear in bare-bones mode

    // Enqueue to AsyncQueue for processing
    try {
      const taskId = iris.getAsyncQueue().enqueue({
        type: "tell",
        fromTeam: fromTeam || null,
        toTeam,
        content: message,
        timeout,
      });

      logger.info("Task enqueued to AsyncQueue", { taskId, toTeam });

      return {
        from: fromTeam,
        to: toTeam,
        message,
        timestamp: Date.now(),
        async: true,
        taskId, // Include taskId for tracking
      };
    } catch (error) {
      logger.error("Failed to enqueue async message", error);
      throw error;
    }
  }

  // Mode 2: Synchronous request (wait for response)
  logger.info("Sending synchronous request to team", {
    from: fromTeam,
    to: toTeam,
    clearCache,
    messageLength: message.length,
    messagePreview: message.substring(0, 50),
  });

  const startTime = Date.now();

  try {
    // No cache to clear in bare-bones mode

    logger.debug("Calling iris.sendMessage", {
      fromTeam: fromTeam || "null",
      toTeam,
      timeout,
      waitForResponse: true,
    });

    const response = await iris.sendMessage(fromTeam || null, toTeam, message, {
      timeout,
      waitForResponse: true,
    });

    const duration = Date.now() - startTime;

    logger.info("Received response from team", {
      toTeam,
      duration,
      responseLength: response?.length || 0,
      responseType: typeof response,
      responsePreview: response?.substring(0, 100),
      isEmpty: !response || response.length === 0,
    });

    if (!response || response.length === 0) {
      logger.warn("EMPTY RESPONSE DETECTED", {
        toTeam,
        fromTeam,
        message,
        duration,
        responseValue: JSON.stringify(response),
      });
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
    logger.error("Failed to send request to team", {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      toTeam,
      fromTeam,
    });
    throw error;
  }
}
