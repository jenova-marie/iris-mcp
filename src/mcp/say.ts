/**
 * Iris MCP Module: say
 * Core MCP functionality for sending messages to teams
 *
 * Modes:
 * 1. Synchronous (waitForResponse=true, persist=false): Send message and wait for response
 * 2. Asynchronous (waitForResponse=false, persist=false): Send message without waiting
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

const logger = new Logger("mcp:say");

export interface SayInput {
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
}

export interface SayOutput {
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
}

export async function say(
  input: SayInput,
  iris: IrisOrchestrator,
  // notificationQueue?: NotificationQueue,
): Promise<SayOutput> {
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

  logger.info("Sending request to team", {
    from: fromTeam,
    to: toTeam,
    waitForResponse,
    persist: false,
  });

  const startTime = Date.now();

  try {
    const response = await iris.sendMessage(fromTeam || null, toTeam, message, {
      timeout,
      waitForResponse,
    });

    const duration = Date.now() - startTime;

    if (waitForResponse) {
      // Mode 2: Synchronous request (wait for response)
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
    } else {
      // Mode 3: Asynchronous request (no wait)
      logger.info("Request queued (async)", { toTeam });

      return {
        from: fromTeam,
        to: toTeam,
        message,
        timestamp: Date.now(),
        async: true,
      };
    }
  } catch (error) {
    logger.error("Failed to send request to team", error);
    throw error;
  }
}
