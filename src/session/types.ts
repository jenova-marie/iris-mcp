/**
 * Session Management Types
 *
 * Defines types for team-to-team session management, tracking persistent
 * Claude Code conversations between team pairs.
 */

/**
 * Session status lifecycle
 */
export type SessionStatus =
  | "active" // Currently in use
  | "idle" // No active process
  | "compact_pending" // Needs compaction
  | "compacting" // Currently being compacted
  | "archived" // Historical reference only
  | "error" // Failed state
  | "migrating"; // Being moved/upgraded

/**
 * Process state (managed by Iris)
 */
export type ProcessState =
  | "stopped" // No process running
  | "spawning" // Process starting
  | "idle" // Process ready, not processing
  | "processing" // Processing a tell
  | "terminating"; // Shutting down

/**
 * Complete session information including metadata
 */
export interface SessionInfo {
  /** Database row ID */
  id: number;

  /** Source team */
  fromTeam: string;

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

  /** Current process state */
  processState: ProcessState;

  /** ID of current CacheSession being processed */
  currentCacheSessionId: string | null;

  /** Timestamp of last response from Claude */
  lastResponseAt: number | null;
}

/**
 * Database row format (before conversion to SessionInfo)
 */
export interface SessionRow {
  id: number;
  from_team: string;
  to_team: string;
  session_id: string;
  created_at: number; // Unix timestamp (ms)
  last_used_at: number; // Unix timestamp (ms)
  message_count: number;
  status: SessionStatus;
  process_state: ProcessState;
  current_cache_session_id: string | null;
  last_response_at: number | null;
}

/**
 * Filters for querying sessions
 */
export interface SessionFilters {
  /** Filter by source team */
  fromTeam?: string;

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

/**
 * Session lifecycle hooks for automatic maintenance
 */
export interface SessionLifecycle {
  /** Called when a session is created */
  onCreate?: (session: SessionInfo) => Promise<void>;

  /** Called when a message is sent through the session */
  onMessage?: (session: SessionInfo, message: any) => Promise<void>;

  /** Called when a session is compacted */
  onCompact?: (session: SessionInfo) => Promise<void>;

  /** Called when a session is archived */
  onArchive?: (session: SessionInfo) => Promise<void>;

  /** Called when a session encounters an error */
  onError?: (session: SessionInfo, error: Error) => Promise<void>;
}

/**
 * Session performance metrics
 */
export interface SessionMetrics {
  /** Session identifier */
  sessionId: string;

  /** Last N response times in milliseconds */
  responseTime: number[];

  /** Estimated token usage */
  tokenUsage: number;

  /** Errors per message ratio */
  errorRate: number;

  /** Last health check timestamp */
  lastHealthCheck: Date;

  /** Average response time */
  avgResponseTime?: number;

  /** P95 response time */
  p95ResponseTime?: number;
}

/**
 * Strategy for session pooling and management
 */
export interface SessionPoolStrategy {
  /** Generate a pool key for session lookup */
  getPoolKey(fromTeam: string, toTeam: string): string;

  /** Determine if a session can be reused */
  canReuseSession(session: SessionInfo): boolean;

  /** Check if session needs maintenance */
  needsMaintenance(session: SessionInfo): boolean;

  /** Determine if a session should be compacted */
  shouldCompact(session: SessionInfo): boolean;

  /** Determine if a session is stale */
  isStale(session: SessionInfo): boolean;
}
