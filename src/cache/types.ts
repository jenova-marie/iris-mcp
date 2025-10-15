/**
 * Cache Types - Defines the cache hierarchy for Iris
 *
 * Hierarchy:
 *   CacheManager
 *   └── MessageCache (one per sessionId - links to SessionInfo)
 *       └── CacheEntry (one per spawn/tell)
 *           └── CacheMessage[] (individual protocol messages)
 */

import { Observable } from "rxjs";

/**
 * Individual protocol message from Claude
 */
export interface CacheMessage {
  timestamp: number;
  type: "system" | "user" | "assistant" | "stream_event" | "result" | "unknown";
  data: any; // Raw protocol message from Claude
}

/**
 * Type of cache entry
 */
export enum CacheEntryType {
  SPAWN = "spawn", // Process initialization ping
  TELL = "tell", // Actual tell message
}

/**
 * Status of cache entry
 */
export enum CacheEntryStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  TERMINATED = "terminated",
}

/**
 * Reason for termination
 */
export enum TerminationReason {
  RESPONSE_TIMEOUT = "response_timeout",
  PROCESS_CRASHED = "process_crashed",
  MANUAL_TERMINATION = "manual_termination",
}

/**
 * Cache entry for a single tell (or spawn ping)
 */
export interface CacheEntry {
  cacheEntryType: CacheEntryType;
  tellString: string; // 'ping' for spawn, actual message for tell
  status: CacheEntryStatus;
  messages: CacheMessage[];
  terminationReason?: TerminationReason;
  createdAt: number;
  completedAt: number | null;

  // Write methods (for ClaudeProcess)
  addMessage(data: any): void;

  // Read methods (for Iris)
  getMessages(): CacheMessage[];
  getLatestMessage(): CacheMessage | null;

  // Observable for new messages
  messages$: Observable<CacheMessage>;

  // Observable for status changes
  status$: Observable<CacheEntryStatus>;

  // Lifecycle (called by Iris)
  complete(): void;
  terminate(reason: TerminationReason): void;
}
