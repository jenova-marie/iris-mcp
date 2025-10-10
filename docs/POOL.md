# Process Pool Architecture

**Last Updated**: 2025-10-10
**Current Phase**: Phase 1 (Post-Refactor)

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Pool Key System](#pool-key-system)
4. [LRU Eviction Strategy](#lru-eviction-strategy)
5. [Process Lifecycle Management](#process-lifecycle-management)
6. [Session Mapping](#session-mapping)
7. [Health Checks](#health-checks)
8. [Event System](#event-system)
9. [Core Methods](#core-methods)
10. [Integration with IrisOrchestrator](#integration-with-irisorchestrator)
11. [Performance Characteristics](#performance-characteristics)
12. [Configuration](#configuration)
13. [Monitoring and Observability](#monitoring-and-observability)
14. [Error Handling](#error-handling)
15. [Testing Strategy](#testing-strategy)
16. [Common Issues and Solutions](#common-issues-and-solutions)
17. [Future Enhancements](#future-enhancements)

---

## Overview

The `ClaudeProcessPool` is the **process lifecycle manager** that maintains a pool of running Claude Code processes with intelligent resource management through LRU (Least Recently Used) eviction.

**Location**: `src/process-pool/pool-manager.ts`

**Core Responsibilities**:
- ✅ Spawn and manage Claude processes
- ✅ Pool processes for reuse (warm starts)
- ✅ LRU eviction when pool reaches capacity
- ✅ Health monitoring of running processes
- ✅ Event forwarding for observability
- ✅ Session-to-process mapping

**NOT Responsible For**:
- ❌ Session database management
- ❌ Session file creation
- ❌ Session lookup or storage

---

## Architecture

### Three-Layer Integration

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
│Get sessionId │  │Create process       │
│              │  │with sessionId       │
└──────────────┘  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ClaudeProcess        │
                  │Instance per team    │
                  │pair                 │
                  └─────────────────────┘
```

### Key Architectural Principle

**PoolManager requires sessionId as a parameter** - it does NOT look up sessions. This enforces clean separation:

```typescript
// WRONG - PoolManager doesn't do session lookup
await pool.getOrCreateProcess("backend");

// CORRECT - Caller provides sessionId
const session = await sessionManager.getOrCreateSession(fromTeam, toTeam);
await pool.getOrCreateProcess(toTeam, session.sessionId, fromTeam);
```

---

## Pool Key System

### Pool Key Format

**Format**: `"fromTeam->toTeam"` or `"external->toTeam"`

**Generator Method**:
```typescript
private getPoolKey(fromTeam: string | null, toTeam: string): string {
  return `${fromTeam ?? 'external'}->${toTeam}`;
}
```

### Examples

| fromTeam | toTeam | Pool Key |
|----------|--------|----------|
| `"frontend"` | `"backend"` | `"frontend->backend"` |
| `null` | `"backend"` | `"external->backend"` |
| `"mobile"` | `"api"` | `"mobile->api"` |
| `"backend"` | `"frontend"` | `"backend->frontend"` |

### Why Pool Keys Matter

**1. Directional Isolation**:
- `frontend→backend` gets its own process
- `backend→frontend` gets a DIFFERENT process
- Each direction maintains independent context

**2. Process Reuse**:
```typescript
// First call: Creates new process
await pool.getOrCreateProcess("backend", sessionId1, "frontend");
// Pool key: "frontend->backend"

// Second call from same pair: Reuses process
await pool.getOrCreateProcess("backend", sessionId1, "frontend");
// Pool key: "frontend->backend" (same!) → returns existing process
```

**3. LRU Tracking**:
```typescript
this.accessOrder = [
  "external->backend",
  "frontend->api",
  "mobile->backend",
  "frontend->backend"  // Most recently used (last)
];
```

---

## LRU Eviction Strategy

### The Problem

With limited resources, we can't keep all processes running forever. Need to decide which process to terminate when pool is full.

### LRU Solution

**Principle**: Evict the **Least Recently Used** process to make room for new ones.

**Why LRU?**
- ✅ Hot paths stay warm (frequently used processes remain pooled)
- ✅ Predictable performance for active team pairs
- ✅ Automatic cleanup of stale processes
- ✅ Fair resource distribution

### Access Order Tracking

**Data Structure**:
```typescript
private accessOrder: string[] = [];  // FIFO queue of pool keys
```

**Invariant**: Most recently accessed process is at the **end** of the array.

**Example Evolution**:
```typescript
// Initial state
accessOrder = [];

// Access 1: external->backend
accessOrder = ["external->backend"];

// Access 2: frontend->api
accessOrder = ["external->backend", "frontend->api"];

// Access 3: external->backend (again)
// Remove from current position, add to end
accessOrder = ["frontend->api", "external->backend"];

// Access 4: mobile->backend
accessOrder = ["frontend->api", "external->backend", "mobile->backend"];
```

**Head of array** = Least recently used (eviction candidate)
**Tail of array** = Most recently used (protected)

### Update Logic

**Method**: `updateAccessOrder(poolKey: string)`

```typescript
private updateAccessOrder(poolKey: string): void {
  // Remove if exists (O(n) scan, then O(n) splice)
  const index = this.accessOrder.indexOf(poolKey);
  if (index > -1) {
    this.accessOrder.splice(index, 1);
  }

  // Add to end (most recently used)
  this.accessOrder.push(poolKey);
}
```

**Called When**:
- Process accessed via `getOrCreateProcess()`
- Message sent to process
- Process created

### Eviction Logic

**Method**: `evictLRU()`

```typescript
private async evictLRU(): Promise<void> {
  if (this.accessOrder.length === 0) {
    throw new ProcessPoolLimitError(this.config.maxProcesses);
  }

  // Strategy 1: Find first IDLE process
  let victimIndex = -1;
  for (let i = 0; i < this.accessOrder.length; i++) {
    const poolKey = this.accessOrder[i];
    const process = this.processes.get(poolKey);

    if (process && process.getMetrics().status === 'idle') {
      victimIndex = i;
      break;
    }
  }

  // Strategy 2: All busy? Evict oldest anyway
  if (victimIndex === -1) {
    victimIndex = 0;  // Least recently used
  }

  const victimKey = this.accessOrder[victimIndex];
  this.logger.info('Evicting LRU process', { poolKey: victimKey });

  await this.terminateProcess(victimKey);
}
```

**Two-Phase Eviction**:

1. **Prefer idle processes**: Don't kill actively processing messages
2. **Fallback to LRU**: If all processes busy, evict least recently used

**Example Scenario**:
```
Pool Limit: 3 processes
Current Pool:
  [0] "frontend->api"    (idle,      last used: 2min ago)  ← LRU candidate
  [1] "mobile->backend"  (processing, last used: 1min ago)
  [2] "external->api"    (idle,       last used: 30s ago)

New request: "backend->frontend"

Eviction Decision:
  1. Check [0]: idle ✓ → EVICT "frontend->api"
  2. Terminate process
  3. Remove from pool
  4. Create "backend->frontend"
```

### Performance Characteristics

**Access update**: O(n) where n = pool size
- For 10 processes: ~10 array operations
- Negligible compared to process spawn time

**Eviction**: O(n) scan + O(1) terminate
- For 10 processes: ~10 comparisons
- Termination: ~1-5 seconds (graceful shutdown)

**Optimization Opportunity** (Future): Use linked list for O(1) access updates

---

## Process Lifecycle Management

### Constructor

```typescript
constructor(
  private configManager: TeamsConfigManager,
  private config: ProcessPoolConfig,
)
```

**Parameters**:
- `configManager`: Access to `teams.json` configuration
- `config`: Pool settings (maxProcesses, healthCheckInterval, idleTimeout)

**Initialization**:
```typescript
super();  // EventEmitter
this.startHealthCheck();  // Begin periodic health monitoring
```

### Core Method: `getOrCreateProcess()`

**Signature**:
```typescript
async getOrCreateProcess(
  teamName: string,
  sessionId: string,
  fromTeam: string | null = null,
): Promise<ClaudeProcess>
```

**Complete Flow**:

#### 1. Validate Team Exists

```typescript
const teamConfig = this.configManager.getTeamConfig(teamName);
if (!teamConfig) {
  throw new TeamNotFoundError(teamName);
}
```

**Throws**: `TeamNotFoundError` if team not in `teams.json`

#### 2. Generate Pool Key

```typescript
const poolKey = this.getPoolKey(fromTeam, teamName);
// Example: "frontend->backend"
```

#### 3. Update Access Order

```typescript
this.updateAccessOrder(poolKey);
// Marks this pool key as "most recently used"
```

**Important**: Updated BEFORE checking if process exists, so LRU is accurate even for cache hits.

#### 4. Check for Existing Process

```typescript
const existing = this.processes.get(poolKey);
if (existing && existing.getMetrics().status !== "stopped") {
  this.logger.debug("Using existing process", { poolKey, sessionId });
  return existing;  // Warm start!
}
```

**Cache Hit** = Process already running and healthy

#### 5. Check Pool Limit

```typescript
if (this.processes.size >= this.config.maxProcesses) {
  await this.evictLRU();  // Make room
}
```

**Eviction triggered**: When pool is full (default: 10 processes)

#### 6. Create New Process

```typescript
const process = new ClaudeProcess(
  teamName,
  teamConfig,
  teamConfig.idleTimeout || this.config.idleTimeout,
  sessionId,  // CRITICAL: Pass sessionId for --resume
);
```

**Process configured with**:
- Team name (for logging)
- Team config (path, permissions, etc.)
- Idle timeout (5 minutes default)
- Session ID (for `--resume` flag)

#### 7. Set Up Event Forwarding

```typescript
process.on("spawned", (data) => this.emit("process-spawned", data));

process.on("terminated", (data) => {
  this.emit("process-terminated", data);
  this.processes.delete(poolKey);
  this.sessionToProcess.delete(sessionId);
  this.removeFromAccessOrder(poolKey);
});

process.on("exited", (data) => {
  this.emit("process-exited", data);
  this.processes.delete(poolKey);
  this.sessionToProcess.delete(sessionId);
  this.removeFromAccessOrder(poolKey);
});

process.on("error", (data) => this.emit("process-error", data));
process.on("message-sent", (data) => this.emit("message-sent", data));
process.on("message-response", (data) => this.emit("message-response", data));
```

**Event Forwarding**: All ClaudeProcess events bubble up to PoolManager for centralized monitoring.

**Cleanup on Exit/Terminate**:
- Remove from processes map
- Remove session mapping
- Remove from access order

#### 8. Spawn the Process

```typescript
await process.spawn();
// Runs: claude --resume {sessionId} --print --output-format stream-json
```

**Async**: Waits for `system/init` message before resolving

#### 9. Add to Pool

```typescript
this.processes.set(poolKey, process);
this.sessionToProcess.set(sessionId, poolKey);
this.updateAccessOrder(poolKey);  // Mark as most recently used

return process;
```

**State Updated**:
- Process added to pool map
- Session ID mapped to pool key
- Access order updated (LRU tracking)

### Method: `sendMessage()`

**Signature**:
```typescript
async sendMessage(
  teamName: string,
  sessionId: string,
  message: string,
  timeout?: number,
  fromTeam: string | null = null,
): Promise<string>
```

**Convenience wrapper**:
```typescript
const process = await this.getOrCreateProcess(teamName, sessionId, fromTeam);
return process.sendMessage(message, timeout);
```

**Why it exists**: Simplifies caller code by combining get/create + send into one call.

### Method: `terminateProcess()`

**Signature**:
```typescript
async terminateProcess(poolKey: string): Promise<void>
```

**Process**:
```typescript
const process = this.processes.get(poolKey);
if (process) {
  await process.terminate();  // Graceful SIGTERM, then SIGKILL after 5s
  this.processes.delete(poolKey);
  this.removeFromAccessOrder(poolKey);
}
```

**Graceful Shutdown**: Calls `ClaudeProcess.terminate()` which sends SIGTERM first.

**Cleanup**: Removes from pool and access order (session mapping cleaned by event handler).

### Method: `terminateAll()`

**Signature**:
```typescript
async terminateAll(): Promise<void>
```

**Use Cases**:
- Server shutdown
- Configuration reload
- Emergency cleanup

**Process**:
```typescript
this.logger.info('Terminating all processes');

// Parallel termination for speed
const promises: Promise<void>[] = [];
for (const [poolKey, process] of this.processes) {
  promises.push(process.terminate());
}

await Promise.all(promises);

// Clear all state
this.processes.clear();
this.sessionToProcess.clear();
this.accessOrder = [];

// Stop health checks
if (this.healthCheckInterval) {
  clearInterval(this.healthCheckInterval);
  this.healthCheckInterval = null;
}
```

**Parallel**: All processes terminated concurrently (faster shutdown).

---

## Session Mapping

### Two-Way Mapping

**1. Pool Key → Process**:
```typescript
private processes = new Map<string, ClaudeProcess>();
// "frontend->backend" → ClaudeProcess instance
```

**2. Session ID → Pool Key**:
```typescript
private sessionToProcess = new Map<string, string>();
// "abc-123-session-uuid" → "frontend->backend"
```

### Why Two Maps?

**Scenario 1**: Caller has pool key (fromTeam + toTeam)
```typescript
const process = this.processes.get("frontend->backend");
```

**Scenario 2**: Caller has session ID (from database or request)
```typescript
const poolKey = this.sessionToProcess.get(sessionId);
const process = this.processes.get(poolKey);
```

### Method: `getProcessBySessionId()`

**Signature**:
```typescript
getProcessBySessionId(sessionId: string): ClaudeProcess | undefined
```

**Implementation**:
```typescript
const poolKey = this.sessionToProcess.get(sessionId);
if (!poolKey) return undefined;
return this.processes.get(poolKey);
```

**Use Cases**:
- Session compaction: `sendCommandToSession(sessionId, "/compact")`
- Session-specific metrics
- Debugging: "Which process is handling session X?"

### Synchronization

**Added**: When process created
```typescript
this.processes.set(poolKey, process);
this.sessionToProcess.set(sessionId, poolKey);
```

**Removed**: On process exit/termination
```typescript
process.on("terminated", (data) => {
  this.processes.delete(poolKey);
  this.sessionToProcess.delete(sessionId);
  this.removeFromAccessOrder(poolKey);
});
```

**Invariant**: Every entry in `sessionToProcess` has a corresponding entry in `processes` (and vice versa for active processes).

---

## Health Checks

### Purpose

Periodically scan all processes to:
- ✅ Remove stopped processes from pool
- ✅ Log process metrics for monitoring
- ✅ Emit health-check events for external monitoring

### Configuration

**Interval**: Configurable via `config.healthCheckInterval`

**Default**: 30 seconds (30000ms)

**teams.json**:
```json
{
  "settings": {
    "healthCheckInterval": 30000
  }
}
```

### Initialization

**Method**: `startHealthCheck()`

```typescript
private startHealthCheck(): void {
  this.healthCheckInterval = setInterval(() => {
    this.performHealthCheck();
  }, this.config.healthCheckInterval);
}
```

**Called**: In constructor (starts immediately on pool creation)

### Health Check Logic

**Method**: `performHealthCheck()`

```typescript
private performHealthCheck(): void {
  const processesToRemove: string[] = [];

  // Scan all processes
  for (const [poolKey, process] of this.processes) {
    const metrics = process.getMetrics();

    // Remove stopped processes
    if (metrics.status === 'stopped') {
      processesToRemove.push(poolKey);
      continue;
    }

    // Log metrics
    this.logger.debug('Process health check', {
      poolKey,
      status: metrics.status,
      messagesProcessed: metrics.messagesProcessed,
      uptime: metrics.uptime,
      queueLength: metrics.queueLength,
    });
  }

  // Clean up stopped processes
  for (const poolKey of processesToRemove) {
    this.logger.info('Removing stopped process from pool', { poolKey });
    this.processes.delete(poolKey);
    this.removeFromAccessOrder(poolKey);
    // Note: sessionToProcess cleaned by exit event handler
  }

  // Emit health check event
  this.emit('health-check', this.getStatus());
}
```

### Health Check Metrics

**Per Process**:
```typescript
{
  poolKey: "frontend->backend",
  status: "idle" | "processing" | "spawning" | "stopped" | "terminating",
  messagesProcessed: 42,
  uptime: 125000,  // ms
  queueLength: 0,  // pending messages
}
```

### Health Check Events

**Event**: `health-check`

**Payload**: Complete pool status (see `getStatus()` section)

**Listeners** (Future):
- Dashboard (Phase 2) for real-time monitoring
- Prometheus exporter for metrics
- Alert system for process failures

---

## Event System

### Events Emitted by PoolManager

**1. `process-spawned`**

**When**: ClaudeProcess successfully spawns

**Payload**:
```typescript
{
  teamName: string;
  pid: number;
}
```

**2. `process-terminated`**

**When**: Process gracefully shuts down via `terminate()`

**Payload**:
```typescript
{
  teamName: string;
}
```

**3. `process-exited`**

**When**: Process exits unexpectedly (crash, kill, error)

**Payload**:
```typescript
{
  teamName: string;
  code: number | null;
  signal: string | null;
}
```

**4. `process-error`**

**When**: Process encounters error

**Payload**:
```typescript
{
  teamName: string;
  error: Error;
}
```

**5. `message-sent`**

**When**: Message written to process stdin

**Payload**:
```typescript
{
  teamName: string;
  message: string;
}
```

**6. `message-response`**

**When**: Response received from process

**Payload**:
```typescript
{
  teamName: string;
  response: string;
}
```

**7. `health-check`**

**When**: Periodic health check completes (every 30s)

**Payload**: `ProcessPoolStatus` object

### Event Forwarding Pattern

**All ClaudeProcess events are forwarded to PoolManager**:

```typescript
process.on("spawned", (data) => this.emit("process-spawned", data));
process.on("terminated", (data) => this.emit("process-terminated", data));
process.on("exited", (data) => this.emit("process-exited", data));
process.on("error", (data) => this.emit("process-error", data));
process.on("message-sent", (data) => this.emit("message-sent", data));
process.on("message-response", (data) => this.emit("message-response", data));
```

**Why Forward?** Centralized event monitoring - listeners don't need to track individual processes.

### Event Usage Examples

**Example 1: Logging**
```typescript
pool.on("process-spawned", ({ teamName, pid }) => {
  console.log(`✅ Process spawned for ${teamName} (PID: ${pid})`);
});

pool.on("process-exited", ({ teamName, code, signal }) => {
  console.error(`❌ Process crashed: ${teamName} (code: ${code}, signal: ${signal})`);
});
```

**Example 2: Metrics Collection**
```typescript
pool.on("message-response", ({ teamName, response }) => {
  metrics.recordMessageSize(teamName, response.length);
});

pool.on("health-check", (status) => {
  metrics.recordPoolSize(status.totalProcesses);
  metrics.recordActiveSessions(status.activeSessions);
});
```

**Example 3: Alerting**
```typescript
pool.on("process-error", ({ teamName, error }) => {
  if (error.message.includes("ENOSPC")) {
    alerts.send("Disk space full on process", { teamName });
  }
});
```

---

## Core Methods

### Method: `getStatus()`

**Purpose**: Get complete snapshot of pool state for monitoring.

**Signature**:
```typescript
getStatus(): ProcessPoolStatus
```

**Return Type**:
```typescript
interface ProcessPoolStatus {
  totalProcesses: number;    // Current pool size
  maxProcesses: number;       // Pool capacity
  processes: Record<string, ProcessStatusInfo>;
  activeSessions: number;     // Number of session mappings
}

interface ProcessStatusInfo {
  pid?: number;
  status: ProcessStatus;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  idleTimeRemaining: number;
  queueLength: number;
  sessionId?: string;         // Associated session UUID
  poolKey: string;            // Pool key for this process
}
```

**Implementation**:
```typescript
getStatus(): ProcessPoolStatus {
  const processes: Record<string, any> = {};

  for (const [poolKey, process] of this.processes) {
    const metrics = process.getMetrics();

    // Reverse lookup: Find session ID for this pool key
    let sessionId: string | undefined;
    for (const [sid, pk] of this.sessionToProcess) {
      if (pk === poolKey) {
        sessionId = sid;
        break;
      }
    }

    processes[poolKey] = {
      ...metrics,
      sessionId,
      poolKey,
    };
  }

  return {
    totalProcesses: this.processes.size,
    maxProcesses: this.config.maxProcesses,
    processes,
    activeSessions: this.sessionToProcess.size,
  };
}
```

**Example Output**:
```json
{
  "totalProcesses": 3,
  "maxProcesses": 10,
  "activeSessions": 3,
  "processes": {
    "frontend->backend": {
      "pid": 12345,
      "status": "idle",
      "messagesProcessed": 42,
      "lastUsed": 1704850200000,
      "uptime": 125000,
      "idleTimeRemaining": 175000,
      "queueLength": 0,
      "sessionId": "abc-123-uuid",
      "poolKey": "frontend->backend"
    },
    "external->api": {
      "pid": 12346,
      "status": "processing",
      "messagesProcessed": 15,
      "lastUsed": 1704850220000,
      "uptime": 45000,
      "idleTimeRemaining": 255000,
      "queueLength": 2,
      "sessionId": "def-456-uuid",
      "poolKey": "external->api"
    }
  }
}
```

### Method: `sendCommandToSession()`

**Purpose**: Send special commands (like `/compact`) to a running process.

**Signature**:
```typescript
async sendCommandToSession(
  sessionId: string,
  command: string
): Promise<string | null>
```

**Use Cases**:
- Session compaction: `/compact`
- Session inspection: `/history`
- Configuration: `/set-model <model>`

**Implementation**:
```typescript
async sendCommandToSession(sessionId: string, command: string): Promise<string | null> {
  const process = this.getProcessBySessionId(sessionId);
  if (!process) {
    this.logger.warn("No process found for session", { sessionId });
    return null;
  }

  try {
    const response = await process.sendMessage(command);
    this.logger.info("Command sent to session", { sessionId, command });
    return response;
  } catch (error) {
    this.logger.error("Failed to send command to session", {
      sessionId,
      command,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

**Returns**:
- `string`: Command response
- `null`: No process found for session ID

**Example**:
```typescript
// Compact a specific session
const result = await pool.sendCommandToSession(
  "abc-123-uuid",
  "/compact"
);

if (result) {
  console.log("Compaction result:", result);
} else {
  console.log("No active process for this session");
}
```

### Method: `getProcess()` (Deprecated)

**Signature**:
```typescript
getProcess(teamName: string): ClaudeProcess | undefined
```

**Why Deprecated**: Ambiguous - which pool key for this team?

**Replacement**: Use `getProcessBySessionId()` or `getOrCreateProcess()`

**Implementation** (for backward compatibility):
```typescript
getProcess(teamName: string): ClaudeProcess | undefined {
  // Try to find by team name in any pool key
  for (const [poolKey, process] of this.processes) {
    if (poolKey.endsWith(`->${teamName}`)) {
      return process;
    }
  }
  return undefined;
}
```

**Problem**: Returns first match, but multiple pool keys could match:
- `frontend->backend`
- `mobile->backend`
- `external->backend`

**Better Approach**: Use explicit pool key or session ID.

---

## Integration with IrisOrchestrator

### Complete Message Flow

**User Request**: "Ask backend team about API design"

#### 1. IrisOrchestrator.ask()

```typescript
async ask(fromTeam, toTeam, question, timeout) {
  // Step 1: Get session from SessionManager
  const session = await this.sessionManager.getOrCreateSession(fromTeam, toTeam);
  // session.sessionId = "abc-123-uuid"

  // Step 2: Get process from PoolManager
  const process = await this.processPool.getOrCreateProcess(
    toTeam,
    session.sessionId,
    fromTeam
  );
  // Returns ClaudeProcess instance

  // Step 3: Check if spawning
  const metrics = process.getMetrics();
  if (metrics.status === "spawning") {
    return "Session starting... Please retry your request in a moment.";
  }

  // Step 4: Send message
  const response = await process.sendMessage(question, timeout);

  // Step 5: Track usage
  this.sessionManager.recordUsage(session.sessionId);
  this.sessionManager.incrementMessageCount(session.sessionId);

  return response;
}
```

#### 2. PoolManager.getOrCreateProcess()

**First Request** (Cold Start):
```typescript
poolKey = "frontend->backend";
processes.get(poolKey) → undefined (cache miss)

// Create new process
process = new ClaudeProcess("backend", config, 300000, "abc-123-uuid");
await process.spawn();  // ~7-12 seconds

processes.set(poolKey, process);
sessionToProcess.set("abc-123-uuid", poolKey);

return process;
```

**Second Request** (Warm Start):
```typescript
poolKey = "frontend->backend";
processes.get(poolKey) → ClaudeProcess (cache hit!)

// Check if healthy
metrics.status !== "stopped" → true

return process;  // ~1ms lookup
```

#### 3. Process.sendMessage()

```typescript
// Message queued and sent to Claude
response = await process.sendMessage(question, timeout);
// Returns accumulated text from stream-json
```

### Performance Impact

**Cold Start Flow**:
```
SessionManager.getOrCreateSession() → ~10ms (DB lookup)
PoolManager.getOrCreateProcess() → ~7-12s (spawn + init)
Process.sendMessage() → ~500ms-2s (Claude API)

Total: ~8-14 seconds
```

**Warm Start Flow**:
```
SessionManager.getOrCreateSession() → ~1ms (cache hit)
PoolManager.getOrCreateProcess() → ~1ms (map lookup)
Process.sendMessage() → ~500ms-2s (Claude API)

Total: ~500ms-2s
```

**Speedup**: 10-20x faster with pooling!

---

## Performance Characteristics

### Pool Lookup: O(1)

**Map-based**:
```typescript
this.processes.get(poolKey);  // HashMap lookup
```

**Expected**: <1ms for pool sizes up to 1000

### LRU Update: O(n)

**Array scan + splice**:
```typescript
const index = this.accessOrder.indexOf(poolKey);  // O(n)
if (index > -1) {
  this.accessOrder.splice(index, 1);  // O(n)
}
this.accessOrder.push(poolKey);  // O(1)
```

**Impact**: For 10 processes, ~10 operations. Negligible compared to message latency.

**Future Optimization**: Use doubly-linked list for O(1) LRU updates.

### Eviction: O(n) scan

**Worst Case**: Scan all processes to find idle victim
```typescript
for (let i = 0; i < this.accessOrder.length; i++) {
  const poolKey = this.accessOrder[i];
  const process = this.processes.get(poolKey);
  if (process && process.getMetrics().status === 'idle') {
    victimIndex = i;
    break;
  }
}
```

**Expected**: For 10 processes, ~5 checks average (half are idle).

### Memory Usage

**Pool Overhead**:
- Map<string, ClaudeProcess>: ~50 bytes per entry
- Map<string, string>: ~50 bytes per entry
- accessOrder array: ~50 bytes per entry
- Total per process: ~150 bytes

**10 Processes**:
- Pool overhead: ~1.5 KB
- Process instances: ~600 MB (see CLAUDE.md)
- Total: ~600 MB

**Negligible overhead** compared to process memory.

---

## Configuration

### ProcessPoolConfig Interface

```typescript
interface ProcessPoolConfig {
  maxProcesses: number;        // Pool capacity
  idleTimeout: number;         // Process idle timeout (ms)
  healthCheckInterval: number; // Health check frequency (ms)
}
```

### teams.json Configuration

```json
{
  "settings": {
    "maxProcesses": 10,
    "idleTimeout": 300000,
    "healthCheckInterval": 30000
  },
  "teams": {
    "backend": {
      "path": "/Users/jenova/projects/backend",
      "idleTimeout": 600000  // Override: 10 minutes
    }
  }
}
```

### Configuration Precedence

**Idle Timeout**:
1. Team-specific `idleTimeout` (highest priority)
2. Global `settings.idleTimeout` (fallback)

**Code**:
```typescript
const process = new ClaudeProcess(
  teamName,
  teamConfig,
  teamConfig.idleTimeout || this.config.idleTimeout,  // Precedence
  sessionId,
);
```

### Default Values

| Setting | Default | Description |
|---------|---------|-------------|
| `maxProcesses` | 10 | Pool capacity |
| `idleTimeout` | 300000 (5min) | Terminate idle processes |
| `healthCheckInterval` | 30000 (30s) | Health check frequency |

---

## Monitoring and Observability

### Health Check Event

**Frequency**: Every 30 seconds (configurable)

**Event**: `health-check`

**Payload**: Complete pool status

**Usage**:
```typescript
pool.on("health-check", (status) => {
  console.log(`Pool: ${status.totalProcesses}/${status.maxProcesses} processes`);
  console.log(`Active sessions: ${status.activeSessions}`);

  for (const [poolKey, info] of Object.entries(status.processes)) {
    console.log(`  ${poolKey}: ${info.status} (${info.messagesProcessed} msgs)`);
  }
});
```

### Metrics to Track

**Pool-Level**:
- `totalProcesses`: Current pool size
- `maxProcesses`: Capacity
- `activeSessions`: Number of active sessions
- LRU eviction count (manual tracking)

**Per-Process**:
- `status`: Current state
- `messagesProcessed`: Total messages
- `uptime`: Time since spawn
- `idleTimeRemaining`: Until timeout
- `queueLength`: Pending messages

### Logging

**Structured JSON logs** to stderr:

```json
{"level":"info","context":"pool","message":"Creating new process","poolKey":"frontend->backend","sessionId":"abc-123"}
{"level":"info","context":"pool","message":"Evicting LRU process","poolKey":"mobile->api"}
{"level":"debug","context":"pool","message":"Process health check","poolKey":"external->backend","status":"idle"}
```

### Future: Prometheus Metrics

**Gauges**:
- `iris_pool_size`: Current number of processes
- `iris_pool_capacity`: Max processes configured
- `iris_active_sessions`: Number of active sessions

**Counters**:
- `iris_processes_spawned_total`: Total processes created
- `iris_processes_evicted_total`: Total LRU evictions
- `iris_messages_sent_total`: Total messages sent

**Histograms**:
- `iris_message_duration_seconds`: Message processing time
- `iris_process_uptime_seconds`: Process lifetime

---

## Error Handling

### Team Not Found

**Error**: `TeamNotFoundError`

**Trigger**:
```typescript
const teamConfig = this.configManager.getTeamConfig(teamName);
if (!teamConfig) {
  throw new TeamNotFoundError(teamName);
}
```

**Caller Response**: Return 404-style error to MCP client

### Pool Limit Exceeded

**Error**: `ProcessPoolLimitError`

**Trigger**:
```typescript
if (this.processes.size >= this.config.maxProcesses) {
  await this.evictLRU();  // Try to evict
}

// In evictLRU():
if (this.accessOrder.length === 0) {
  throw new ProcessPoolLimitError(this.config.maxProcesses);
}
```

**When This Happens**: All slots full AND no processes to evict (shouldn't happen with proper LRU).

**Recovery**: Increase `maxProcesses` or reduce `idleTimeout`.

### Process Spawn Failure

**Error**: `ProcessError` (from ClaudeProcess)

**Propagation**:
```typescript
await process.spawn();  // Throws ProcessError if spawn fails
```

**Handling**: Error bubbles to IrisOrchestrator → MCP client

**Cleanup**: Event handlers automatically remove failed process from pool.

### Termination Timeout

**Scenario**: Process doesn't exit after SIGTERM

**Handling** (in ClaudeProcess):
```typescript
setTimeout(() => {
  if (this.process) {
    logger.warn("Force killing process");
    this.process.kill("SIGKILL");
  }
}, 5000);
```

**Pool Manager**: Waits for termination promise to resolve, doesn't timeout.

---

## Testing Strategy

### Unit Tests

**Mock ClaudeProcess**:
```typescript
vi.mock("./claude-process.js", () => ({
  ClaudeProcess: vi.fn().mockImplementation(() => ({
    spawn: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue("response"),
    terminate: vi.fn().mockResolvedValue(undefined),
    getMetrics: vi.fn().mockReturnValue({
      status: "idle",
      messagesProcessed: 0,
      lastUsed: Date.now(),
      uptime: 0,
      idleTimeRemaining: 300000,
      queueLength: 0,
    }),
    on: vi.fn(),
  })),
}));
```

**Test Coverage**:
- ✅ Pool key generation
- ✅ LRU access order updates
- ✅ Eviction logic (prefer idle, fallback to LRU)
- ✅ Session mapping (bidirectional)
- ✅ Event forwarding
- ✅ Health checks

### Integration Tests

**Real Process Spawning**:
```typescript
describe("ClaudeProcessPool Integration", () => {
  beforeAll(async () => {
    // Initialize sessions for test teams
    await ClaudeProcess.initializeSessionFile(config1, sessionId1);
    await ClaudeProcess.initializeSessionFile(config2, sessionId2);
  }, 120000);

  it("should pool processes for same team pair", async () => {
    const pool = new ClaudeProcessPool(configManager, poolConfig);

    const process1 = await pool.getOrCreateProcess("backend", sessionId1, "frontend");
    const process2 = await pool.getOrCreateProcess("backend", sessionId1, "frontend");

    expect(process1).toBe(process2);  // Same instance!
  });

  it("should evict LRU when pool full", async () => {
    // Set maxProcesses = 2
    const pool = new ClaudeProcessPool(configManager, { maxProcesses: 2, ... });

    await pool.getOrCreateProcess("team1", sessionId1, null);
    await pool.getOrCreateProcess("team2", sessionId2, null);

    // Should evict team1 (LRU)
    await pool.getOrCreateProcess("team3", sessionId3, null);

    const status = pool.getStatus();
    expect(status.totalProcesses).toBe(2);
    expect(status.processes["external->team1"]).toBeUndefined();
  });
});
```

---

## Common Issues and Solutions

### Issue: "Pool limit exceeded"

**Symptom**: `ProcessPoolLimitError` thrown

**Cause**: `maxProcesses` too low for workload

**Solution**:
```json
{
  "settings": {
    "maxProcesses": 20  // Increase capacity
  }
}
```

### Issue: Processes not being evicted

**Symptom**: Pool fills up, but idle processes remain

**Cause**: Health check not running or too infrequent

**Solution**:
```json
{
  "settings": {
    "healthCheckInterval": 15000,  // More frequent
    "idleTimeout": 120000  // Shorter timeout (2min)
  }
}
```

### Issue: "No process found for session"

**Symptom**: `sendCommandToSession()` returns `null`

**Causes**:
1. Process already terminated (idle timeout)
2. Process crashed
3. Session ID mismatch

**Debugging**:
```typescript
const status = pool.getStatus();
console.log("Active sessions:", status.activeSessions);
console.log("Processes:", Object.keys(status.processes));

// Check if session in mapping
const poolKey = pool["sessionToProcess"].get(sessionId);
console.log("Pool key for session:", poolKey);
```

### Issue: Memory leak (pool growing unbounded)

**Symptom**: Process count keeps increasing

**Cause**: Processes not being cleaned up on exit

**Check**: Event handlers are properly removing processes:
```typescript
process.on("terminated", (data) => {
  this.processes.delete(poolKey);  // CRITICAL
  this.sessionToProcess.delete(sessionId);
  this.removeFromAccessOrder(poolKey);
});
```

**Verify**: `getStatus()` should show processes being removed.

---

## Future Enhancements

### 1. Linked List for O(1) LRU

**Current**: Array with O(n) splice operations

**Enhancement**: Doubly-linked list with hash map

**Benefit**: O(1) access updates for large pools

### 2. Process Warm-Up Pool

**Current**: Spawn on-demand (7-12s cold start)

**Enhancement**: Pre-spawn pool of processes waiting for assignment

**Implementation**:
```typescript
private warmPool = new Map<string, ClaudeProcess>();

async prewarmProcess(): Promise<void> {
  const process = new ClaudeProcess(...);
  await process.spawn();
  this.warmPool.set(generateId(), process);
}
```

**Benefit**: Sub-second assignment to new team pairs

### 3. Process Grouping by Resource Usage

**Current**: All processes treated equally

**Enhancement**: Track memory/CPU usage, evict heavy processes first

**Implementation**:
```typescript
private async evictHeaviest(): Promise<void> {
  let heaviest: string | null = null;
  let maxMemory = 0;

  for (const [poolKey, process] of this.processes) {
    const metrics = process.getMetrics();
    if (metrics.memoryUsage > maxMemory) {
      maxMemory = metrics.memoryUsage;
      heaviest = poolKey;
    }
  }

  if (heaviest) await this.terminateProcess(heaviest);
}
```

### 4. Adaptive Pool Sizing

**Current**: Fixed `maxProcesses` limit

**Enhancement**: Dynamic scaling based on system resources

**Implementation**:
```typescript
private async adjustPoolSize(): Promise<void> {
  const systemMemory = os.totalmem();
  const freeMemory = os.freemem();

  if (freeMemory < systemMemory * 0.2) {
    // Low memory: shrink pool
    await this.evictLRU();
  }
}
```

### 5. Session Affinity Hints

**Current**: Process assignment based purely on pool key

**Enhancement**: Prefer processes on same CPU core for cache locality

**Use Case**: Reduce context switching overhead for high-frequency pairs

---

## Conclusion

ClaudeProcessPool is the **intelligent process lifecycle manager** that:

✅ **Pools processes** for 10-20x faster warm starts
✅ **LRU eviction** ensures hot paths stay fast
✅ **Health monitoring** detects and removes unhealthy processes
✅ **Event forwarding** enables centralized observability
✅ **Session mapping** bridges database and process layers
✅ **Graceful shutdown** prevents resource leaks

This design makes Iris:
- **Performant**: Process reuse eliminates cold start latency
- **Resource-efficient**: LRU eviction keeps pool bounded
- **Observable**: Events and metrics expose internal state
- **Reliable**: Health checks and cleanup prevent leaks
- **Scalable**: O(1) lookups, O(n) LRU for reasonable pool sizes

---

**Last Updated**: 2025-10-10
**Architecture Version**: Phase 1 (Post-Refactor)
**Next Review**: When implementing warm pool (Phase 2+)
