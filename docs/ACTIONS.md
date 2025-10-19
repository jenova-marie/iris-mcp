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
- `send_message` - Send messages between teams (sync/async/persistent modes)
- `ask_message` - Semantic alias for send_message (question-focused)
- `quick_message` - Quick async message (fire-and-forget)

**Session Management:**
- `session_reboot` - Create fresh session (reboot with clean slate)
- `session_delete` - Delete session permanently
- `session_fork` - Launch interactive terminal session
- `session_cancel` - Cancel running operation (EXPERIMENTAL)

**Process Management:**
- `team_wake` - Start team process
- `team_launch` - Semantic alias for team_wake (natural language)
- `team_sleep` - Stop team process
- `team_wake_all` - Start all team processes
- `team_status` - Check team process status

**Information & Debug:**
- `session_report` - View conversation cache
- `list_teams` - List all configured teams
- `get_logs` - Query in-memory logs
- `get_date` - Get current system date/time

**Internal:**
- `permissions__approve` - Permission approval handler (for permission prompts)

---

## Tool Catalog

| Tool | Purpose | Blocking? | Parameters |
|------|---------|-----------|------------|
| `send_message` | Send message to team | Optional | toTeam, message, fromTeam, timeout?, persist?, ttlDays? |
| `ask_message` | Ask question (semantic alias) | Optional | toTeam, message, fromTeam, timeout?, persist?, ttlDays? |
| `quick_message` | Quick async message | No | toTeam, message, fromTeam |
| `session_cancel` | Cancel operation | Yes | team, fromTeam |
| `session_reboot` | Create fresh session | Yes | toTeam, fromTeam |
| `session_delete` | Delete session | Yes | toTeam, fromTeam |
| `session_fork` | Fork to terminal | Yes | toTeam, fromTeam |
| `team_wake` | Wake team process | Yes | team, fromTeam |
| `team_launch` | Launch team (alias) | Yes | team, fromTeam |
| `team_sleep` | Sleep team process | Yes | team, fromTeam, force? |
| `team_wake_all` | Wake all teams | Yes | fromTeam, parallel? |
| `team_status` | Check team status | Yes | fromTeam, team?, includeNotifications? |
| `session_report` | View cache | Yes | team, fromTeam |
| `list_teams` | List all teams | Yes | - |
| `get_logs` | Query logs | Yes | logs_since?, storeName?, format?, level?, getAllStores? |
| `get_date` | Get current date/time | Yes | - |
| `permissions__approve` | Approve tool | Yes | tool_name, input, reason? |

---

## Tool Implementations

### Communication Tools

#### 1. send_message

**Purpose:** Send a message to another team with multiple modes (sync, async, persistent)

**Signature:**
```typescript
send_message(input: {
  toTeam: string;
  message: string;
  fromTeam: string;
  timeout?: number;           // default: 30000
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
| `timeout` | number | No | Timeout in ms. 0=indefinite, -1=async (default: 30000) |
| `persist` | boolean | No | Use SQLite queue for persistence (default: false) |
| `ttlDays` | number | No | TTL for persistent messages in days (default: 30) |

**Modes:**

1. **Synchronous** (`timeout > 0` or `timeout = 0`): Wait for response
2. **Asynchronous** (`timeout = -1`): Return immediately, process in background
3. **Persistent** (`persist = true`): Queue in SQLite, survives server restart

**Example:**
```typescript
// Sync mode (wait for response)
const result = await send_message({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "What's the API status?",
  timeout: 30000
});
// result.response = "All APIs operational"

// Async mode (fire and forget)
const async = await send_message({
  toTeam: "data-pipeline",
  fromTeam: "frontend",
  message: "Generate monthly report",
  timeout: -1
});
// Returns immediately, check cache later with session_report

// Persistent mode (survives restart)
const persistent = await send_message({
  toTeam: "mobile",
  fromTeam: "backend",
  message: "New API version deployed",
  persist: true,
  ttlDays: 7
});
```

---

#### 2. ask_message

**Purpose:** Ask a question to a team and wait for their response. Semantic alias for send_message that makes it clear you're expecting an answer.

**Signature:**
```typescript
ask_message(input: {
  toTeam: string;
  message: string;
  fromTeam: string;
  timeout?: number;
  persist?: boolean;
  ttlDays?: number;
}): Promise<TellOutput>
```

**Example:**
```typescript
const result = await ask_message({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "What's the database schema for users table?"
});
// Makes intent clear: expecting an answer
```

**Note:** This is identical to `send_message` but signals question intent through naming.

---

#### 3. quick_message

**Purpose:** Quickly send a message without waiting (async/fire-and-forget)

**Signature:**
```typescript
quick_message(input: {
  toTeam: string;
  message: string;
  fromTeam: string;
}): Promise<TellOutput>
```

**Example:**
```typescript
const result = await quick_message({
  toTeam: "staging",
  fromTeam: "ci-cd",
  message: "Deploy latest build"
});
// Returns immediately, processes in background
```

**Note:** This is equivalent to `send_message` with `timeout: -1` but more explicit for fire-and-forget scenarios.

---

### Session Management Tools

#### 4. session_reboot

**Purpose:** Reboot a session to start fresh with a clean slate

Terminates existing process, deletes old session, creates new session with fresh UUID. Perfect for starting over when context becomes too large or conversation gets confused.

**Signature:**
```typescript
session_reboot(input: {
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
const result = await session_reboot({
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

#### 5. session_delete

**Purpose:** Delete a session permanently without creating a new one

Unlike `session_reboot` which creates a new session, `session_delete` just removes the session completely.

**Signature:**
```typescript
session_delete(input: {
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
const result = await session_delete({
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

#### 6. session_fork

**Purpose:** Fork a session into a new terminal window for manual interaction

Launches a separate terminal with `claude --resume --fork-session` so you can interact with the session directly. Executes user-configured fork script (`~/.iris/spawn.sh` or `ps1`). Works for both local and remote teams.

**Signature:**
```typescript
session_fork(input: {
  toTeam: string;
  fromTeam: string;
}): Promise<{
  success: boolean;
  from: string;
  to: string;
  sessionId: string;
  spawnScriptPath?: string;
  teamPath?: string;
  remote: boolean;
  sshHost?: string;
  message: string;
  timestamp: number;
}>
```

**Fork Script Arguments:**
1. `teamPath` - Project path for the team
2. `fullClaudeCommand` - Complete command to execute
3. `sshHost` - SSH host (if remote team)
4. `sshOptions` - SSH options (if remote team)

**Example Fork Script (`~/.iris/spawn.sh`):**
```bash
#!/bin/bash
TEAM_PATH="$1"
FULL_COMMAND="$2"
SSH_HOST="$3"
SSH_OPTIONS="$4"

if [ -n "$SSH_HOST" ]; then
  # Remote team
  osascript -e "tell app \"Terminal\" to do script \"ssh $SSH_OPTIONS $SSH_HOST '$FULL_COMMAND'\""
else
  # Local team
  osascript -e "tell app \"Terminal\" to do script \"cd $TEAM_PATH && $FULL_COMMAND\""
fi
```

**Example:**
```typescript
const result = await session_fork({
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
- Fork script must exist at `~/.iris/scripts/spawn.sh` (or `.bat`/`.ps1` on Windows)
- Script must be executable (`chmod +x ~/.iris/scripts/spawn.sh`)
- Session must exist (wake team first if needed)

---

#### 7. session_cancel

**Purpose:** Cancel a running session operation

**EXPERIMENTAL** - Attempts to interrupt a long-running Claude operation by sending ESC to stdin. May not work in all cases depending on headless mode support.

**Signature:**
```typescript
session_cancel(input: {
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
const result = await session_cancel({
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

### Process Management Tools

#### 8. team_wake

**Purpose:** Wake up a team by ensuring its process is active

Creates a session-specific process for conversation isolation. Returns immediately if team is already active, otherwise starts the process.

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

#### 9. team_launch

**Purpose:** Launch a team by ensuring its process is active

This is a convenience alias for `team_wake` that matches natural language like "launch team-X" or "start team-Y".

**Signature:**
```typescript
team_launch(input: {
  team: string;
  fromTeam: string;
}): Promise<WakeOutput>
```

**Example:**
```typescript
const result = await team_launch({
  team: "backend",
  fromTeam: "frontend"
});
// Identical behavior to team_wake
```

**Note:** Semantic alias for better natural language integration.

---

#### 10. team_sleep

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

#### 11. team_wake_all

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

#### 12. team_status

**Purpose:** Get the status of teams (awake/active or asleep/inactive)

Returns process details for active teams including PID, status, and session information. Optionally includes notification queue statistics.

**Signature:**
```typescript
team_status(input: {
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
const result = await team_status({
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
const result = await team_status({
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

### Information & Debug Tools

#### 13. session_report

**Purpose:** View the conversation history for a session

Returns complete conversation cache including all messages, responses, and protocol messages from Claude. Shows the full context of your communication with a team.

**Signature:**
```typescript
session_report(input: {
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
const result = await session_report({
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
- Check results from async `send_message` (timeout=-1)
- Debug empty responses
- View conversation history
- Monitor active operations

---

#### 14. list_teams

**Purpose:** List all configured teams

Returns team names with configuration details including path, description, color, and settings.

**Signature:**
```typescript
list_teams(): Promise<{
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
const result = await list_teams();

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

#### 15. get_logs

**Purpose:** Query in-memory logs from the Iris MCP server

Returns logs since a specified timestamp with optional filtering by level and format. Useful for debugging and monitoring server activity.

**Signature:**
```typescript
get_logs(input: {
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
const result = await get_logs({
  logs_since: Date.now() - 300000,
  level: "error",
  format: "parsed"
});

// Get all available stores
const stores = await get_logs({
  getAllStores: true
});
// stores = { stores: ["iris-mcp", "session-manager", "pool-manager"] }
```

---

#### 16. get_date

**Purpose:** Get the current system date and time

Returns timestamp in multiple formats: ISO 8601, UTC string, Unix timestamp, and detailed components (year, month, day, etc.).

**Signature:**
```typescript
get_date(): Promise<{
  timestamp: number;
  iso: string;
  utc: string;
  unix: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timezone: string;
}>
```

**Example:**
```typescript
const result = await get_date();

// result = {
//   timestamp: 1697567890123,
//   iso: "2025-01-15T10:30:00.123Z",
//   utc: "Tue, 15 Jan 2025 10:30:00 GMT",
//   unix: 1697567890,
//   year: 2025,
//   month: 1,
//   day: 15,
//   hour: 10,
//   minute: 30,
//   second: 0,
//   timezone: "UTC"
// }
```

---

### Internal Tools

#### 17. permissions__approve

**Purpose:** Permission approval handler for Claude Code's `--permission-prompt-tool`

This tool is called by Claude Code when it needs permission to use another tool. Auto-approves all Iris MCP tools (`mcp__iris__*`) and denies all others.

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
  tool_name: "mcp__iris__list_teams",
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

**Use Case:** Used by the permission approval system when `grantPermission: "ask"` mode is configured. See [PERMISSIONS.md](PERMISSIONS.md) for details.

**Note:** This is an internal tool primarily used by the permission system. Most users won't call this directly.

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
  const result = await send_message({
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
const result = await send_message({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "Please review PR #123: Add authentication middleware",
  timeout: 60000
});

console.log(result.response);
// "Reviewed PR #123. LGTM! Approved with minor suggestions."
```

### Asking Questions

```typescript
// Use ask_message for clarity of intent
const result = await ask_message({
  toTeam: "database",
  fromTeam: "api",
  message: "What's the optimal index configuration for the users table?"
});

console.log(result.response);
// Claude responds with database optimization advice
```

### Orchestrated Deployment

```typescript
// Wake all teams
await team_wake_all({ fromTeam: "orchestrator" });

// Tell each team to run tests
const frontendTests = await send_message({
  toTeam: "frontend",
  fromTeam: "orchestrator",
  message: "Run npm test"
});

const backendTests = await send_message({
  toTeam: "backend",
  fromTeam: "orchestrator",
  message: "Run pytest"
});

// Deploy if all pass
if (frontendTests.response?.includes("PASS") &&
    backendTests.response?.includes("PASS")) {
  await send_message({
    toTeam: "devops",
    fromTeam: "orchestrator",
    message: "Deploy to staging"
  });
}
```

### Async Task Processing

```typescript
// Start long-running task async
const task = await quick_message({
  toTeam: "data-pipeline",
  fromTeam: "analytics",
  message: "Generate annual report for 2024"
});

// Later, check cache for results
const cache = await session_report({
  team: "data-pipeline",
  fromTeam: "analytics"
});

console.log(cache.entries);
// Check for completed entries with results
```

### Session Cleanup Workflow

```typescript
// Session context too large? Reboot it
await session_reboot({
  toTeam: "backend",
  fromTeam: "frontend"
});

// Fresh start with clean slate
```

### Debug Workflow

```typescript
// Check if team is awake
const status = await team_status({
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
const logs = await get_logs({
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
    case "send_message":
    case "ask_message":
      return { content: [{ type: "text", text: JSON.stringify(
        await tell(args, iris), null, 2
      )}]};

    case "quick_message":
      return { content: [{ type: "text", text: JSON.stringify(
        await quickTell(args, iris), null, 2
      )}]};

    case "session_cancel":
      return { content: [{ type: "text", text: JSON.stringify(
        await cancel(args, processPool), null, 2
      )}]};

    case "session_reboot":
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

## Tech Writer Notes

**Coverage Areas:**
- MCP tool catalog and complete API reference
- Communication tools (send_message, ask_message, quick_message)
- Session management tools (session_reboot, session_delete, session_fork, session_cancel)
- Process management tools (team_wake, team_launch, team_sleep, team_wake_all, team_status)
- Information and debug tools (session_report, list_teams, get_logs, get_date)
- Internal tools (permissions__approve)
- Input validation patterns (validateTeamName, validateMessage, validateTimeout)
- Error handling and error types
- Usage examples and patterns
- Tool registration in mcp_server.ts

**Keywords:** MCP tools, actions, send_message, ask_message, quick_message, session_reboot, session_delete, session_fork, session_cancel, team_wake, team_launch, team_sleep, team_wake_all, team_status, session_report, list_teams, get_logs, get_date, permissions__approve, tool API, validation, error handling, cross-team communication, session management, process management

**Last Updated:** 2025-10-18
**Change Context:** Complete rewrite to reflect MCP tool renaming (team_tell → send_message, team_quick_tell → quick_message, team_reboot → session_reboot, team_delete → session_delete, team_fork → session_fork, team_isAwake → team_status, team_report → session_report, team_teams → list_teams, team_debug → get_logs, team_cancel → session_cancel). Added ask_message and team_launch as semantic aliases. Removed team_compact (incomplete implementation). Updated all examples, code snippets, and cross-references to use new naming convention.
**Related Files:** MCP_TOOLS.md (tool reference), CONFIG.md (configuration), PERMISSIONS.md (permission approval), CACHE.md (conversation cache), SESSION.md (session management)

---

**Document Version:** 3.0
**Last Updated:** 2025-10-18
**Iris MCP Version:** 0.0.1

**Breaking Changes from v2.0:**
- Renamed all MCP tools for better semantic clarity
- Removed `team_compact` (incomplete implementation)
- Added semantic aliases: `ask_message`, `team_launch`
- Updated all code examples and documentation
