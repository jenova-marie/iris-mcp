/**
 * Iris MCP - Claude Process Cache
 * Manages I/O caching for a single Claude process instance
 *
 * This module provides structured message storage with proper boundaries,
 * metadata tracking, and rich querying capabilities for reporting.
 */

import { Logger } from "../utils/logger.js";

/**
 * Represents a single message exchange with Claude
 */
export interface MessageExchange {
  id: string; // Unique identifier
  request: string; // What was sent to Claude
  response: string; // What Claude responded (accumulating)
  status: "pending" | "streaming" | "completed" | "error";
  startTime: Date;
  endTime?: Date;
  duration?: number; // Duration in milliseconds
  error?: string; // Error message if failed
  metadata?: {
    tokenCount?: number;
    cost?: number;
    model?: string;
  };
}

/**
 * Represents a protocol message from Claude's JSON stream
 */
export interface ProtocolMessage {
  timestamp: Date;
  type: string; // e.g., "system", "stream_event", "assistant"
  subtype?: string; // e.g., "init", "message_start"
  raw: string; // Original JSON string
  parsed: any; // Parsed JSON object
  messageId?: string; // Link to MessageExchange.id
}

/**
 * Summary report of cache contents
 */
export interface CacheReport {
  totalMessages: number;
  pendingMessages: number;
  completedMessages: number;
  errorMessages: number;
  averageDuration: number;
  oldestMessage?: Date;
  newestMessage?: Date;
  cacheSize: {
    messages: number;
    protocolMessages: number;
  };
}

/**
 * Configuration for the cache
 */
export interface CacheConfig {
  maxMessages?: number; // Max message exchanges to keep (default: 100)
  maxProtocolMessages?: number; // Max protocol messages to keep (default: 500)
  maxMessageAge?: number; // Max age in milliseconds (default: 1 hour)
  preserveErrors?: boolean; // Keep error messages longer (default: true)
}

/**
 * ClaudeCache manages structured message caching for a Claude process
 *
 * Features:
 * - Structured message storage with request/response pairs
 * - Circular buffer with configurable retention
 * - Rich querying and reporting capabilities
 * - Streaming message support
 */
export class ClaudeCache {
  private messages: MessageExchange[] = [];
  private protocolMessages: ProtocolMessage[] = [];
  private currentMessage: MessageExchange | null = null;
  private messageIdCounter = 0;
  private logger: Logger;
  private config: Required<CacheConfig>;

  constructor(teamName: string, config: CacheConfig = {}) {
    this.logger = new Logger(`cache:${teamName}`);
    this.config = {
      maxMessages: config.maxMessages ?? 100,
      maxProtocolMessages: config.maxProtocolMessages ?? 500,
      maxMessageAge: config.maxMessageAge ?? 3600000, // 1 hour
      preserveErrors: config.preserveErrors ?? true,
    };
  }

  /**
   * Start tracking a new message exchange
   */
  startMessage(request: string): string {
    const id = `msg-${++this.messageIdCounter}-${Date.now()}`;

    this.currentMessage = {
      id,
      request,
      response: "",
      status: "pending",
      startTime: new Date(),
    };

    this.messages.push(this.currentMessage);
    this.enforceMessageLimit();

    this.logger.debug("Started tracking message", {
      id,
      requestPreview: request.substring(0, 50),
    });
    return id;
  }

  /**
   * Update the current message as streaming
   */
  markMessageStreaming(): void {
    if (this.currentMessage && this.currentMessage.status === "pending") {
      this.currentMessage.status = "streaming";
    }
  }

  /**
   * Append text to the current message's response
   */
  appendToCurrentMessage(text: string): void {
    if (this.currentMessage) {
      this.currentMessage.response += text;
      if (this.currentMessage.status === "pending") {
        this.currentMessage.status = "streaming";
      }
    } else {
      this.logger.warn("No current message to append to");
    }
  }

  /**
   * Complete the current message exchange
   */
  completeCurrentMessage(finalResponse?: string): void {
    if (!this.currentMessage) {
      this.logger.warn("No current message to complete");
      return;
    }

    if (finalResponse !== undefined) {
      this.currentMessage.response = finalResponse;
    }

    this.currentMessage.status = "completed";
    this.currentMessage.endTime = new Date();
    this.currentMessage.duration =
      this.currentMessage.endTime.getTime() -
      this.currentMessage.startTime.getTime();

    this.logger.debug("Completed message", {
      id: this.currentMessage.id,
      duration: this.currentMessage.duration,
      responseLength: this.currentMessage.response.length,
    });

    this.currentMessage = null;
  }

  /**
   * Mark current message as errored
   */
  errorCurrentMessage(error: string): void {
    if (!this.currentMessage) {
      this.logger.warn("No current message to error");
      return;
    }

    this.currentMessage.status = "error";
    this.currentMessage.error = error;
    this.currentMessage.endTime = new Date();
    this.currentMessage.duration =
      this.currentMessage.endTime.getTime() -
      this.currentMessage.startTime.getTime();

    this.logger.debug("Message errored", {
      id: this.currentMessage.id,
      error,
    });

    this.currentMessage = null;
  }

  /**
   * Add a protocol message
   */
  addProtocolMessage(raw: string, messageId?: string): void {
    try {
      const parsed = JSON.parse(raw);

      this.protocolMessages.push({
        timestamp: new Date(),
        type: parsed.type,
        subtype: parsed.subtype,
        raw,
        parsed,
        messageId: messageId || this.currentMessage?.id,
      });

      this.enforceProtocolLimit();

      // Update current message metadata if we have useful info
      if (this.currentMessage && parsed.type === "result") {
        if (parsed.total_cost_usd) {
          this.currentMessage.metadata = this.currentMessage.metadata || {};
          this.currentMessage.metadata.cost = parsed.total_cost_usd;
        }
      }
    } catch (error) {
      this.logger.debug("Failed to parse protocol message", {
        raw: raw.substring(0, 100),
      });
    }
  }


  /**
   * Clear all caches
   */
  clear(): void {
    this.messages = [];
    this.protocolMessages = [];
    this.currentMessage = null;
    this.logger.debug("Cache cleared");
  }

  /**
   * Get recent messages
   */
  getRecentMessages(count: number = 10): MessageExchange[] {
    return this.messages.slice(-count);
  }

  /**
   * Get a specific message by ID
   */
  getMessage(id: string): MessageExchange | undefined {
    return this.messages.find((m) => m.id === id);
  }

  /**
   * Get messages since a timestamp
   */
  getMessagesSince(timestamp: Date): MessageExchange[] {
    return this.messages.filter((m) => m.startTime >= timestamp);
  }

  /**
   * Get pending messages (including streaming)
   */
  getPendingMessages(): MessageExchange[] {
    const pending = this.messages.filter(
      (m) => m.status === "pending" || m.status === "streaming",
    );
    if (this.currentMessage) {
      // Ensure current message is included
      if (!pending.find((m) => m.id === this.currentMessage!.id)) {
        pending.push(this.currentMessage);
      }
    }
    return pending;
  }

  /**
   * Get completed messages
   */
  getCompletedMessages(): MessageExchange[] {
    return this.messages.filter((m) => m.status === "completed");
  }

  /**
   * Get error messages
   */
  getErrorMessages(): MessageExchange[] {
    return this.messages.filter((m) => m.status === "error");
  }

  /**
   * Get the current streaming message
   */
  getCurrentMessage(): MessageExchange | null {
    return this.currentMessage;
  }

  /**
   * Get protocol messages for a specific message exchange
   */
  getProtocolMessages(messageId: string): ProtocolMessage[] {
    return this.protocolMessages.filter((p) => p.messageId === messageId);
  }

  /**
   * Get all protocol messages
   */
  getAllProtocolMessages(): ProtocolMessage[] {
    return [...this.protocolMessages];
  }

  /**
   * Get cache report
   */
  getReport(): CacheReport {
    const completedMessages = this.getCompletedMessages();
    const totalDuration = completedMessages.reduce(
      (sum, m) => sum + (m.duration || 0),
      0,
    );

    return {
      totalMessages: this.messages.length,
      pendingMessages: this.getPendingMessages().length,
      completedMessages: completedMessages.length,
      errorMessages: this.getErrorMessages().length,
      averageDuration:
        completedMessages.length > 0
          ? totalDuration / completedMessages.length
          : 0,
      oldestMessage:
        this.messages.length > 0 ? this.messages[0].startTime : undefined,
      newestMessage:
        this.messages.length > 0
          ? this.messages[this.messages.length - 1].startTime
          : undefined,
      cacheSize: {
        messages: this.messages.length,
        protocolMessages: this.protocolMessages.length,
      },
    };
  }

  /**
   * Export messages in various formats
   */
  exportMessages(format: "json" | "text" = "json"): string {
    if (format === "json") {
      return JSON.stringify(this.messages, null, 2);
    } else {
      return this.messages
        .map(
          (m) =>
            `[${m.startTime.toISOString()}] (${m.status}) ${m.duration ? m.duration + "ms" : "pending"}\n` +
            `Request: ${m.request.substring(0, 100)}${m.request.length > 100 ? "..." : ""}\n` +
            `Response: ${m.response.substring(0, 200)}${m.response.length > 200 ? "..." : ""}\n` +
            (m.error ? `Error: ${m.error}\n` : "") +
            "---",
        )
        .join("\n");
    }
  }


  /**
   * Enforce message count limit
   */
  private enforceMessageLimit(): void {
    if (this.messages.length <= this.config.maxMessages) {
      return;
    }

    // Remove old messages, but preserve errors if configured
    const toRemove = this.messages.length - this.config.maxMessages;
    const now = Date.now();

    let removed = 0;
    this.messages = this.messages.filter((m) => {
      // Keep if we haven't removed enough yet
      if (removed >= toRemove) return true;

      // Keep errors longer if configured
      if (this.config.preserveErrors && m.status === "error") return true;

      // Keep messages younger than maxMessageAge
      if (now - m.startTime.getTime() < this.config.maxMessageAge) return true;

      // Remove this message
      removed++;
      return false;
    });

    // If we still have too many, forcefully remove oldest non-error messages
    while (this.messages.length > this.config.maxMessages) {
      const indexToRemove = this.messages.findIndex(
        (m) => m.status !== "error",
      );
      if (indexToRemove === -1) break; // All remaining are errors
      this.messages.splice(indexToRemove, 1);
    }
  }

  /**
   * Enforce protocol message limit
   */
  private enforceProtocolLimit(): void {
    if (this.protocolMessages.length > this.config.maxProtocolMessages) {
      const toRemove =
        this.protocolMessages.length - this.config.maxProtocolMessages;
      this.protocolMessages.splice(0, toRemove);
    }
  }
}
