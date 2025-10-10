# Session Management Architecture

**Last Updated**: 2025-10-10
**Current Phase**: Phase 1 (Post-Refactor)

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [SessionManager - Core Component](#sessionmanager---core-component)
4. [Session Lifecycle](#session-lifecycle)
5. [Database Layer (SessionStore)](#database-layer-sessionstore)
6. [Caching Strategy](#caching-strategy)
7. [Validation & Security](#validation--security)
8. [Integration with Process Pool](#integration-with-process-pool)
9. [Error Handling](#error-handling)
10. [Performance Characteristics](#performance-characteristics)
11. [Testing Strategy](#testing-strategy)
12. [Future Enhancements](#future-enhancements)

---

## Overview

Iris MCP implements **persistent team-to-team sessions** to maintain conversation continuity across all inter-team communications. Each unique pair of communicating teams shares a dedicated Claude Code session that persists across process restarts and pooling operations.

### The Problem This Solves

Without session management, every Claude process spawn creates a new conversation context, causing:

- **Context fragmentation**: Each interaction starts with no memory of previous exchanges
- **Directory pollution**: Projects accumulate dozens of orphaned session files
- **Lost continuity**: Teams cannot reference prior conversations
- **Defeats pooling benefits**: Process reuse doesn't preserve conversation state

### Core Design Principle

**Each unique `(fromTeam, toTeam)` pair has exactly one persistent session.**

This means:
- `frontend → backend` has its own session
- `backend → frontend` has a **different** session (directional)
- `mobile → backend` has yet another session
- `null → backend` represents external/user requests to backend
- Sessions are **directional** and **isolated**

### Why Team-to-Team Instead of Per-Team?

Different requesters need different context when talking to the same team:

```
frontend asking backend about API design  ≠  mobile asking backend about GraphQL schema
```

Team-to-team isolation prevents context pollution while maintaining relevant conversation threads.

---

## Architecture

### Three-Layer Design (Current)

After the Phase 1 refactor, Iris uses a clean three-layer architecture with strict separation of concerns:

```
┌─────────────────────────────────────────────┐
│        IrisOrchestrator (BLL)              │
│  Coordinates SessionManager + PoolManager   │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌──────────────┐  ┌─────────────────────┐
│SessionManager│  │ClaudeProcessPool    │
│              │  │                     │
│DB + Files    │  │Process Lifecycle    │
│              │  │                     │
│NO processes  │  │NO session lookup    │
└──────┬───────┘  └──────────┬──────────┘
       │                     │
       ▼                     ▼
┌──────────────┐  ┌─────────────────────┐
│SessionStore  │  │ClaudeProcess        │
│SQLite        │  │Static: init files   │
│              │  │Instance: resume     │
└──────────────┘  └─────────────────────┘
```

### Layer Responsibilities

**1. SessionManager** (`src/session/session-manager.ts`)
- **ONLY**: Database operations and session file validation
- **NOT**: Process spawning or lifecycle management
- Delegates file initialization to `ClaudeProcess.initializeSessionFile()`

**2. ClaudeProcessPool** (`src/process-pool/pool-manager.ts`)
- **ONLY**: Process lifecycle (spawn, pool, terminate)
- **NOT**: Session lookup or tracking
- Requires `sessionId` parameter (doesn't look it up)

**3. IrisOrchestrator** (`src/iris.ts`)
- **Business Logic Layer** coordinating SM + PM
- Implements the complete flow: get session → get process → send message → track usage
- Provides high-level API for MCP tools

### Key Architectural Decisions

✅ **Bidirectional independence**: SessionManager and PoolManager don't know about each other
✅ **Static initialization**: `ClaudeProcess.initializeSessionFile()` is static, callable without instance
✅ **Eager pre-initialization**: All team sessions created at startup, not on-demand
✅ **Caching layer**: SessionManager caches frequently accessed sessions
✅ **Validation layers**: Team names, paths, UUIDs all validated before use

---

## SessionManager - Core Component

### Overview

**Location**: `src/session/session-manager.ts`
**Purpose**: Manage the database representation and file validation of team-to-team sessions
**NOT responsible for**: Process spawning, message sending, or process lifecycle

### Constructor

```typescript
constructor(
  teamsConfig: TeamsConfig,
  dbPath?: string  // Default: "./data/team-sessions.db"
)
```

**What happens**:
1. Stores teams configuration reference
2. Creates `SessionStore` instance (SQLite wrapper)
3. Does **NOT** initialize - must call `initialize()` explicitly

### Core Principle

**SessionManager is database-only** - it validates session files exist and manages metadata, but never spawns processes.

---

## Initialization Flow

### `async initialize(): Promise<void>`

**CRITICAL**: This method MUST complete successfully before any MCP requests are processed.

#### Phase 1: Path Validation

```typescript
for (const [teamName, teamConfig] of Object.entries(this.teamsConfig.teams)) {
  validateTeamName(teamName);
  const projectPath = teamConfig.path;
  validateSecureProjectPath(projectPath);  // Security checks
}
```

**Validates**:
- Team names (no path traversal, special chars)
- Project paths exist on filesystem
- Paths are absolute
- Paths are within allowed directories
- No symlinks to restricted locations

**Throws**: `ConfigurationError` if any team is invalid

#### Phase 2: Eager Session Pre-Initialization

For **every configured team**, SessionManager creates a default `(null → teamName)` session:

```typescript
for (const [teamName, teamConfig] of Object.entries(this.teamsConfig.teams)) {
  const existing = this.store.getByTeamPair(null, teamName);

  if (existing) {
    // Verify session file exists
    const sessionFilePath = getSessionFilePath(projectPath, existing.sessionId);

    if (existsSync(sessionFilePath)) {
      logger.info("Session file valid, skipping");
      continue;
    }

    // File missing - CREATE NEW SESSION WITH NEW UUID
    // CRITICAL: Cannot reuse old UUID (it's "burned")
    const newSessionId = generateSecureUUID();

    await ClaudeProcess.initializeSessionFile(
      teamConfig,
      newSessionId,
      this.teamsConfig.settings.sessionInitTimeout
    );

    // Delete old DB entry, store new one
    this.store.delete(existing.sessionId);
    this.store.create(null, teamName, newSessionId);

  } else {
    // No session exists - create initial one
    const sessionId = generateSecureUUID();

    await ClaudeProcess.initializeSessionFile(
      teamConfig,
      sessionId,
      this.teamsConfig.settings.sessionInitTimeout
    );

    this.store.create(null, teamName, sessionId);
  }
}
```

**Why Eager Initialization?**:
- ✅ Eliminates "cold start" delay on first request
- ✅ Validates all team paths are accessible at startup
- ✅ Pre-creates session files for `--resume` to work
- ✅ Fails fast if any team configuration is broken

**What it delegates**:
- `ClaudeProcess.initializeSessionFile()` - Static method that spawns `claude --session-id <uuid>` to create the .jsonl file

**Important**: SessionManager **calls** the static method but doesn't contain the initialization logic.

#### Phase 3: Mark as Initialized

```typescript
this.initialized = true;
logger.info("Session manager initialized with all team sessions ready");
```

All subsequent methods check `this.ensureInitialized()` and throw if not ready.

---

## Session Lifecycle Methods

### Get or Create Session

```typescript
async getOrCreateSession(
  fromTeam: string | null,
  toTeam: string
): Promise<SessionInfo>
```

**Flow**:
1. **Validate**: Ensure `toTeam` and optional `fromTeam` exist in config
2. **Check database**: Call `this.store.getByTeamPair(fromTeam, toTeam)`
3. **If exists**: Return immediately
4. **If not**: Call `createSession()` to generate new one

**Returns**: `SessionInfo` with `sessionId`, metadata, timestamps

**Cache behavior**: Does NOT use cache (delegates to `getSession()` for cached reads)

### Create Session

```typescript
async createSession(
  fromTeam: string | null,
  toTeam: string,
  options?: CreateSessionOptions
): Promise<SessionInfo>
```

**Process**:

1. **Validate teams**:
   ```typescript
   validateTeamName(toTeam);
   if (fromTeam) validateTeamName(fromTeam);
   ```

2. **Generate secure UUID**:
   ```typescript
   const sessionId = generateSecureUUID();  // Crypto-random UUID v4
   ```

3. **Get timeout configuration**:
   ```typescript
   const sessionInitTimeout =
     teamConfig.sessionInitTimeout ??
     this.teamsConfig.settings.sessionInitTimeout;
   ```

4. **Initialize session file** (delegates to static method):
   ```typescript
   await ClaudeProcess.initializeSessionFile(
     teamConfig,
     sessionId,
     sessionInitTimeout
   );
   ```

   **What this does**:
   - Spawns `claude --session-id <uuid> --print ping` in team directory
   - Waits for ANY response (not specifically "pong")
   - Verifies file created at `~/.claude/projects/{escaped-path}/{uuid}.jsonl`
   - Cleans up timeout handlers properly
   - Kills the initialization process

5. **Store in database**:
   ```typescript
   const sessionInfo = this.store.create(fromTeam, toTeam, sessionId);
   ```

6. **Update cache**:
   ```typescript
   const cacheKey = this.getCacheKey(fromTeam, toTeam);
   this.sessionCache.set(cacheKey, sessionInfo);
   this.cacheTimestamps.set(cacheKey, Date.now());
   ```

7. **Return session info**

**Error handling**:
- Wraps errors in `ProcessError` with context
- Logs full error details
- Does NOT retry automatically (caller's responsibility)

### Get Session (Read-Only)

```typescript
getSession(
  fromTeam: string | null,
  toTeam: string
): SessionInfo | null
```

**Flow**:

1. **Check cache**:
   ```typescript
   const cacheKey = this.getCacheKey(fromTeam, toTeam);
   const cached = this.sessionCache.get(cacheKey);

   if (cached && this.isCacheValid(cacheKey)) {
     return cached;
   }
   ```

2. **Cache miss** - fetch from database:
   ```typescript
   const session = this.store.getByTeamPair(fromTeam, toTeam);
   ```

3. **Update cache if found**:
   ```typescript
   if (session) {
     this.sessionCache.set(cacheKey, session);
     this.cacheTimestamps.set(cacheKey, Date.now());
   }
   ```

4. **Return** session or `null`

**Cache TTL**: 60 seconds (configurable via `this.cacheMaxAge`)

### Get Session by ID

```typescript
getSessionById(sessionId: string): SessionInfo | null
```

**Simpler lookup**:
- Directly queries database by UUID
- Does **NOT** use cache (session ID lookups are less frequent)
- Returns `null` if not found

### List Sessions

```typescript
listSessions(filters?: SessionFilters): SessionInfo[]
```

**Filters available**:
```typescript
interface SessionFilters {
  fromTeam?: string | null;
  toTeam?: string;
  status?: SessionStatus;
  createdAfter?: Date;
  usedAfter?: Date;
  limit?: number;
}
```

**Examples**:
```typescript
// All sessions from frontend team
manager.listSessions({ fromTeam: "frontend" });

// All external→backend sessions
manager.listSessions({ fromTeam: null, toTeam: "backend" });

// Active sessions only
manager.listSessions({ status: "active" });

// Recent sessions (last 7 days)
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
manager.listSessions({ usedAfter: sevenDaysAgo });
```

**Returns**: Array of `SessionInfo` objects

---

## Metadata Tracking

### Record Usage

```typescript
recordUsage(sessionId: string): void
```

**Purpose**: Update `last_used_at` timestamp to track session activity

**What happens**:
1. Updates database: `this.store.updateLastUsed(sessionId)`
2. Invalidates cache for this session (forces fresh read next time)

**Called by**: `IrisOrchestrator` after every successful message

### Increment Message Count

```typescript
incrementMessageCount(sessionId: string, count = 1): void
```

**Purpose**: Track number of messages exchanged in session

**What happens**:
1. Updates database: `this.store.incrementMessageCount(sessionId, count)`
2. Invalidates cache for this session

**Used for**:
- Determining when session needs compaction (>500 messages)
- Analytics and monitoring
- Session health tracking

---

## Session Compaction

### Compact Session (Metadata Only)

```typescript
async compactSession(sessionId: string): Promise<void>
```

**IMPORTANT**: This method ONLY updates database metadata. To actually compact a running Claude process, the caller must use `PoolManager.sendCommandToSession(sessionId, "/compact")`.

**Process**:

1. **Validate session exists**:
   ```typescript
   const session = this.store.getBySessionId(sessionId);
   if (!session) {
     logger.warn("Attempted to compact non-existent session");
     return;
   }
   ```

2. **Mark as compacting**:
   ```typescript
   this.store.updateStatus(sessionId, "compacting");
   this.invalidateCache(session.fromTeam, session.toTeam);
   ```

3. **Reset message count and update status**:
   ```typescript
   this.store.resetMessageCount(sessionId);
   this.store.updateStatus(sessionId, "active");
   ```

4. **Handle errors**:
   ```typescript
   catch (error) {
     this.store.updateStatus(sessionId, "error");
     this.invalidateCache(session.fromTeam, session.toTeam);
     throw new ProcessError(...);
   }
   ```

### Should Compact Session?

```typescript
shouldCompactSession(session: SessionInfo): boolean
```

**Logic**:
```typescript
const HIGH_MESSAGE_THRESHOLD = 500;
const AGE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const age = Date.now() - session.createdAt.getTime();
return (
  session.messageCount > HIGH_MESSAGE_THRESHOLD ||
  (session.messageCount > 100 && age > AGE_THRESHOLD_MS)
);
```

**Triggers compaction when**:
- More than 500 messages **OR**
- More than 100 messages AND older than 7 days

---

## Session Deletion

```typescript
async deleteSession(
  sessionId: string,
  deleteFile = false
): Promise<void>
```

**Process**:

1. **Fetch session**:
   ```typescript
   const session = this.store.getBySessionId(sessionId);
   if (!session) {
     logger.warn("Attempted to delete non-existent session");
     return;
   }
   ```

2. **Delete from database**:
   ```typescript
   this.store.delete(sessionId);
   ```

3. **Optionally delete session file**:
   ```typescript
   if (deleteFile) {
     const filePath = getSessionFilePath(projectPath, sessionId);
     await fs.unlink(filePath);
   }
   ```

**Use cases**:
- `deleteFile=false`: Remove database entry but keep conversation history
- `deleteFile=true`: Complete cleanup including .jsonl file

---

## Database Layer (SessionStore)

### Overview

**Location**: `src/session/session-store.ts`
**Database**: SQLite with WAL mode
**Default path**: `./data/team-sessions.db`

### Schema

```sql
CREATE TABLE team_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_team TEXT,                    -- NULL for external requests
  to_team TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,  -- UUID v4
  created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  last_used_at INTEGER NOT NULL,     -- Unix timestamp (ms)
  message_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  UNIQUE(from_team, to_team)         -- One session per team pair
);

CREATE INDEX idx_team_sessions_from_to ON team_sessions(from_team, to_team);
CREATE INDEX idx_team_sessions_session_id ON team_sessions(session_id);
CREATE INDEX idx_team_sessions_status ON team_sessions(status);
```

### Session Status Values

```typescript
type SessionStatus =
  | "active"           // Currently in use
  | "idle"             // No active process
  | "compact_pending"  // Needs compaction
  | "compacting"       // Currently being compacted
  | "archived"         // Historical reference only
  | "error"            // Failed state
  | "migrating";       // Being moved/upgraded
```

### Key Operations

**Create**:
```typescript
create(fromTeam: string | null, toTeam: string, sessionId: string): SessionInfo
```

**Get by team pair**:
```typescript
getByTeamPair(fromTeam: string | null, toTeam: string): SessionInfo | null
```

**Get by session ID**:
```typescript
getBySessionId(sessionId: string): SessionInfo | null
```

**Update timestamps**:
```typescript
updateLastUsed(sessionId: string): void
```

**Update message count**:
```typescript
incrementMessageCount(sessionId: string, count: number): void
resetMessageCount(sessionId: string): void
```

**Update status**:
```typescript
updateStatus(sessionId: string, status: SessionStatus): void
```

**List with filters**:
```typescript
list(filters?: SessionFilters): SessionInfo[]
```

**Get statistics**:
```typescript
getStats(): {
  total: number;
  active: number;
  compactPending: number;
  archived: number;
  totalMessages: number;
}
```

---

## Caching Strategy

### Cache Structure

```typescript
private sessionCache = new Map<string, SessionInfo>();
private cacheTimestamps = new Map<string, number>();
private cacheMaxAge = 60000; // 1 minute TTL
```

### Cache Key Format

```typescript
private getCacheKey(fromTeam: string | null, toTeam: string): string {
  return `${fromTeam ?? "external"}->${toTeam}`;
}
```

**Examples**:
- `"frontend->backend"`
- `"external->backend"` (fromTeam = null)
- `"mobile->frontend"`

### Cache Validation

```typescript
private isCacheValid(key: string): boolean {
  const timestamp = this.cacheTimestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < this.cacheMaxAge;
}
```

**TTL**: 60 seconds (1 minute)

### Cache Invalidation

**Manual invalidation**:
```typescript
private invalidateCache(fromTeam: string | null, toTeam: string): void {
  const cacheKey = this.getCacheKey(fromTeam, toTeam);
  this.sessionCache.delete(cacheKey);
  this.cacheTimestamps.delete(cacheKey);
}
```

**Called when**:
- Session metadata updated (`recordUsage`, `incrementMessageCount`)
- Session status changed (`compactSession`, `updateStatus`)
- Session deleted

**Clear all cache**:
```typescript
clearCache(): void {
  this.sessionCache.clear();
  this.cacheTimestamps.clear();
}
```

**Called when**: Manager is closed or reset

### Cache Performance

**Cache hit path** (O(1)):
```typescript
getSession() → cache.get() → return immediately
```

**Cache miss path** (O(log n) with indexed DB):
```typescript
getSession() → cache.get() [miss] → DB query → cache.set() → return
```

**Expected hit rate**: >90% for active sessions (same team pairs repeatedly communicate)

---

## Validation & Security

### Team Name Validation

**Function**: `validateTeamName(name: string)`

**Checks**:
- Not empty
- Alphanumeric + hyphens only (`/^[a-zA-Z0-9-]+$/`)
- No path traversal attempts (`..`, `/`, `\`)
- No special characters that could break pooling keys

**Throws**: `ValidationError` with specific reason

### Project Path Validation

**Function**: `validateSecureProjectPath(path: string)`

**Security checks**:
1. **Path must be absolute**: Starts with `/` (Unix) or `C:\` (Windows)
2. **Path must exist**: `fs.existsSync(path)`
3. **Path must be readable**: `fs.accessSync(path, fs.constants.R_OK)`
4. **No path traversal**: Doesn't contain `..` or unusual characters
5. **Symlink warning**: Logs warning if path contains symlinks (allowed but noted)

**Logs warnings for**:
- Symlinks in path (potential security concern)
- Paths outside typical project directories

### UUID Validation

**Function**: `validateUUID(uuid: string)`

**Format**: RFC 4122 UUID v4 format

**Regex**: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`

**Example valid**: `"a1b2c3d4-5678-4abc-9def-1234567890ab"`

### Session ID Validation

**Function**: `validateSessionId(sessionId: string)`

**Checks**:
1. Valid UUID format (via `validateUUID`)
2. No path traversal characters
3. Alphanumeric + hyphens only

**Why separate from UUID validation**: Additional safety layer for file system operations

### UUID Generation

**Function**: `generateSecureUUID()`

**Implementation**:
```typescript
import { randomUUID } from "crypto";

export function generateSecureUUID(): string {
  return randomUUID();  // Node.js crypto-random UUID v4
}
```

**Properties**:
- Cryptographically random
- Collision probability: ~10^-36 for 1 billion UUIDs
- Safe for security-sensitive use cases

---

## Integration with Process Pool

### Flow: Session → Process

When `IrisOrchestrator` needs to send a message:

1. **Get session from SessionManager**:
   ```typescript
   const session = await sessionManager.getOrCreateSession(fromTeam, toTeam);
   // Returns: { sessionId: "abc-123", ... }
   ```

2. **Pass sessionId to PoolManager**:
   ```typescript
   const process = await processPool.getOrCreateProcess(
     toTeam,
     session.sessionId,  // Explicit parameter
     fromTeam
   );
   ```

3. **PoolManager spawns process with --resume**:
   ```bash
   cd {teamConfig.path}
   claude --resume {session.sessionId} \
     --print \
     --output-format stream-json \
     --input-format stream-json
   ```

4. **Track usage in SessionManager**:
   ```typescript
   sessionManager.recordUsage(session.sessionId);
   sessionManager.incrementMessageCount(session.sessionId);
   ```

### Key Difference: --session-id vs --resume

**Session initialization** (static method):
```bash
claude --session-id <new-uuid> --print ping
```
- **Creates** a new session file
- Used ONCE during initialization
- Spawned, receives response, then killed

**Session resumption** (process instance):
```bash
claude --resume <existing-uuid> --print --output-format stream-json
```
- **Continues** an existing session
- Used for every actual message
- Long-running process in pool

**CRITICAL**: Cannot use `--session-id` with an existing UUID - Claude will error. Must use `--resume`.

### Session File Paths

**Algorithm** (`getSessionFilePath`):
```typescript
function getSessionFilePath(projectPath: string, sessionId: string): string {
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const escapedPath = projectPath.replace(/\//g, "-");
  return `${homedir}/.claude/projects/${escapedPath}/${sessionId}.jsonl`;
}
```

**Examples**:
| Project Path | Escaped Directory | Session File Path |
|--------------|-------------------|-------------------|
| `/Users/jenova/projects/iris-mcp` | `-Users-jenova-projects-iris-mcp` | `~/.claude/projects/-Users-jenova-projects-iris-mcp/abc-123.jsonl` |
| `/Users/jenova/projects/frontend` | `-Users-jenova-projects-frontend` | `~/.claude/projects/-Users-jenova-projects-frontend/def-456.jsonl` |

---

## Error Handling

### Initialization Errors

**Scenario**: Team path doesn't exist

```typescript
Error: Invalid configuration for team 'backend': Project path does not exist: /nonexistent/path
Type: ConfigurationError
```

**Handling**: Iris fails to start, logs detailed error, user must fix `teams.json`

### Session Creation Timeout

**Scenario**: `claude --session-id` doesn't respond within timeout (default 30s)

```typescript
Error: Process error for team "backend": Session initialization timed out after 30000ms
Type: ProcessError
```

**Handling**:
1. Log timeout with full context
2. Kill stuck Claude process
3. Clean up timeout handler (prevents spurious errors 20s later)
4. Throw `ProcessError` to caller
5. Caller can retry with new UUID

### Session File Missing

**Scenario**: Database has session record but .jsonl file doesn't exist

**Handling during initialize()**:
```typescript
if (existing) {
  if (!existsSync(sessionFilePath)) {
    logger.warn("Session file missing, creating new session");

    // Generate NEW UUID (old one is "burned")
    const newSessionId = generateSecureUUID();

    await ClaudeProcess.initializeSessionFile(...);

    // Delete old DB entry, store new one
    this.store.delete(existing.sessionId);
    this.store.create(null, teamName, newSessionId);
  }
}
```

**Why new UUID**: Once a session ID is used with `--session-id`, Claude marks it as created. Cannot reuse.

### Database Lock

**Scenario**: SQLite database locked (concurrent write)

**Mitigation**: WAL mode enabled (`journal_mode = WAL`)

**Behavior**: WAL allows concurrent readers + one writer, very rare to lock

**If it happens**: better-sqlite3 throws error, caller should retry

### Validation Errors

**Team not found**:
```typescript
Error: Unknown team: nonexistent
Type: ConfigurationError
```

**Invalid UUID**:
```typescript
Error: Invalid session ID format: not-a-uuid
Type: ValidationError
```

**Path traversal attempt**:
```typescript
Error: Invalid team name: ../etc
Type: ValidationError
```

---

## Performance Characteristics

### Initialization Performance

**Eager initialization cost**:
- 5 teams × 12 seconds average = ~60 seconds startup
- Happens ONCE at server start
- Parallelized (all teams initialized concurrently)

**Benefit**: Zero latency on first request (session already exists)

### Runtime Performance

**Cache hit** (90%+ of requests):
```
getSession() → Map.get() → return
Time: <1ms
```

**Cache miss**:
```
getSession() → Map.get() [miss] → SQLite query (indexed) → Map.set() → return
Time: ~1-2ms
```

**Session creation** (rare):
```
createSession() → spawn claude → wait for response → DB insert → return
Time: ~7-12 seconds (network latency, Claude startup)
```

### Database Performance

**Indexed queries**:
- `getByTeamPair()`: O(log n) with index on `(from_team, to_team)`
- `getBySessionId()`: O(log n) with index on `session_id`
- `list()`: O(n) for filters, but typically small result sets

**Write operations**:
- WAL mode: Non-blocking for readers
- Pragmas: `synchronous=NORMAL` for better performance

### Memory Usage

**Cache memory**:
- ~1KB per cached session (SessionInfo object)
- 1000 cached sessions = ~1MB
- 60-second TTL prevents unbounded growth

**Database**:
- ~200 bytes per session row
- 10,000 sessions = ~2MB database file

---

## Testing Strategy

### Unit Tests

**Location**: `tests/unit/session/session-manager.test.ts`

**Strategy**: Mock `ClaudeProcess.initializeSessionFile()` static method

**Example**:
```typescript
beforeEach(() => {
  vi.spyOn(ClaudeProcess, "initializeSessionFile").mockResolvedValue(undefined);
});
```

**Tests**:
- ✅ Initialization validates all team paths
- ✅ getOrCreateSession returns existing sessions
- ✅ getOrCreateSession creates new sessions when needed
- ✅ Cache hit/miss behavior
- ✅ Metadata tracking (usage, message count)
- ✅ Session deletion (with/without file deletion)
- ✅ Validation errors thrown correctly

**Results**: 203 tests passing in <2 seconds

### Integration Tests

**Location**: `tests/integration/session/session-manager.test.ts`

**Strategy**: Real Claude process spawns, `beforeAll` for shared setup

**Tests**:
- ✅ Real session file creation
- ✅ Session file paths computed correctly
- ✅ Multiple team sessions isolated
- ✅ Session resume works after creation
- ✅ Database persistence across manager restarts

**Optimization**: `beforeAll` instead of `beforeEach` (85% faster)

**Results**: 14 tests passing in ~90 seconds (real Claude spawns are slow)

---

## SessionInfo Interface

### Complete Definition

```typescript
interface SessionInfo {
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
```

### Usage Statistics

```typescript
interface SessionStats {
  total: number;          // Total sessions in database
  active: number;         // Status = 'active'
  compactPending: number; // Status = 'compact_pending'
  archived: number;       // Status = 'archived'
  totalMessages: number;  // Sum of all message_count
}
```

**Get stats**:
```typescript
const stats = sessionManager.getStats();
console.log(`${stats.active} active sessions, ${stats.totalMessages} total messages`);
```

---

## MCP Tools Integration

### teams_ask

**Input**:
```typescript
{
  team: string,           // Destination team (REQUIRED)
  question: string,       // Question to ask (REQUIRED)
  fromTeam?: string,      // Requesting team (OPTIONAL)
  timeout?: number        // Timeout in ms (OPTIONAL)
}
```

**Flow**:
```typescript
// Tool handler
export async function teamsAsk(input, iris: IrisOrchestrator) {
  const response = await iris.ask(
    input.fromTeam || null,
    input.team,
    input.question,
    input.timeout
  );
  return { response, ... };
}

// IrisOrchestrator
async ask(fromTeam, toTeam, question, timeout) {
  // 1. Get session
  const session = await this.sessionManager.getOrCreateSession(fromTeam, toTeam);

  // 2. Get process with sessionId
  const process = await this.processPool.getOrCreateProcess(toTeam, session.sessionId, fromTeam);

  // 3. Send message
  const response = await process.sendMessage(question, timeout);

  // 4. Track usage
  this.sessionManager.recordUsage(session.sessionId);
  this.sessionManager.incrementMessageCount(session.sessionId);

  return response;
}
```

### teams_send_message

**Input**:
```typescript
{
  toTeam: string,         // Destination team (REQUIRED)
  message: string,        // Message content (REQUIRED)
  fromTeam?: string,      // Requesting team (OPTIONAL)
  waitForResponse?: boolean,  // Wait for response (OPTIONAL, default true)
  timeout?: number        // Timeout in ms (OPTIONAL)
}
```

**Uses same orchestration flow as teams_ask**

---

## Configuration

### teams.json

```json
{
  "settings": {
    "idleTimeout": 300000,          // 5 minutes
    "maxProcesses": 10,
    "healthCheckInterval": 30000,   // 30 seconds
    "sessionInitTimeout": 30000     // 30 seconds for session creation
  },
  "teams": {
    "frontend": {
      "path": "/Users/jenova/projects/myapp/frontend",  // REQUIRED
      "description": "Frontend team",
      "skipPermissions": true,
      "sessionInitTimeout": 45000,  // Override for slow teams
      "color": "#E91E63"
    },
    "backend": {
      "path": "/Users/jenova/projects/myapp/backend",
      "description": "Backend team",
      "skipPermissions": false
    }
  }
}
```

### Team Configuration Properties

**path** (REQUIRED):
- Full absolute path to project directory
- Must exist on filesystem
- Case-sensitive
- Used to compute session file location

**sessionInitTimeout** (OPTIONAL):
- Override global `settings.sessionInitTimeout`
- Useful for teams with slow startup (large dependencies)
- Default: 30000 (30 seconds)

**skipPermissions** (OPTIONAL):
- If true: adds `--dangerously-skip-permissions` flag
- Default: false

**description** (OPTIONAL):
- Human-readable team description
- Used in logs and future UI

**color** (OPTIONAL):
- Hex color for future dashboard (Phase 2+)
- Not currently used

---

## Future Enhancements

### Phase 2: Automatic Compaction

**Trigger**: Background job checks `shouldCompactSession()` periodically

**Process**:
1. Find sessions where `messageCount > 500` OR `(messageCount > 100 AND age > 7 days)`
2. Send `/compact` command to running process (if exists)
3. Call `sessionManager.compactSession(sessionId)` to update metadata
4. Log compaction results

### Phase 3: Session Analytics

**Track**:
- Average messages per session
- Session lifetime distribution
- Most active team pairs
- Compaction frequency
- Error rates per session

**UI**: Dashboard (React) showing session health

### Phase 4: Multi-Session Threads

**Use case**: Team needs multiple parallel conversations

**Schema change**:
```sql
ALTER TABLE team_sessions ADD COLUMN thread_id TEXT;
CREATE UNIQUE INDEX idx_sessions_thread ON team_sessions(from_team, to_team, thread_id);
```

**API change**:
```typescript
getOrCreateSession(fromTeam, toTeam, threadId?: string)
```

### Phase 5: Session Summarization

**Trigger**: Session approaching token limit

**Process**:
1. Extract conversation from .jsonl file
2. Use Claude API to generate summary
3. Create new session with summary as initial context
4. Archive old session
5. Update database to point to new session

---

## Appendix: Complete Example Flow

### Scenario: Frontend asks Backend about API design

1. **User types in frontend Claude**:
   ```
   User: "Ask the backend team about their REST API design"
   ```

2. **Frontend Claude calls Iris MCP**:
   ```typescript
   teams_ask({
     team: "backend",
     question: "What's your REST API design for user endpoints?",
     fromTeam: "frontend",
     timeout: 30000
   })
   ```

3. **Tool handler** (`teams-ask.ts`):
   ```typescript
   export async function teamsAsk(input, iris: IrisOrchestrator) {
     const response = await iris.ask(
       input.fromTeam || null,  // "frontend"
       input.team,              // "backend"
       input.question,
       input.timeout
     );
     return { response, team: input.team, ... };
   }
   ```

4. **IrisOrchestrator.ask()**:
   ```typescript
   async ask(fromTeam, toTeam, question, timeout) {
     // Step 1: Get session
     const session = await this.sessionManager.getOrCreateSession(
       "frontend",  // fromTeam
       "backend"    // toTeam
     );
     // session.sessionId = "a1b2c3d4-..."

     // Step 2: Get process
     const process = await this.processPool.getOrCreateProcess(
       "backend",
       session.sessionId,
       "frontend"
     );

     // Step 3: Check if spawning
     if (process.getMetrics().status === "spawning") {
       return "Session starting...";
     }

     // Step 4: Send message
     const response = await process.sendMessage(question, timeout);

     // Step 5: Track usage
     this.sessionManager.recordUsage(session.sessionId);
     this.sessionManager.incrementMessageCount(session.sessionId);

     return response;
   }
   ```

5. **SessionManager.getOrCreateSession()**:
   ```typescript
   // Check cache
   const cached = this.sessionCache.get("frontend->backend");
   if (cached && this.isCacheValid("frontend->backend")) {
     return cached;  // Cache hit!
   }

   // Cache miss - check database
   const existing = this.store.getByTeamPair("frontend", "backend");
   if (existing) {
     // Update cache
     this.sessionCache.set("frontend->backend", existing);
     this.cacheTimestamps.set("frontend->backend", Date.now());
     return existing;
   }

   // Not found - create new session
   return await this.createSession("frontend", "backend");
   ```

6. **If session doesn't exist, createSession()**:
   ```typescript
   const sessionId = generateSecureUUID();  // "a1b2c3d4-5678-..."

   await ClaudeProcess.initializeSessionFile(
     backendTeamConfig,
     sessionId,
     30000  // timeout
   );
   // This spawns: claude --session-id a1b2c3d4-5678-... --print ping
   // Waits for response, verifies file created

   const sessionInfo = this.store.create("frontend", "backend", sessionId);

   // Update cache
   this.sessionCache.set("frontend->backend", sessionInfo);
   this.cacheTimestamps.set("frontend->backend", Date.now());

   return sessionInfo;
   ```

7. **PoolManager.getOrCreateProcess()**:
   ```typescript
   const poolKey = "frontend->backend";

   // Check if process exists
   const existing = this.processes.get(poolKey);
   if (existing && existing.getMetrics().status !== "stopped") {
     return existing;  // Reuse pooled process
   }

   // Spawn new process
   const process = new ClaudeProcess(
     "backend",
     backendTeamConfig,
     300000,  // idleTimeout
     "a1b2c3d4-5678-..."  // sessionId
   );

   await process.spawn();
   // This runs: claude --resume a1b2c3d4-5678-... --print --output-format stream-json

   this.processes.set(poolKey, process);
   return process;
   ```

8. **Backend Claude**:
   - Loads session history from `~/.claude/projects/-Users-jenova-projects-backend/a1b2c3d4-5678-....jsonl`
   - Processes question with full context of all previous frontend↔backend interactions
   - Sends response via stream-json

9. **Response flows back**:
   ```
   Process → PoolManager → IrisOrchestrator → Tool Handler → MCP → Frontend Claude
   ```

10. **Metadata updated**:
    ```typescript
    sessionManager.recordUsage(session.sessionId);
    // Updates last_used_at in database

    sessionManager.incrementMessageCount(session.sessionId);
    // Increments message_count in database

    // Both invalidate cache for fresh reads
    ```

**Result**: Next time frontend asks backend a question, Claude remembers this entire conversation!

**Performance**:
- **First request** (session creation): ~10-15 seconds
- **Subsequent requests** (cached session + pooled process): ~2-3 seconds

---

## Conclusion

SessionManager is a **database and file validation layer** that:

✅ **Pre-initializes** all team sessions at startup
✅ **Validates** session files exist on filesystem
✅ **Caches** frequently accessed sessions
✅ **Delegates** file creation to `ClaudeProcess.initializeSessionFile()`
✅ **Tracks** usage metadata for analytics and compaction
✅ **Does NOT** spawn processes or send messages

This clean separation of concerns makes the architecture:
- **Testable**: Mock static method for fast unit tests
- **Maintainable**: Each layer has one responsibility
- **Scalable**: Caching and indexing for performance
- **Reliable**: Validation at every layer

---

**Last Updated**: 2025-10-10
**Architecture Version**: Phase 1 (Post-Refactor)
**Next Review**: When implementing Phase 2 (automatic compaction)
