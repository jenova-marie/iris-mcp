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

    logger.debug({
      cacheEntryType,
      debugId: this.__debugId,
      tellStringLength: tellString.length,
      tellStringPreview: tellString.substring(0, 50),
    }, "PLACEHOLDER");
  }

  /**
   * Add message from Claude (called by ClaudeProcess)
   */
  addMessage(data: any): void {
    logger.debug({
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageType: data.type,
      currentStatus: this.status,
      currentMessageCount: this.messages.length,
    }, "PLACEHOLDER");

    if (this.status !== CacheEntryStatus.ACTIVE) {
      logger.warn({
        status: this.status,
        messageType: data.type,
      }, "PLACEHOLDER");
      return;
    }

    const message: CacheMessage = {
      timestamp: Date.now(),
      type: data.type || "unknown",
      data,
    };

    this.messages.push(message);

    logger.debug({
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageType: message.type,
      totalMessages: this.messages.length,
      subjectClosed: (this.messagesSubject as any).closed || false,
    }, "PLACEHOLDER");

    this.messagesSubject.next(message);

    logger.debug({
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageType: message.type,
    }, "PLACEHOLDER");

    logger.debug({
      cacheEntryType: this.cacheEntryType,
      messageType: message.type,
      totalMessages: this.messages.length,
    }, "PLACEHOLDER");
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
    logger.debug({
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      currentStatus: this.status,
      messageCount: this.messages.length,
      subjectClosed: (this.messagesSubject as any).closed || false,
    }, "PLACEHOLDER");

    if (this.status !== CacheEntryStatus.ACTIVE) {
      logger.warn({
        status: this.status,
        cacheEntryType: this.cacheEntryType,
      }, "PLACEHOLDER");
      return;
    }

    this.status = CacheEntryStatus.COMPLETED;
    this.completedAt = Date.now();

    // Emit the new status
    this.statusSubject.next(CacheEntryStatus.COMPLETED);

    logger.debug({
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      messageCount: this.messages.length,
    }, "PLACEHOLDER");

    this.messagesSubject.complete();
    this.statusSubject.complete();

    logger.debug({
      cacheEntryType: this.cacheEntryType,
      debugId: this.__debugId,
      subjectClosed: (this.messagesSubject as any).closed || false,
    }, "PLACEHOLDER");

    logger.info({
      cacheEntryType: this.cacheEntryType,
      messageCount: this.messages.length,
      duration: this.completedAt - this.createdAt,
    }, "PLACEHOLDER");
  }

  /**
   * Mark entry as terminated (called by Iris)
   */
  terminate(reason: TerminationReason): void {
    if (
      this.status !== CacheEntryStatus.ACTIVE &&
      this.status !== CacheEntryStatus.COMPLETED
    ) {
      logger.warn({
        status: this.status,
        cacheEntryType: this.cacheEntryType,
      }, "PLACEHOLDER");
      return;
    }

    this.status = CacheEntryStatus.TERMINATED;
    this.terminationReason = reason;
    this.completedAt = Date.now();

    // Emit the new status
    this.statusSubject.next(CacheEntryStatus.TERMINATED);

    this.messagesSubject.complete();
    this.statusSubject.complete();

    logger.warn({
      cacheEntryType: this.cacheEntryType,
      reason,
      messageCount: this.messages.length,
      duration: this.completedAt - this.createdAt,
    }, "PLACEHOLDER");
  }
}
