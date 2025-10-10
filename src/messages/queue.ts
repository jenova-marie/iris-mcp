/**
 * Iris MCP - Message Queue
 * FIFO queue organized per sender for each recipient team
 */

import { randomUUID } from "crypto";
import { Logger } from "../utils/logger.js";

const logger = new Logger("queue");

export interface QueuedMessage {
  id: string;
  fromTeam: string | null; // null for external/unspecified
  toTeam: string;
  subject: string;
  message: string;
  timestamp: number;
  expiresAt: number;
}

export class MessageQueue {
  // Queue structure: Map<toTeam, Map<fromTeam, QueuedMessage[]>>
  // For each recipient team, we have a map of senders to their FIFO queues
  private queues: Map<string, Map<string, QueuedMessage[]>> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private defaultTtlMs = 30 * 24 * 60 * 60 * 1000) {
    // 30 days default
    // Auto-purge expired messages every hour
    this.cleanupInterval = setInterval(
      () => {
        this.purgeExpired();
      },
      60 * 60 * 1000,
    );

    logger.info("Message queue initialized", { defaultTtlDays: 30 });
  }

  /**
   * Push message to queue (add to end - FIFO)
   */
  push(
    toTeam: string,
    subject: string,
    message: string,
    fromTeam: string | null = null,
    ttlMs?: number,
  ): QueuedMessage {
    const now = Date.now();
    const queued: QueuedMessage = {
      id: randomUUID(),
      fromTeam,
      toTeam,
      subject,
      message,
      timestamp: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    };

    // Ensure recipient queue exists
    if (!this.queues.has(toTeam)) {
      this.queues.set(toTeam, new Map());
    }

    const recipientQueues = this.queues.get(toTeam)!;

    // Use empty string as key for null fromTeam
    const senderKey = fromTeam ?? "";

    // Ensure sender queue exists
    if (!recipientQueues.has(senderKey)) {
      recipientQueues.set(senderKey, []);
    }

    // Add to end of queue (FIFO - first in, first out)
    recipientQueues.get(senderKey)!.push(queued);

    logger.info("Message pushed to queue", {
      id: queued.id,
      from: fromTeam,
      to: toTeam,
      subject,
      queueDepth: recipientQueues.get(senderKey)!.length,
    });

    return queued;
  }

  /**
   * Pop next message from queue (read from beginning - FIFO)
   * If fromTeam specified, only read from that sender
   * If fromTeam not specified, read from any sender (round-robin)
   */
  pop(
    toTeam: string,
    fromTeam: string | null = null,
  ): { message: QueuedMessage | null; remaining: number } {
    this.purgeExpired(); // Clean before reading

    const recipientQueues = this.queues.get(toTeam);

    if (!recipientQueues || recipientQueues.size === 0) {
      return { message: null, remaining: 0 };
    }

    const senderKey = fromTeam ?? "";

    if (fromTeam !== null) {
      // Read from specific sender
      const senderQueue = recipientQueues.get(senderKey);

      if (!senderQueue || senderQueue.length === 0) {
        return { message: null, remaining: 0 };
      }

      // Pop from beginning (FIFO)
      const message = senderQueue.shift()!;

      // Clean up empty sender queue
      if (senderQueue.length === 0) {
        recipientQueues.delete(senderKey);
      }

      // Clean up empty recipient queue
      if (recipientQueues.size === 0) {
        this.queues.delete(toTeam);
      }

      const remaining = this.count(toTeam);

      logger.info("Message popped from queue", {
        id: message.id,
        from: fromTeam,
        to: toTeam,
        subject: message.subject,
        remaining,
      });

      return { message, remaining };
    } else {
      // Read from any sender (round-robin - get first available)
      for (const [senderKey, senderQueue] of recipientQueues.entries()) {
        if (senderQueue.length > 0) {
          const message = senderQueue.shift()!;

          // Clean up empty sender queue
          if (senderQueue.length === 0) {
            recipientQueues.delete(senderKey);
          }

          // Clean up empty recipient queue
          if (recipientQueues.size === 0) {
            this.queues.delete(toTeam);
          }

          const remaining = this.count(toTeam);

          logger.info("Message popped from queue (any sender)", {
            id: message.id,
            from: message.fromTeam,
            to: toTeam,
            subject: message.subject,
            remaining,
          });

          return { message, remaining };
        }
      }

      return { message: null, remaining: 0 };
    }
  }

  /**
   * Get queue status - shows senders and message subjects for each recipient
   */
  status(
    toTeam?: string,
  ): Record<string, Record<string, { subject: string; timestamp: number }[]>> {
    this.purgeExpired();

    const result: Record<
      string,
      Record<string, { subject: string; timestamp: number }[]>
    > = {};

    const teamsToCheck = toTeam ? [toTeam] : Array.from(this.queues.keys());

    for (const team of teamsToCheck) {
      const recipientQueues = this.queues.get(team);
      if (!recipientQueues || recipientQueues.size === 0) {
        continue;
      }

      result[team] = {};

      for (const [senderKey, messages] of recipientQueues.entries()) {
        const sender = senderKey === "" ? "external" : senderKey;

        result[team][sender] = messages.map((msg) => ({
          subject: msg.subject,
          timestamp: msg.timestamp,
        }));
      }
    }

    return result;
  }

  /**
   * Count total messages for a team (all senders)
   */
  count(toTeam: string): number {
    this.purgeExpired();

    const recipientQueues = this.queues.get(toTeam);
    if (!recipientQueues) {
      return 0;
    }

    let total = 0;
    for (const senderQueue of recipientQueues.values()) {
      total += senderQueue.length;
    }

    return total;
  }

  /**
   * Get all pending messages (without removing) - for tests
   */
  getPending(toTeam: string, fromTeam?: string): QueuedMessage[] {
    this.purgeExpired();

    const recipientQueues = this.queues.get(toTeam);
    if (!recipientQueues) {
      return [];
    }

    if (fromTeam !== undefined) {
      const senderKey = fromTeam ?? "";
      return recipientQueues.get(senderKey) ?? [];
    }

    // Return all messages from all senders
    const all: QueuedMessage[] = [];
    for (const senderQueue of recipientQueues.values()) {
      all.push(...senderQueue);
    }
    return all;
  }

  /**
   * Purge expired messages from all queues
   */
  private purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (const [team, recipientQueues] of this.queues.entries()) {
      for (const [senderKey, messages] of recipientQueues.entries()) {
        const originalLength = messages.length;

        // Filter out expired messages
        const filtered = messages.filter((msg) => msg.expiresAt > now);

        if (filtered.length < originalLength) {
          purged += originalLength - filtered.length;

          if (filtered.length === 0) {
            recipientQueues.delete(senderKey);
          } else {
            recipientQueues.set(senderKey, filtered);
          }
        }
      }

      // Clean up empty recipient queues
      if (recipientQueues.size === 0) {
        this.queues.delete(team);
      }
    }

    if (purged > 0) {
      logger.info("Purged expired messages", { count: purged });
    }

    return purged;
  }

  /**
   * Clean up resources
   */
  close(): void {
    clearInterval(this.cleanupInterval);
    this.queues.clear();
  }
}
