# MCP Tools Documentation

**Location:** `src/actions/`
**Purpose:** MCP tool implementations for team coordination
**Protocol:** Model Context Protocol (MCP) specification-compliant

---

## Table of Contents

1. [Overview](#overview)
2. [Tool Catalog](#tool-catalog)
3. [Tool Implementations](#tool-implementations)
4. [Input Validation](#input-validation)
5. [Error Handling](#error-handling)
6. [Usage Examples](#usage-examples)

---

## Overview

Iris exposes **10 MCP tools** that enable Claude instances to coordinate across projects:

**Core Communication:**
- `team_tell` - Send messages between teams

**Process Management:**
- `team_wake` - Start a team's Claude process
- `team_sleep` - Stop a team's Claude process
- `team_wake_all` - Start all team processes
- `team_isAwake` - Check team process status

**Cache Inspection:**
- `team_cache_read` - Read conversation cache
- `team_cache_clear` - Clear conversation cache

**System Queries:**
- `team_report` - View process output
- `team_getTeamName` - Identify team from path
- `team_teams` - List all configured teams

---

## Tool Catalog

| Tool | Purpose | Blocking? | Parameters |
|------|---------|-----------|------------|
| `team_tell` | Send message to team | Optional | toTeam, message, fromTeam, timeout?, waitForResponse? |
| `team_isAwake` | Check if team is active | Yes | team?, includeNotifications? |
| `team_wake` | Wake up team process | Yes | team, fromTeam, clearCache? |
| `team_sleep` | Put team to sleep | Yes | team, fromTeam, force? |
| `team_wake_all` | Wake all teams | Yes | fromTeam, parallel? |
| `team_report` | View process output | Yes | team, fromTeam |
| `team_cache_read` | Inspect cache | Yes | sessionId, includeMessages?, messageCount?, format?, includeProtocolMessages? |
| `team_cache_clear` | Clear cache | Yes | sessionId, fromTeam |
| `team_getTeamName` | Identify team | Yes | pwd |
| `team_teams` | List all teams | Yes | includeProcessDetails? |

---

## Tool Implementations

### 1. team_tell

**Purpose:** Send a message to another team (core coordination primitive)

**Signature:**
```typescript
team_tell(input: {
  toTeam: string;
  message: string;
  fromTeam: string;
  waitForResponse?: boolean;  // default: true
  timeout?: number;            // default: 30000ms
}): Promise<{
  from?: string;
  to: string;
  message: string;
  response?: string;
  duration?: number;
  timestamp: number;
  async: boolean;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `toTeam` | string | Yes | Target team name |
| `message` | string | Yes | Message content (max 100KB) |
| `fromTeam` | string | Yes | Calling team name |
| `waitForResponse` | boolean | No | Wait for response (default: true) |
| `timeout` | number | No | Timeout in ms (default: 30000) |

**Modes:**

**Synchronous (waitForResponse=true):**
```typescript
const result = await team_tell({
  toTeam: "backend",
  message: "What's the API status?",
  waitForResponse: true,
  timeout: 30000
});

// result.response = "All APIs operational"
// result.duration = 2500
```

**Asynchronous (waitForResponse=false):**
```typescript
const result = await team_tell({
  toTeam: "backend",
  message: "Generate full audit report",
  waitForResponse: false  // Fire and forget
});

// result.async = true
// Process continues in background
```

**Workflow:**
```
team_tell()
  │
  ├─► Validate inputs (team name, message length)
  │
  ├─► Convert waitForResponse to timeout
  │   • waitForResponse=true → timeout=N
  │   • waitForResponse=false → timeout=-1 (async)
  │
  ├─► Call iris.sendMessage(fromTeam, toTeam, message, { timeout })
  │
  └─► Format response based on result type
      • String → Successful completion
      • Object with status="async" → Async mode
      • Object with status="busy" → Team busy
      • Object with status="mcp_timeout" → Caller timeout
```

---

### 2. team_isAwake

**Purpose:** Check if one or all teams are active (have running processes)

**Signature:**
```typescript
team_isAwake(input: {
  team?: string;
  includeNotifications?: boolean;
}): Promise<{
  team?: string;
  awake: boolean;
  teams?: Array<{
    name: string;
    awake: boolean;
    pid?: number;
    sessionId?: string;
  }>;
  timestamp: number;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `team` | string | No | Specific team (omit for all teams) |
| `includeNotifications` | boolean | No | Include notification stats (default: true) |

**Single Team Check:**
```typescript
const result = await team_isAwake({ team: "frontend" });

// result = {
//   team: "frontend",
//   awake: true,
//   timestamp: 1697567890123
// }
```

**All Teams Check:**
```typescript
const result = await team_isAwake({});

// result = {
//   teams: [
//     { name: "frontend", awake: true, pid: 12345, sessionId: "abc..." },
//     { name: "backend", awake: false },
//     { name: "mobile", awake: true, pid: 67890, sessionId: "def..." }
//   ],
//   timestamp: 1697567890123
// }
```

**Implementation:**
```typescript
// Single team
const process = processPool.getProcessBySessionId(sessionId);
if (!process) return { awake: false };

const metrics = process.getBasicMetrics();
return { awake: metrics.isReady && !metrics.isBusy };

// All teams
for each team:
  check if process exists and is ready
```

---

### 3. team_wake

**Purpose:** Ensure a team's process is running (spawn if needed)

**Signature:**
```typescript
team_wake(input: {
  team: string;
  fromTeam: string;
  clearCache?: boolean;
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

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `team` | string | Yes | Team to wake up |
| `fromTeam` | string | Yes | Calling team (for session-specific process) |
| `clearCache` | boolean | No | Clear output cache (default: true) |

**Example:**
```typescript
const result = await team_wake({ team: "data-pipeline" });

// If already awake:
// result = { status: "awake", pid: 12345, ... }

// If waking up:
// result = { status: "waking", message: "Team ... is waking up", ... }
```

**Workflow:**
```
team_wake()
  │
  ├─► Check if process already exists
  │   └─► YES → Return { status: "awake", pid, ... }
  │
  └─► NO → Spawn new process
      ├─► Get/create session (sessionManager)
      ├─► Spawn process (processPool.getOrCreateProcess)
      └─► Return { status: "waking", message, ... }
```

---

### 4. team_sleep

**Purpose:** Terminate a team's process (free resources)

**Signature:**
```typescript
team_sleep(input: {
  team: string;
  fromTeam: string;
  force?: boolean;
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
| `force` | boolean | No | Force termination (default: false) |

**Example:**
```typescript
const result = await team_sleep({ team: "staging" });

// result = {
//   team: "staging",
//   status: "asleep",
//   message: "Team staging has been put to sleep",
//   duration: 150,
//   timestamp: 1697567890123
// }
```

**Force vs Graceful:**
- `force=false`: SIGTERM (graceful, 5s timeout)
- `force=true`: SIGKILL (immediate)

---

### 5. team_wake_all

**Purpose:** Wake up all configured teams

**Signature:**
```typescript
team_wake_all(input: {
  fromTeam: string;
  parallel?: boolean;
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

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `fromTeam` | string | Yes | Calling team |
| `parallel` | boolean | No | Wake in parallel (NOT RECOMMENDED) |

**Warning:** `parallel=true` is unstable! Spawning multiple Claude instances simultaneously causes timeouts. Use `parallel=false` (default) for sequential waking.

**Example:**
```typescript
const result = await team_wake_all({});

// result = {
//   results: [
//     { team: "frontend", success: true, status: "waking" },
//     { team: "backend", success: true, status: "awake" },
//     { team: "mobile", success: false, error: "Spawn timeout" }
//   ],
//   totalTeams: 3,
//   successCount: 2,
//   failureCount: 1,
//   duration: 45000,
//   timestamp: 1697567890123
// }
```

---

### 6. team_report

**Purpose:** View stdout/stderr output cache for a team

**Signature:**
```typescript
team_report(input: {
  team: string;
  fromTeam: string;
}): Promise<{
  team: string;
  output: string;
  timestamp: number;
}>
```

**Note:** In the refactored architecture, this tool is less relevant since output goes to cache entries via RxJS. May be deprecated in future.

---

### 7. team_cache_read

**Purpose:** Inspect conversation cache for a session

**Signature:**
```typescript
team_cache_read(input: {
  sessionId: string;
  includeMessages?: boolean;
  messageCount?: number;
  format?: "json" | "text";
  includeProtocolMessages?: boolean;
}): Promise<{
  sessionId: string;
  entries: Array<{
    type: "SPAWN" | "TELL";
    status: "active" | "completed" | "terminated";
    messageCount: number;
    messages?: CacheMessage[];
  }>;
  stats: {
    totalEntries: number;
    activeEntries: number;
    completedEntries: number;
  };
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | string | Yes | Session identifier |
| `includeMessages` | boolean | No | Include message history (default: true) |
| `messageCount` | number | No | Limit messages per entry (default: 10, max: 100) |
| `format` | string | No | "json" or "text" (default: "json") |
| `includeProtocolMessages` | boolean | No | Include raw protocol (default: false) |

**Example:**
```typescript
const result = await team_cache_read({
  sessionId: "abc123-...",
  includeMessages: true,
  messageCount: 5
});

// result = {
//   sessionId: "abc123-...",
//   entries: [
//     {
//       type: "SPAWN",
//       status: "completed",
//       messageCount: 3,
//       messages: [
//         { timestamp: 123, type: "system", data: {...} },
//         { timestamp: 124, type: "assistant", data: {...} },
//         { timestamp: 125, type: "result", data: {...} }
//       ]
//     },
//     {
//       type: "TELL",
//       status: "active",
//       messageCount: 10,
//       messages: [...]
//     }
//   ],
//   stats: { totalEntries: 2, activeEntries: 1, completedEntries: 1 }
// }
```

**Use Cases:**
- Debug empty responses
- Inspect partial results after timeout
- Analyze conversation history

---

### 8. team_cache_clear

**Purpose:** Clear conversation cache for a session

**Signature:**
```typescript
team_cache_clear(input: {
  sessionId: string;
  fromTeam: string;
}): Promise<{
  success: boolean;
  sessionId: string;
  message: string;
  timestamp: number;
}>
```

**Example:**
```typescript
const result = await team_cache_clear({ sessionId: "abc123-..." });

// result = {
//   success: true,
//   sessionId: "abc123-...",
//   message: "Cache cleared successfully",
//   timestamp: 1697567890123
// }
```

**Warning:** Clears ALL cache entries for the session. Irreversible.

---

### 9. team_getTeamName

**Purpose:** Identify which team a directory path belongs to

**Signature:**
```typescript
team_getTeamName(input: {
  pwd: string;
}): Promise<{
  found: boolean;
  teamName?: string;
  path?: string;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pwd` | string | Yes | Absolute path (from `process.cwd()`) |

**Example:**
```typescript
const result = await team_getTeamName({
  pwd: "/Users/jenova/projects/frontend"
});

// result = {
//   found: true,
//   teamName: "frontend",
//   path: "/Users/jenova/projects/frontend"
// }
```

**Use Case:** Claude instances can identify their own team name automatically

**Limitation:** Only works with absolute paths in config. Relative paths cannot be identified.

---

### 10. team_teams

**Purpose:** List all configured teams and their status

**Signature:**
```typescript
team_teams(input: {
  includeProcessDetails?: boolean;
}): Promise<{
  teams: Array<{
    name: string;
    status: "awake" | "asleep";
    config: {
      path: string;
      description?: string;
      color?: string;
      idleTimeout?: number;
      skipPermissions?: boolean;
    };
    process?: {
      pid: number;
      sessionId: string;
      messageCount: number;
      lastActivity: number;
    };
  }>;
  totalTeams: number;
  awakeTeams: number;
  asleepTeams: number;
  timestamp: number;
}>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `includeProcessDetails` | boolean | No | Include process info (default: false) |

**Example:**
```typescript
const result = await team_teams({ includeProcessDetails: true });

// result = {
//   teams: [
//     {
//       name: "frontend",
//       status: "awake",
//       config: {
//         path: "/Users/jenova/projects/frontend",
//         description: "Frontend team",
//         color: "#FF6B9D",
//         skipPermissions: true
//       },
//       process: {
//         pid: 12345,
//         sessionId: "abc123-...",
//         messageCount: 42,
//         lastActivity: 1697567890000
//       }
//     },
//     {
//       name: "backend",
//       status: "asleep",
//       config: {
//         path: "/Users/jenova/projects/backend",
//         description: "Backend services"
//       }
//     }
//   ],
//   totalTeams: 2,
//   awakeTeams: 1,
//   asleepTeams: 1,
//   timestamp: 1697567890123
// }
```

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

  // Range: 1s to 1hr
  if (timeout < 1000 || timeout > 3600000) {
    throw new ValidationError("Timeout must be between 1s and 1hr");
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
  "error": "ProcessBusyError",
  "message": "Process already processing another request"
}

// Timeout errors
{
  "error": "TimeoutError",
  "message": "Operation timed out after 30000ms"
}
```

**Error Propagation:**

```typescript
try {
  const result = await team_tell({ toTeam: "invalid/team", message: "hi" });
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
  message: "Please review PR #123: Add authentication middleware"
});

console.log(result.response);
// "Reviewed PR #123. LGTM! Approved with minor suggestions."
```

### Orchestrated Deployment

```typescript
// Wake all teams
await team_wake_all({});

// Tell each team to run tests
const frontendTests = await team_tell({
  toTeam: "frontend",
  message: "Run npm test"
});

const backendTests = await team_tell({
  toTeam: "backend",
  message: "Run pytest"
});

// Deploy if all pass
if (frontendTests.response.includes("PASS") &&
    backendTests.response.includes("PASS")) {
  await team_tell({
    toTeam: "devops",
    message: "Deploy to staging"
  });
}
```

### Async Task Processing

```typescript
// Start long-running task async
const task = await team_tell({
  toTeam: "data-pipeline",
  message: "Generate annual report for 2024",
  waitForResponse: false  // Don't wait
});

console.log(task.async); // true

// Later, check cache for results
const cache = await team_cache_read({ sessionId: task.sessionId });
```

---

## Tool Registration

Tools are registered in `src/index.ts`:

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "team_tell":
      return { content: [{ type: "text", text: JSON.stringify(await tell(args, iris)) }] };

    case "team_isAwake":
      return { content: [{ type: "text", text: JSON.stringify(await isAwake(args, iris, processPool)) }] };

    case "team_wake":
      return { content: [{ type: "text", text: JSON.stringify(await wake(args, iris, processPool, sessionManager)) }] };

    // ... rest of tools

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});
```

---

**Document Version:** 1.0
**Last Updated:** October 2025
