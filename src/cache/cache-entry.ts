/**
 * Cache Entry - Individual tell or spawn with message accumulation
 */

import { Subject, Observable } from "rxjs";
import {
  CacheEntry,
  CacheMessage,
  CacheEntryType,
  CacheEntryStatus,
  TerminationReason,
} from "./types.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("cache-entry");

/**
 * Implementation of CacheEntry
 * Represents a single spawn or tell with accumulated protocol messages
 */
export class CacheEntryImpl implements CacheEntry {
  public cacheEntryType: CacheEntryType;
  public tellString: string;
  public status: CacheEntryStatus = CacheEntryStatus.ACTIVE;
  public messages: CacheMessage[] = [];
  public terminationReason?: TerminationReason;
  public createdAt: number;
  public completedAt: number | null = null;

  private messagesSubject = new Subject<CacheMessage>();
  public messages$: Observable<CacheMessage>;

  constructor(cacheEntryType: CacheEntryType, tellString: string) {
    this.cacheEntryType = cacheEntryType;
    this.tellString = tellString;
    this.createdAt = Date.now();
    this.messages$ = this.messagesSubject.asObservable();

    logger.debug("CacheEntry created", {
      cacheEntryType,
      tellStringLength: tellString.length,
      tellStringPreview: tellString.substring(0, 50),
    });
  }

  /**
   * Add message from Claude (called by ClaudeProcess)
   */
  addMessage(data: any): void {
    if (this.status !== CacheEntryStatus.ACTIVE) {
      logger.warn("Attempted to add message to non-active entry", {
        status: this.status,
        messageType: data.type,
      });
      return;
    }

    const message: CacheMessage = {
      timestamp: Date.now(),
      type: data.type || "unknown",
      data,
    };

    this.messages.push(message);
    this.messagesSubject.next(message);

    logger.debug("Message added to entry", {
      cacheEntryType: this.cacheEntryType,
      messageType: message.type,
      totalMessages: this.messages.length,
    });
  }

  /**
   * Get all messages (called by Iris)
   */
  getMessages(): CacheMessage[] {
    return [...this.messages]; // Return copy to prevent mutations
  }

  /**
   * Get latest message (called by Iris)
   */
  getLatestMessage(): CacheMessage | null {
    return this.messages[this.messages.length - 1] ?? null;
  }

  /**
   * Mark entry as completed (called by Iris)
   */
  complete(): void {
    if (this.status !== CacheEntryStatus.ACTIVE) {
      logger.warn("Attempted to complete non-active entry", {
        status: this.status,
        cacheEntryType: this.cacheEntryType,
      });
      return;
    }

    this.status = CacheEntryStatus.COMPLETED;
    this.completedAt = Date.now();
    this.messagesSubject.complete();

    logger.info("CacheEntry completed", {
      cacheEntryType: this.cacheEntryType,
      messageCount: this.messages.length,
      duration: this.completedAt - this.createdAt,
    });
  }

  /**
   * Mark entry as terminated (called by Iris)
   */
  terminate(reason: TerminationReason): void {
    if (
      this.status !== CacheEntryStatus.ACTIVE &&
      this.status !== CacheEntryStatus.COMPLETED
    ) {
      logger.warn("Attempted to terminate already terminated entry", {
        status: this.status,
        cacheEntryType: this.cacheEntryType,
      });
      return;
    }

    this.status = CacheEntryStatus.TERMINATED;
    this.terminationReason = reason;
    this.completedAt = Date.now();
    this.messagesSubject.complete();

    logger.warn("CacheEntry terminated", {
      cacheEntryType: this.cacheEntryType,
      reason,
      messageCount: this.messages.length,
      duration: this.completedAt - this.createdAt,
    });
  }
}
