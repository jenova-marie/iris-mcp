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

  // // Mode 1: Persistent notification (fire-and-forget to queue) - DISABLED
  // if (persist) {
  //   if (!notificationQueue) {
  //     throw new Error(
  //       "NotificationQueue is required for persistent notifications",
  //     );
  //   }

  //   logger.info("Creating persistent notification", {
  //     from: fromTeam,
  //     to: toTeam,
  //     ttlDays,
  //   });

  //   try {
  //     const notification = notificationQueue.add(
  //       toTeam,
  //       message,
  //       fromTeam,
  //       ttlDays,
  //     );

  //     logger.info("Persistent notification created", {
  //       id: notification.id,
  //       toTeam,
  //     });

  //     return {
  //       from: fromTeam,
  //       to: toTeam,
  //       message,
  //       timestamp: notification.timestamp,
  //       async: true,
  //       notificationId: notification.id,
  //       expiresAt: notification.expiresAt,
  //     };
  //   } catch (error) {
  //     logger.error("Failed to create persistent notification", error);
  //     throw error;
  //   }
  // }

  // Mode 2 & 3: Live request via IrisOrchestrator
  if (waitForResponse) {
    validateTimeout(timeout);
  }

  // Mode 3: Asynchronous request (use AsyncQueue)
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

    // Clear cache if requested (before enqueueing)
    if (clearCache) {
      await iris.clearOutputCache(toTeam);
      logger.debug("Output cache cleared before async tell", { toTeam });
    }

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
  });

  const startTime = Date.now();

  try {
    // Clear cache if requested (before sending the message)
    if (clearCache) {
      await iris.clearOutputCache(toTeam);
      logger.debug("Output cache cleared before tell", { toTeam });
    }

    const response = await iris.sendMessage(fromTeam || null, toTeam, message, {
      timeout,
      waitForResponse: true,
    });

    const duration = Date.now() - startTime;

    logger.info("Received response from team", { toTeam, duration });

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
    logger.error("Failed to send request to team", error);
    throw error;
  }
}
