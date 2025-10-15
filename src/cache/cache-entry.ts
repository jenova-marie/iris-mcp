/**
 * Cache Entry - Individual tell or spawn with message accumulation
 */

import { ReplaySubject, BehaviorSubject, Observable } from "rxjs";
import {
  CacheEntry,
  CacheMessage,
  CacheEntryType,
  CacheEntryStatus,
  TerminationReason,
} from "./types.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("cache:entry");

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

  // Use ReplaySubject to prevent race conditions where subscribers miss messages
  // that arrived before subscription (e.g., fast Claude responses)
  private messagesSubject = new ReplaySubject<CacheMessage>();
  public messages$: Observable<CacheMessage>;

  // Use BehaviorSubject for status so subscribers get current status immediately
  private statusSubject = new BehaviorSubject<CacheEntryStatus>(CacheEntryStatus.ACTIVE);
  public status$: Observable<CacheEntryStatus>;

  // Debug ID for tracking instance identity
  private static debugIdCounter = 0;
  public __debugId = ++CacheEntryImpl.debugIdCounter;

  constructor(cacheEntryType: CacheEntryType, tellString: string) {
    this.cacheEntryType = cacheEntryType;
    this.tellString = tellString;
    this.createdAt = Date.now();
    this.messages$ = this.messagesSubject.asObservable();
    this.status$ = this.statusSubject.asObservable();

    logger.debug("CacheEntry created", {
      cacheEntryType,
      debugId: this.__debugId,
      tellStringLength: tellString.length,
      tellStringPreview: tellString.substring(0, 50),
    });
  }

  /**
   * Add message from Claude (called by ClaudeProcess)
   */
  addMessage(data: any): void {
    logger.debug("addMessage called", {
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageType: data.type,
      currentStatus: this.status,
      currentMessageCount: this.messages.length,
    });

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

    logger.debug("About to emit message via ReplaySubject", {
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageType: message.type,
      totalMessages: this.messages.length,
      subjectClosed: (this.messagesSubject as any).closed || false,
    });

    this.messagesSubject.next(message);

    logger.debug("Message emitted via ReplaySubject", {
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageType: message.type,
    });

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
    logger.debug("complete() called", {
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      currentStatus: this.status,
      messageCount: this.messages.length,
      subjectClosed: (this.messagesSubject as any).closed || false,
    });

    if (this.status !== CacheEntryStatus.ACTIVE) {
      logger.warn("Attempted to complete non-active entry", {
        status: this.status,
        cacheEntryType: this.cacheEntryType,
      });
      return;
    }

    this.status = CacheEntryStatus.COMPLETED;
    this.completedAt = Date.now();

    // Emit the new status
    this.statusSubject.next(CacheEntryStatus.COMPLETED);

    logger.debug("About to complete ReplaySubject", {
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageCount: this.messages.length,
    });

    this.messagesSubject.complete();
    this.statusSubject.complete();

    logger.debug("ReplaySubject completed", {
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      subjectClosed: (this.messagesSubject as any).closed || false,
    });

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

    // Emit the new status
    this.statusSubject.next(CacheEntryStatus.TERMINATED);

    this.messagesSubject.complete();
    this.statusSubject.complete();

    logger.warn("CacheEntry terminated", {
      cacheEntryType: this.cacheEntryType,
      reason,
      messageCount: this.messages.length,
      duration: this.completedAt - this.createdAt,
    });
  }
}
