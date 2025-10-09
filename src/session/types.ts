/**
 * Session Management Types
 *
 * Defines types for team-to-team session management, tracking persistent
 * Claude Code conversations between team pairs.
 */

/**
 * Session status lifecycle
 */
export type SessionStatus = "active" | "compact_pending" | "archived";

/**
 * Complete session information including metadata
 */
export interface SessionInfo {
  /** Database row ID */
  id: number;

  /** Source team (null for external/user-initiated requests) */
  fromTeam: string | null;

  /** Destination team */
  toTeam: string;

  /** UUID v4 identifying the Claude session */
  sessionId: string;

  /** When the session was created */
  createdAt: Date;

  /** Last time the session was used */
  lastUsedAt: Date;

  /** Number of messages exchanged in this session */
  messageCount: number;

  /** Current session status */
  status: SessionStatus;
}

/**
 * Database row format (before conversion to SessionInfo)
 */
export interface SessionRow {
  id: number;
  from_team: string | null;
  to_team: string;
  session_id: string;
  created_at: number; // Unix timestamp (ms)
  last_used_at: number; // Unix timestamp (ms)
  message_count: number;
  status: SessionStatus;
}

/**
 * Filters for querying sessions
 */
export interface SessionFilters {
  /** Filter by source team */
  fromTeam?: string | null;

  /** Filter by destination team */
  toTeam?: string;

  /** Filter by status */
  status?: SessionStatus;

  /** Filter sessions created after this date */
  createdAfter?: Date;

  /** Filter sessions used after this date */
  usedAfter?: Date;

  /** Maximum number of results */
  limit?: number;
}

/**
 * Options for session creation
 */
export interface CreateSessionOptions {
  /** If true, verify session file was created on filesystem */
  verify?: boolean;

  /** Timeout for session creation (ms) */
  timeout?: number;
}
