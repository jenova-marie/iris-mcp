# MCP Tools Documentation

**Location:** `src/actions/`
**Purpose:** MCP tool implementations for team coordination
**Protocol:** Model Context Protocol (MCP) specification-compliant

---

## Table of Contents

1. [Overview](#overview)
2. [Tool Catalog](#tool-catalog)
3. [Tool Implementations](#tool-implementations)
   - [Communication Tools](#communication-tools)
   - [Session Management Tools](#session-management-tools)
   - [Process Management Tools](#process-management-tools)
   - [Information & Debug Tools](#information--debug-tools)
   - [Internal Tools](#internal-tools)
4. [Input Validation](#input-validation)
5. [Error Handling](#error-handling)
6. [Usage Examples](#usage-examples)

---

## Overview

Iris exposes **15 MCP tools** that enable Claude instances to coordinate across projects:

**Communication:**
- `team_tell` - Send messages between teams (sync/async/persistent modes)
- `team_quick_tell` - Quick async message (convenience wrapper)

**Session Management:**
- `team_clear` - Create fresh session (reboot with clean slate)
- `team_delete` - Delete session permanently
- `team_compact` - Compress session history
- `team_fork` - Launch interactive terminal session

**Process Management:**
- `team_wake` - Start team process
- `team_sleep` - Stop team process
- `team_wake_all` - Start all team processes
- `team_isAwake` - Check team process status
- `team_cancel` - Cancel running operation (EXPERIMENTAL)

**Information & Debug:**
- `team_report` - View conversation cache
- `team_teams` - List all configured teams
- `team_debug` - Query in-memory logs

**Internal:**
- `permissions__approve` - Permission approval handler (for Reverse MCP)

---

## Tool Catalog

| Tool | Purpose | Blocking? | Parameters |
|------|---------|-----------|------------|
| `team_tell` | Send message to team | Optional | toTeam, message, fromTeam, timeout?, persist?, ttlDays? |
| `team_quick_tell` | Quick async tell | No | toTeam, message, fromTeam |
| `team_cancel` | Cancel operation | Yes | team, fromTeam |
| `team_clear` | Create fresh session | Yes | toTeam, fromTeam |
| `team_delete` | Delete session | Yes | toTeam, fromTeam |
| `team_compact` | Compress session | Yes | toTeam, fromTeam, timeout?, retries? |
| `team_fork` | Fork to terminal | Yes | toTeam, fromTeam |
| `team_wake` | Wake team process | Yes | team, fromTeam |
| `team_sleep` | Sleep team process | Yes | team, fromTeam, force? |
| `team_wake_all` | Wake all teams | Yes | fromTeam, parallel? |
| `team_isAwake` | Check team status | Yes | fromTeam, team?, includeNotifications? |
| `team_report` | View cache | Yes | team, fromTeam |
| `team_teams` | List all teams | Yes | - |
| `team_debug` | Query logs | Yes | logs_since?, storeName?, format?, level?, getAllStores? |
| `permissions__approve` | Approve tool | Yes | tool_name, input, reason? |

---

## Tool Implementations

### Communication Tools

#### 1. team_tell

**Purpose:** Send a message to another team with multiple modes (sync, async, persistent)

**Signature:**
```typescript
team_tell(input: {
  toTeam: string;
  message: string;
  fromTeam: string;
  timeout?: number;           // default: 0 (indefinite wait)
  persist?: boolean;          // default: false
  ttlDays?: number;           // default: 30
}): Promise<{
  from?: string;
  to: string;
  message: string;
  response?: string;
  duration?: number;
  timestamp: number;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `toTeam` | string | Yes | Target team name |
| `message` | string | Yes | Message content (max 100KB) |
| `fromTeam` | string | Yes | Calling team name |
| `timeout` | number | No | Timeout in ms. 0=indefinite, -1=async (default: 0) |
| `persist` | boolean | No | Use SQLite queue for persistence (default: false) |
| `ttlDays` | number | No | TTL for persistent messages in days (default: 30) |

**Modes:**

1. **Synchronous** (`timeout > 0` or `timeout = 0`): Wait for response
2. **Asynchronous** (`timeout = -1`): Return immediately, process in background
3. **Persistent** (`persist = true`): Queue in SQLite, survives server restart

**Example:**
```typescript
// Sync mode (wait for response)
const result = await team_tell({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "What's the API status?",
  timeout: 30000
});
// result.response = "All APIs operational"

// Async mode (fire and forget)
const async = await team_tell({
  toTeam: "data-pipeline",
  fromTeam: "frontend",
  message: "Generate monthly report",
  timeout: -1
});
// Returns immediately, check cache later with team_report

// Persistent mode (survives restart)
const persistent = await team_tell({
  toTeam: "mobile",
  fromTeam: "backend",
  message: "New API version deployed",
  persist: true,
  ttlDays: 7
});
```

---

#### 2. team_quick_tell

**Purpose:** Convenience wrapper for async `team_tell` (timeout=-1)

**Signature:**
```typescript
team_quick_tell(input: {
  toTeam: string;
  message: string;
  fromTeam: string;
}): Promise<TellOutput>
```

**Example:**
```typescript
const result = await team_quick_tell({
  toTeam: "staging",
  fromTeam: "ci-cd",
  message: "Deploy latest build"
});
// Returns immediately, processes in background
```

**Note:** This is identical to `team_tell` with `timeout: -1` but more explicit.

---

### Session Management Tools

#### 3. team_clear

**Purpose:** Create a fresh new session (reboot with clean slate)

Terminates existing process, deletes old session, creates new session with fresh UUID. Perfect for starting over when context becomes too large or conversation gets confused.

**Signature:**
```typescript
team_clear(input: {
  toTeam: string;
  fromTeam: string;
}): Promise<{
  from: string;
  to: string;
  hadPreviousSession: boolean;
  oldSessionId?: string;
  newSessionId: string;
  processTerminated: boolean;
  message: string;
  timestamp: number;
}>
```

**Workflow:**
1. Terminate existing process (if running)
2. Delete old session from database
3. Clean up filesystem (session dir)
4. Create new session with new UUID
5. Wake team with new session

**Example:**
```typescript
const result = await team_clear({
  toTeam: "backend",
  fromTeam: "frontend"
});

// result = {
//   from: "frontend",
//   to: "backend",
//   hadPreviousSession: true,
//   oldSessionId: "abc-old-123",
//   newSessionId: "xyz-new-456",
//   processTerminated: true,
//   message: "Fresh new session created. Old session abc-old-123 terminated and rebooted..."
// }
```

**Warning:** This deletes ALL conversation history for the session pair. Irreversible.

---

#### 4. team_delete

**Purpose:** Delete a session permanently without creating a new one

Unlike `team_clear` which creates a new session, `team_delete` just removes the session completely.

**Signature:**
```typescript
team_delete(input: {
  toTeam: string;
  fromTeam: string;
}): Promise<{
  from: string;
  to: string;
  hadSession: boolean;
  sessionId?: string;
  processTerminated: boolean;
  message: string;
  timestamp: number;
}>
```

**Example:**
```typescript
const result = await team_delete({
  toTeam: "temporary-worker",
  fromTeam: "orchestrator"
});
// Session removed, no new session created
```

**Use Cases:**
- Clean up temporary sessions
- Remove sessions you won't use again
- Free resources without replacement

---

#### 5. team_compact

**Purpose:** Compress session history to reduce context size

Uses `claude --print /compact` to compress the session while preserving important context. Session remains active after compacting.

**Signature:**
```typescript
team_compact(input: {
  toTeam: string;
  fromTeam: string;
  timeout?: number;           // default: 30000
  retries?: number;           // default: 2
}): Promise<{
  from: string;
  to: string;
  sessionId: string;
  success: boolean;
  duration: number;
  exitCode: number;
  output?: string;
  message: string;
  timestamp: number;
  retryCount?: number;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `toTeam` | string | Yes | Team to compact |
| `fromTeam` | string | Yes | Calling team |
| `timeout` | number | No | Timeout in ms (default: 30000) |
| `retries` | number | No | Retry attempts (default: 2) |

**Example:**
```typescript
const result = await team_compact({
  toTeam: "backend",
  fromTeam: "frontend",
  timeout: 45000,
  retries: 3
});

// result = {
//   success: true,
//   exitCode: 0,
//   duration: 12500,
//   message: "Session compacted successfully for frontend->backend"
// }
```

**When to Use:**
- Session context has grown large (>100k tokens)
- Performance degrading due to large history
- Want to preserve context but reduce size
- Alternative to `team_clear` when you don't want to lose history

---

#### 6. team_fork

**Purpose:** Fork a session to an interactive terminal

Launches a new terminal window with `claude --resume --fork-session` so you can interact with the session manually. Executes user-configured fork script (`~/.iris/spawn.sh` or `ps1`).

**Signature:**
```typescript
team_fork(input: {
  toTeam: string;
  fromTeam: string;
}): Promise<{
  success: boolean;
  from: string;
  to: string;
  sessionId: string;
  forkScriptPath?: string;
  teamPath?: string;
  remote: boolean;
  sshHost?: string;
  message: string;
  timestamp: number;
}>
```

**Fork Script Arguments:**
1. `sessionId` - The session ID to resume
2. `teamPath` - Project path for the team
3. `claudePath` - Path to Claude CLI executable
4. `sshHost` - SSH host (if remote team)
5. `sshOptions` - SSH options (if remote team)

**Example Fork Script (`~/.iris/spawn.sh`):**
```bash
#!/bin/bash
SESSION_ID="$1"
TEAM_PATH="$2"
CLAUDE_PATH="$3"
SSH_HOST="$4"
SSH_OPTIONS="$5"

if [ -n "$SSH_HOST" ]; then
  # Remote team
  osascript -e "tell app \"Terminal\" to do script \"ssh $SSH_OPTIONS $SSH_HOST 'cd $TEAM_PATH && $CLAUDE_PATH --resume --fork-session $SESSION_ID'\""
else
  # Local team
  osascript -e "tell app \"Terminal\" to do script \"cd $TEAM_PATH && $CLAUDE_PATH --resume --fork-session $SESSION_ID\""
fi
```

**Example:**
```typescript
const result = await team_fork({
  toTeam: "backend",
  fromTeam: "frontend"
});

// New terminal window opens with interactive Claude session
// result = {
//   success: true,
//   sessionId: "abc-123-...",
//   remote: false,
//   message: "Terminal fork launched successfully for session abc-123-..."
// }
```

**Requirements:**
- Fork script must exist at `~/.iris/spawn.sh` (or `.bat`/`.ps1` on Windows)
- Script must be executable (`chmod +x ~/.iris/spawn.sh`)
- Session must exist (wake team first if needed)

---

### Process Management Tools

#### 7. team_wake

**Purpose:** Ensure a team's process is running (spawn if needed)

Creates a session-specific process for conversation isolation. For example, `fromTeam='iris'` and `team='alpha'` creates a dedicated process for the `iris->alpha` conversation.

**Signature:**
```typescript
team_wake(input: {
  team: string;
  fromTeam: string;
}): Promise<{
  team: string;
  status: "awake" | "waking";
  pid?: number;
  sessionId?: string;
  message?: string;
  duration: number;
  timestamp: number;
}>
```

**Example:**
```typescript
const result = await team_wake({
  team: "data-pipeline",
  fromTeam: "orchestrator"
});

// If already awake:
// result = { status: "awake", pid: 12345, sessionId: "abc-123" }

// If waking up:
// result = { status: "waking", message: "Team data-pipeline is waking up" }
```

**Process Pool Behavior:**
- If process exists: Returns immediately with status "awake"
- If not exists: Spawns new process, returns when ready
- First wake: ~7-10 seconds (cold start)
- Subsequent wakes: ~2-3 seconds (process pool)

---

#### 8. team_sleep

**Purpose:** Put a team to sleep (terminate process, free resources)

**Signature:**
```typescript
team_sleep(input: {
  team: string;
  fromTeam: string;
  force?: boolean;            // default: false
}): Promise<{
  team: string;
  status: "asleep" | "already_asleep";
  message: string;
  duration: number;
  timestamp: number;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `team` | string | Yes | Team to put to sleep |
| `fromTeam` | string | Yes | Calling team |
| `force` | boolean | No | Force termination (SIGKILL vs SIGTERM, default: false) |

**Force vs Graceful:**
- `force=false`: SIGTERM with 5s timeout (graceful)
- `force=true`: SIGKILL (immediate, not recommended)

**Example:**
```typescript
const result = await team_sleep({
  team: "staging",
  fromTeam: "ci-cd"
});

// result = {
//   team: "staging",
//   status: "asleep",
//   message: "Team staging has been put to sleep",
//   duration: 150
// }
```

---

#### 9. team_wake_all

**Purpose:** Wake up all configured teams

**Signature:**
```typescript
team_wake_all(input: {
  fromTeam: string;
  parallel?: boolean;         // default: false (RECOMMENDED)
}): Promise<{
  results: Array<{
    team: string;
    success: boolean;
    status: "awake" | "waking";
    message?: string;
    error?: string;
  }>;
  totalTeams: number;
  successCount: number;
  failureCount: number;
  duration: number;
  timestamp: number;
}>
```

**Warning:** `parallel=true` is **NOT RECOMMENDED**. Spawning multiple Claude instances simultaneously is unstable and causes timeouts. Use `parallel=false` (default) for sequential waking.

**Example:**
```typescript
const result = await team_wake_all({
  fromTeam: "orchestrator"
});

// result = {
//   results: [
//     { team: "frontend", success: true, status: "waking" },
//     { team: "backend", success: true, status: "awake" },
//     { team: "mobile", success: false, error: "Spawn timeout" }
//   ],
//   totalTeams: 3,
//   successCount: 2,
//   failureCount: 1,
//   duration: 45000
// }
```

**Performance:**
- Sequential: ~7-10s per team (cold start), ~2-3s if already awake
- Parallel: Unstable, causes timeouts, not recommended

---

#### 10. team_isAwake

**Purpose:** Check if one or all teams are active

**Signature:**
```typescript
team_isAwake(input: {
  fromTeam: string;
  team?: string;
  includeNotifications?: boolean;   // default: true
}): Promise<{
  team?: string;
  awake?: boolean;
  teams?: Array<{
    name: string;
    awake: boolean;
    pid?: number;
    sessionId?: string;
    notifications?: {
      pending: number;
      read: number;
    };
  }>;
  timestamp: number;
}>
```

**Single Team Check:**
```typescript
const result = await team_isAwake({
  fromTeam: "frontend",
  team: "backend"
});

// result = {
//   team: "backend",
//   awake: true,
//   timestamp: 1697567890123
// }
```

**All Teams Check:**
```typescript
const result = await team_isAwake({
  fromTeam: "orchestrator"
});

// result = {
//   teams: [
//     { name: "frontend", awake: true, pid: 12345, sessionId: "abc..." },
//     { name: "backend", awake: false },
//     { name: "mobile", awake: true, pid: 67890, sessionId: "def..." }
//   ],
//   timestamp: 1697567890123
// }
```

---

#### 11. team_cancel

**Purpose:** **EXPERIMENTAL** - Attempt to cancel a running operation

Sends ESC to stdin to interrupt the Claude process. This may or may not work depending on Claude's headless mode implementation.

**Signature:**
```typescript
team_cancel(input: {
  team: string;
  fromTeam: string;
}): Promise<{
  team: string;
  cancelled: boolean;
  message: string;
  timestamp: number;
}>
```

**Example:**
```typescript
const result = await team_cancel({
  team: "backend",
  fromTeam: "frontend"
});

// result = {
//   team: "backend",
//   cancelled: true,
//   message: "ESC signal sent to process"
// }
```

**Warning:** This is experimental. Success depends on whether Claude's headless mode supports ESC interrupt handling. Not guaranteed to work.

---

### Information & Debug Tools

#### 12. team_report

**Purpose:** View the conversation cache for a team pair

Returns all cache entries (spawn + tell operations) with their messages and status. This is the primary means for viewing Claude responses from async operations.

**Signature:**
```typescript
team_report(input: {
  team: string;
  fromTeam: string;
}): Promise<{
  team: string;
  fromTeam: string;
  hasCache: boolean;
  entries?: Array<{
    type: "SPAWN" | "TELL";
    status: "active" | "completed" | "terminated";
    messageCount: number;
    createdAt: number;
    completedAt?: number;
  }>;
  stats?: {
    totalEntries: number;
    activeEntries: number;
    completedEntries: number;
  };
  timestamp: number;
}>
```

**Example:**
```typescript
const result = await team_report({
  team: "backend",
  fromTeam: "frontend"
});

// result = {
//   team: "backend",
//   fromTeam: "frontend",
//   hasCache: true,
//   entries: [
//     {
//       type: "SPAWN",
//       status: "completed",
//       messageCount: 3,
//       createdAt: 1697567890000
//     },
//     {
//       type: "TELL",
//       status: "active",
//       messageCount: 10,
//       createdAt: 1697567895000
//     }
//   ],
//   stats: {
//     totalEntries: 2,
//     activeEntries: 1,
//     completedEntries: 1
//   }
// }
```

**Use Cases:**
- Check results from async `team_tell` (timeout=-1)
- Debug empty responses
- View conversation history
- Monitor active operations

---

#### 13. team_teams

**Purpose:** List all configured teams and their configuration

**Signature:**
```typescript
team_teams(): Promise<{
  teams: Array<{
    name: string;
    path: string;
    description?: string;
    color?: string;
    remote?: string;
    idleTimeout?: number;
  }>;
  totalTeams: number;
  timestamp: number;
}>
```

**Example:**
```typescript
const result = await team_teams();

// result = {
//   teams: [
//     {
//       name: "frontend",
//       path: "/Users/jenova/projects/frontend",
//       description: "React frontend",
//       color: "#61dafb",
//     },
//     {
//       name: "backend",
//       path: "/Users/jenova/projects/backend",
//       description: "Node.js API",
//       remote: "ssh inanna"
//     }
//   ],
//   totalTeams: 2
// }
```

---

#### 14. team_debug

**Purpose:** Query in-memory logs from Wonder Logger

Returns logs since a specified timestamp with optional filtering by level and format. Useful for debugging Iris MCP server internals.

**Signature:**
```typescript
team_debug(input: {
  logs_since?: number;
  storeName?: string;
  format?: "raw" | "parsed";
  level?: string | string[];
  getAllStores?: boolean;
}): Promise<{
  logs?: Array<{
    level: string;
    time: number;
    msg: string;
    [key: string]: any;
  }>;
  stores?: string[];
  count: number;
  timestamp: number;
}>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `logs_since` | number | Timestamp (ms) to get logs since (optional) |
| `storeName` | string | Memory store name (default: "iris-mcp") |
| `format` | string | "raw" (Pino JSON) or "parsed" (human-readable, default) |
| `level` | string/array | Filter by level: "error", ["error", "warn"], etc. |
| `getAllStores` | boolean | Return list of store names instead of logs |

**Example:**
```typescript
// Get error logs from last 5 minutes
const result = await team_debug({
  logs_since: Date.now() - 300000,
  level: "error",
  format: "parsed"
});

// Get all available stores
const stores = await team_debug({
  getAllStores: true
});
// stores = { stores: ["iris-mcp", "session-manager", "pool-manager"] }
```

---

### Internal Tools

#### 15. permissions__approve

**Purpose:** Permission approval handler for Claude Code's `--permission-prompt-tool`

This tool is called by remote Claude instances (via Reverse MCP) when they need permission to use Iris MCP tools. Auto-approves all `mcp__iris__*` tools, denies everything else.

**Signature:**
```typescript
permissions__approve(input: {
  tool_name: string;
  input: Record<string, unknown>;
  reason?: string;
}): Promise<{
  behavior: "allow" | "deny";
  message?: string;
  updatedInput?: Record<string, unknown>;
}>
```

**Example:**
```typescript
const result = await permissions__approve({
  tool_name: "mcp__iris__team_teams",
  input: {},
  reason: "Need to list teams"
});

// result = {
//   behavior: "allow",
//   updatedInput: {}
// }
```

**Policy:**
- Auto-approve: All `mcp__iris__*` tools
- Deny: All other tools

**Use Case:** Reverse MCP tunneling where remote Claude instances call back to local Iris MCP server.

**Note:** This is an internal tool primarily used by the Reverse MCP feature. Most users won't call this directly.

---

## Input Validation

All tools use **strict validation** to prevent security issues:

### validateTeamName()

```typescript
function validateTeamName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new ValidationError("Team name is required");
  }

  // Prevent path traversal
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new ValidationError("Invalid team name (no path separators allowed)");
  }

  // Length limits
  if (name.length > 100) {
    throw new ValidationError("Team name too long (max 100 characters)");
  }
}
```

**Blocks:**
- Path traversal attempts: `../../etc/passwd`
- Directory separators: `/`, `\`
- Parent directory refs: `..`

### validateMessage()

```typescript
function validateMessage(message: string): void {
  if (!message || typeof message !== "string") {
    throw new ValidationError("Message is required");
  }

  // Length limits (100KB max)
  if (message.length > 102400) {
    throw new ValidationError("Message too long (max 100KB)");
  }

  // Remove null bytes (security)
  if (message.includes("\0")) {
    throw new ValidationError("Message contains null bytes");
  }
}
```

### validateTimeout()

```typescript
function validateTimeout(timeout: number): void {
  if (typeof timeout !== "number" || isNaN(timeout)) {
    throw new ValidationError("Timeout must be a number");
  }

  // Range: -1 to 1hr (allow -1 for async mode)
  if (timeout < -1 || timeout > 3600000) {
    throw new ValidationError("Timeout must be between -1 and 1hr");
  }
}
```

---

## Error Handling

**Error Types:**

```typescript
// Validation errors
{
  "error": "ValidationError",
  "message": "Team name too long (max 100 characters)"
}

// Configuration errors
{
  "error": "TeamNotFoundError",
  "message": "Unknown team: nonexistent"
}

// Process errors
{
  "error": "ProcessError",
  "message": "Process spawn failed: timeout after 10s"
}

// Timeout errors
{
  "error": "TimeoutError",
  "message": "Operation timed out after 30000ms"
}

// Session errors
{
  "error": "SessionNotFoundError",
  "message": "No session found for frontend->backend"
}
```

**Error Propagation:**

```typescript
try {
  const result = await team_tell({
    toTeam: "invalid/team",
    message: "hi",
    fromTeam: "test"
  });
} catch (error) {
  // error.name = "ValidationError"
  // error.message = "Invalid team name (no path separators allowed)"
}
```

---

## Usage Examples

### Cross-Team Code Review

```typescript
// Frontend team asks backend team to review PR
const result = await team_tell({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "Please review PR #123: Add authentication middleware",
  timeout: 60000
});

console.log(result.response);
// "Reviewed PR #123. LGTM! Approved with minor suggestions."
```

### Orchestrated Deployment

```typescript
// Wake all teams
await team_wake_all({ fromTeam: "orchestrator" });

// Tell each team to run tests
const frontendTests = await team_tell({
  toTeam: "frontend",
  fromTeam: "orchestrator",
  message: "Run npm test"
});

const backendTests = await team_tell({
  toTeam: "backend",
  fromTeam: "orchestrator",
  message: "Run pytest"
});

// Deploy if all pass
if (frontendTests.response?.includes("PASS") &&
    backendTests.response?.includes("PASS")) {
  await team_tell({
    toTeam: "devops",
    fromTeam: "orchestrator",
    message: "Deploy to staging"
  });
}
```

### Async Task Processing

```typescript
// Start long-running task async
const task = await team_quick_tell({
  toTeam: "data-pipeline",
  fromTeam: "analytics",
  message: "Generate annual report for 2024"
});

// Later, check cache for results
const cache = await team_report({
  team: "data-pipeline",
  fromTeam: "analytics"
});

console.log(cache.entries);
// Check for completed entries with results
```

### Session Cleanup Workflow

```typescript
// Session context too large? Compact it first
const compact = await team_compact({
  toTeam: "backend",
  fromTeam: "frontend"
});

if (!compact.success) {
  // Compact failed? Clear and start fresh
  await team_clear({
    toTeam: "backend",
    fromTeam: "frontend"
  });
}
```

### Debug Workflow

```typescript
// Check if team is awake
const status = await team_isAwake({
  fromTeam: "frontend",
  team: "backend"
});

if (!status.awake) {
  // Wake it up
  await team_wake({
    team: "backend",
    fromTeam: "frontend"
  });
}

// Check logs for errors
const logs = await team_debug({
  logs_since: Date.now() - 300000,
  level: "error"
});

console.log(logs.logs);
```

---

## Tool Registration

Tools are registered in `src/mcp_server.ts`:

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "team_tell":
      return { content: [{ type: "text", text: JSON.stringify(
        await tell(args, iris), null, 2
      )}]};

    case "team_quick_tell":
      return { content: [{ type: "text", text: JSON.stringify(
        await quickTell(args, iris), null, 2
      )}]};

    case "team_cancel":
      return { content: [{ type: "text", text: JSON.stringify(
        await cancel(args, processPool), null, 2
      )}]};

    case "team_clear":
      return { content: [{ type: "text", text: JSON.stringify(
        await reboot(args, iris, sessionManager, processPool), null, 2
      )}]};

    // ... rest of tools

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});
```

---

**Document Version:** 2.0
**Last Updated:** January 2025
**Iris MCP Version:** 0.0.1

**Changes from v1.0:**
- Removed: `team_cache_read`, `team_cache_clear`, `team_getTeamName` (deprecated)
- Added: `team_quick_tell`, `team_cancel`, `team_clear`, `team_delete`, `team_compact`, `team_fork`, `team_debug`, `permissions__approve`
- Updated: `team_tell` (added persist, ttlDays), `team_isAwake` (fromTeam required), `team_report` (conversation cache)
- Corrected all parameter signatures and return types based on actual implementation
