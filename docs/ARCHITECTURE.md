# Iris MCP - System Architecture

**Version:** 3.0 (Major Update)
**Date:** October 18, 2025
**Status:** Production-ready with Dashboard, Transport Abstraction, and Reverse MCP

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architectural Principles](#architectural-principles)
3. [System Overview](#system-overview)
4. [Component Hierarchy](#component-hierarchy)
5. [Two-Timeout Architecture](#two-timeout-architecture)
6. [Data Flow](#data-flow)
7. [State Management](#state-management)
8. [Event-Driven Communication](#event-driven-communication)
9. [Future Phases](#future-phases)

---

## Executive Summary

Iris MCP is a Model Context Protocol server that enables **cross-project Claude Code coordination**. Multiple Claude instances running in different project directories can communicate and collaborate through MCP tools, coordinated by a central Iris orchestrator.

**Key Innovation:** The refactored architecture implements a **"dumb pipe, smart brain"** pattern where:
- **ClaudeProcess** = Pure I/O pipe (no business logic)
- **Iris** = Central orchestrator (all business logic)
- **Cache** = Event-driven storage with RxJS observables
- **Two Timeouts** = Separate concerns for process health vs. caller patience

**Performance:** 52% faster than cold starts through intelligent process pooling with LRU eviction.

---

## Architectural Principles

### 1. Separation of Concerns

```
┌─────────────────────────────────────────────────────────┐
│                  BUSINESS LOGIC LAYER                    │
│                      (Iris Brain)                        │
│  - Completion detection                                  │
│  - Timeout orchestration                                 │
│  - Process state management                              │
│  - Cache coordination                                    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 TRANSPORT LAYER                          │
│                (ClaudeProcess - Dumb Pipe)               │
│  - Spawn processes                                       │
│  - Write stdin                                           │
│  - Read stdout/stderr                                    │
│  - Pipe to cache (NO decisions)                          │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  STORAGE LAYER                           │
│              (Cache with RxJS Observables)               │
│  - Store protocol messages                               │
│  - Emit events on new data                               │
│  - Survive process recreation                            │
└─────────────────────────────────────────────────────────┘
```

**Why This Matters:**
- ClaudeProcess can be restarted without losing business logic state
- Cache survives process crashes, preserving partial responses
- Iris can orchestrate multiple processes with centralized intelligence

### 2. Event-Driven Architecture

The system uses **RxJS observables** for reactive programming:

```typescript
// Cache emits events when messages arrive
cacheEntry.messages$.subscribe(message => {
  // Iris reacts to new data
  if (message.type === 'result') {
    iris.handleCompletion();
  }
});
```

**Benefits:**
- Decoupled components
- Real-time reactivity
- Easy to extend with new observers
- Foundation for Phase 5 Intelligence Layer

### 3. Process Isolation

Each **fromTeam → toTeam** pair gets its own:
- Session record (SQLite)
- Claude process (isolated conversation)
- Cache session (message history)

```
team-iris → team-alpha  ──►  Session A  ──►  Process A  ──►  Cache A
team-iris → team-beta   ──►  Session B  ──►  Process B  ──►  Cache B
team-alpha → team-beta  ──►  Session C  ──►  Process C  ──►  Cache C
```

### 4. Graceful Degradation

System handles failures gracefully:
- Process crashes → Cache preserved, process recreated
- Response timeout → Process restarted, partial results available
- Pool limit reached → LRU eviction with warning
- Configuration errors → Clear error messages with remediation steps

---

## System Overview

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         MCP CLIENT                                │
│                    (Claude Code Instance)                         │
└────────────────┬─────────────────────────────────────────────────┘
                 │ MCP Protocol (stdio/HTTP)
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      MCP SERVER (index.ts)                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Tool Registration (18 tools)                               │  │
│  │ - send_message     - team_wake        - list_teams        │  │
│  │ - ask_message      - team_launch      - get_logs          │  │
│  │ - quick_message    - team_wake_all    - get_date          │  │
│  │ - session_reboot   - team_sleep       - get_agent         │  │
│  │ - session_delete   - team_status      - permissions__appr │  │
│  │ - session_fork     - session_report                        │  │
│  │ - session_cancel                                           │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────┬─────────────────────────────────────────────────┘
                 │ Tool Invocation
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                   IRIS ORCHESTRATOR (iris.ts)                     │
│                        THE BRAIN                                  │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃ • Completion detection (watches for 'result' messages)    ┃  │
│  ┃ • responseTimeout (120s default, resets on each message)  ┃  │
│  ┃ • mcpTimeout (-1=async, 0=forever, N=partial after Nms)   ┃  │
│  ┃ • Process state management (spawning/idle/processing)     ┃  │
│  ┃ • Cache coordination (creates entries, subscribes)        ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
└──┬───────────────────┬────────────────────┬─────────────────────┘
   │                   │                    │
   │ manages           │ coordinates        │ queries/updates
   ▼                   ▼                    ▼
┌────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
│ PROCESS POOL   │ │  CACHE MANAGER  │ │  SESSION MANAGER     │
│ (pool-manager) │ │ (cache-manager) │ │ (session-manager)    │
├────────────────┤ ├─────────────────┤ ├──────────────────────┤
│ LRU Eviction   │ │ MessageCaches   │ │ SQLite Storage       │
│ Health Checks  │ │ RxJS Observables│ │ Process State        │
│ Max 10 Process │ │ Message History │ │ Usage Statistics     │
└────────────────┘ └─────────────────┘ └──────────────────────┘
   │                   │                    │
   │ contains          │ contains           │ persists
   ▼                   ▼                    ▼
┌────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
│ CLAUDE PROCESS │ │  MESSAGE CACHE  │ │  SQLite Database     │
│ (coordinator)  │ │ (per team pair) │ │ team-sessions.db     │
├────────────────┤ ├─────────────────┤ ├──────────────────────┤
│ transport      │ │ createEntry()   │ │ id (PK)              │
│ spawn()        │ │ getAllEntries() │ │ from_team            │
│ executeTell()  │ │ getStats()      │ │ to_team              │
└────────────────┘ └─────────────────┘ │ session_id (UNIQUE)  │
                     │                  │ created_at           │
                     │ contains         │ last_used_at         │
                                        │ message_count        │
                                        │ status               │
                                        │ process_state        │
                                        │ current_cache_id     │
                                        │ last_response_at     │
                                        │ launch_command       │
                                        │ team_config_snapshot │
                                        └──────────────────────┘
                     ▼
                  ┌─────────────────┐
                  │  CACHE ENTRY    │
                  │ (per tell/spawn)│
                  ├─────────────────┤
                  │ messages[]      │
                  │ messages$ (RxJS)│
                  │ status          │
                  │ complete()      │
                  │ terminate()     │
                  └─────────────────┘
                     │
                     │ contains
                     ▼
                  ┌─────────────────┐
                  │ CACHE MESSAGE   │
                  │ (protocol msg)  │
                  ├─────────────────┤
                  │ timestamp       │
                  │ type            │
                  │ data (raw JSON) │
                  └─────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Business Logic? |
|-----------|---------------|-----------------|
| **MCP Server** | Register tools, validate inputs | Minimal |
| **Iris Orchestrator** | ALL business logic | ✅ YES |
| **Process Pool** | Manage process lifecycle, LRU | Limited (lifecycle) |
| **ClaudeProcess** | Spawn, stdio piping | ❌ NO |
| **Cache Manager** | Manage message caches | Minimal |
| **MessageCache** | Store entries for team pair | No |
| **Cache Entry** | Store messages, emit events | No (just storage) |
| **Session Manager** | Persist session metadata | No (just CRUD) |
| **Config Manager** | Load/validate config | No (just I/O) |

---

## Component Hierarchy

### Cache Hierarchy

```
CacheManager (singleton)
  │
  ├── MessageCache (sessionId: "uuid-1", fromTeam: null, toTeam: "alpha")
  │     │
  │     ├── CacheEntry (type: SPAWN, tellString: "ping")
  │     │     └── CacheMessage[] (system/init, assistant, result)
  │     │
  │     ├── CacheEntry (type: TELL, tellString: "What is 2+2?")
  │     │     └── CacheMessage[] (user, assistant, stream_event, result)
  │     │
  │     └── CacheEntry (type: TELL, tellString: "Explain quantum physics")
  │           └── CacheMessage[] (user, assistant, assistant, result)
  │
  └── MessageCache (sessionId: "uuid-2", fromTeam: "alpha", toTeam: "beta")
        └── CacheEntry (type: TELL, tellString: "Review this PR")
              └── CacheMessage[] (...)
```

**Lifetime:**
- `CacheManager`: Lives for entire Iris process lifetime
- `MessageCache`: Lives until explicitly destroyed (survives process crashes)
- `CacheEntry`: Lives until completed/terminated
- `CacheMessage`: Immutable once added

### Process Pool Hierarchy

```
ClaudeProcessPool
  │
  ├── ClaudeProcess (poolKey: "iris->alpha", sessionId: "uuid-1")
  │     - teamName: "alpha"
  │     - isReady: true
  │     - isBusy: false
  │     - currentCacheEntry: null
  │
  ├── ClaudeProcess (poolKey: "frontend->backend", sessionId: "uuid-2")
  │     - teamName: "backend"
  │     - isReady: true
  │     - isBusy: true
  │     - currentCacheEntry: <pointer to cache entry>
  │
  └── ClaudeProcess (poolKey: "alpha->beta", sessionId: "uuid-3")
        - teamName: "beta"
        - isReady: false
        - isBusy: false
        - currentCacheEntry: null
```

**Pool Key Format:** `fromTeam->toTeam` (e.g., `"iris->alpha"`, `"alpha->beta"`, `"frontend->backend"`)

**LRU Tracking:** Array of pool keys ordered by access time (least recent first)

---

## Transport Abstraction Layer

### Critical Architectural Component

**ClaudeProcess does NOT directly spawn processes.** It delegates to a **Transport abstraction layer** that handles local and remote execution transparently.

### Architecture Diagram

```
Iris Orchestrator
    ↓
ClaudeProcessPool
    ↓
ClaudeProcess (wrapper/coordinator)
    ↓
Transport (abstraction interface)
    ├── LocalTransport → child_process.spawn()
    └── SSHTransport → OpenSSH client (ssh command)
```

### Transport Interface

**Location:** `src/transport/transport.interface.ts`

```typescript
interface Transport {
  // RxJS reactive streams
  status$: Observable<TransportStatus>;  // STOPPED → CONNECTING → SPAWNING → READY → BUSY
  errors$: Observable<Error>;            // Error stream

  // Core operations
  spawn(
    spawnCacheEntry: CacheEntry,
    commandInfo: CommandInfo,        // Pre-built command (executable, args, cwd)
    spawnTimeout?: number            // Timeout in ms (default: 20000)
  ): Promise<void>;

  executeTell(cacheEntry: CacheEntry): void;
  terminate(): Promise<void>;

  // State queries
  isReady(): boolean;
  isBusy(): boolean;
  getPid(): number | null;           // Local only, null for remote

  // Metrics & debugging
  getMetrics(): TransportMetrics;
  getLaunchCommand?(): string | null;      // Debug: Get full launch command
  getTeamConfigSnapshot?(): string | null;  // Debug: Get team config JSON
  cancel?(): void;                          // Send ESC to stdin (attempt cancel)
}
```

### Implementations

#### 1. LocalTransport ✅

**Location:** `src/transport/local-transport.ts`

**Purpose:** Execute Claude CLI on the local machine

**Mechanism:**
- Uses Node.js `child_process.spawn()`
- Direct stdio piping to cache
- Process runs in team's project directory

**Key Features:**
- Fast startup (~2s warm, ~7s cold)
- Direct process control
- Native stdio handling
- PID tracking

#### 2. SSHTransport ✅

**Location:** `src/transport/ssh-transport.ts`

**Purpose:** Execute Claude CLI on remote hosts via SSH

**Mechanism:**
- Uses OpenSSH client (`ssh` command)
- Tunnels stdio over SSH connection
- Supports all SSH features (agent forwarding, ProxyJump, etc.)

**Key Features:**
- Automatic SSH config integration (`~/.ssh/config`)
- Keepalive support (ServerAliveInterval, ServerAliveCountMax)
- Reverse MCP tunneling (`ssh -R` for remote → local calls)
- Session MCP configuration (bidirectional communication)
- Remote MCP config file deployment

**Configuration:**
```yaml
teams:
  team-remote:
    remote: ssh inanna             # OpenSSH command
    path: /opt/containers           # Remote path
    enableReverseMcp: true          # SSH tunnel for callbacks
    sessionMcpEnabled: true         # Deploy MCP config files
```

#### 3. TransportFactory ✅

**Location:** `src/transport/transport-factory.ts`

**Purpose:** Select appropriate transport based on team configuration

**Logic:**
```typescript
class TransportFactory {
  static create(teamName: string, config: IrisConfig, sessionId: string): Transport {
    if (config.remote) {
      return new SSHTransport(teamName, config, sessionId);
    }
    return new LocalTransport(teamName, config, sessionId);
  }
}
```

### ClaudeProcess Integration

**ClaudeProcess is now a thin coordinator:**

```typescript
class ClaudeProcess extends EventEmitter {
  private transport: Transport;  // Abstraction

  constructor(teamName: string, config: IrisConfig, sessionId: string) {
    this.transport = TransportFactory.create(teamName, config, sessionId);
  }

  async spawn(cacheEntry: CacheEntry): Promise<void> {
    return this.transport.spawn(cacheEntry, commandInfo, timeout);
  }

  executeTell(cacheEntry: CacheEntry): void {
    this.transport.executeTell(cacheEntry);
  }
}
```

**ClaudeProcess responsibilities:**
- ✅ Coordinate transport lifecycle
- ✅ Bridge transport events to ProcessPool
- ✅ Maintain status observables
- ✅ Track metrics
- ❌ Does NOT spawn processes directly
- ❌ Does NOT manage stdio (delegated to transport)

### Benefits of Transport Abstraction

1. **Remote Execution:** Teams can run on any SSH-accessible host
2. **Transparency:** Iris treats local/remote identically
3. **Extensibility:** Easy to add new transports (Docker, Kubernetes, WebSocket)
4. **Testability:** Mock transports for unit testing
5. **Separation of Concerns:** Process orchestration vs. execution mechanism

### RxJS Reactive Streams

Both LocalTransport and SSHTransport emit reactive status updates:

```typescript
transport.status$.subscribe(status => {
  // STOPPED → CONNECTING → SPAWNING → READY → BUSY → READY
  console.log('Transport status changed:', status);
});

transport.errors$.subscribe(error => {
  // Handle transport-level errors
  console.error('Transport error:', error);
});
```

**Integration:** ClaudeProcess subscribes to transport observables and forwards to ProcessPool.

---

## Two-Timeout Architecture

The refactored system separates two distinct timeout concerns:

### 1. Response Timeout (Process Health Monitor)

**Source:** `config.yaml` → `settings.responseTimeout` (default: 120000ms = 2 minutes)
**Managed By:** Iris
**Purpose:** Detect stalled Claude processes
**Behavior:** Timer resets on EVERY message received from Claude

```
┌─────────────────────────────────────────────────────────────┐
│               Response Timeout Lifecycle                     │
└─────────────────────────────────────────────────────────────┘

Tell sent to ClaudeProcess
    │
    ▼
[Start responseTimeout timer: 120s]
    │
    ├──► Message received → [Reset timer to 120s]
    ├──► Message received → [Reset timer to 120s]
    ├──► Message received → [Reset timer to 120s]
    ├──► 'result' message → [Complete successfully, clear timer]
    │
    └──► 120s elapsed with NO messages
           │
           ▼
         [RESPONSE TIMEOUT!]
           │
           ├─► Terminate cache entry (reason: RESPONSE_TIMEOUT)
           ├─► Kill process
           ├─► Update session state to 'stopped'
           └─► Cache preserved for retrieval
```

**Key Points:**
- Timer is **cumulative** (resets on each message)
- Claude streaming many messages = timer keeps resetting
- Claude hangs/crashes = timer expires after 120s of silence
- Process recreated, cache preserved

### 2. MCP Timeout (Caller Patience)

**Source:** Tool call parameter `timeout: number`
**Managed By:** Iris (but honors caller's wishes)
**Purpose:** Control how long the MCP caller waits for a response
**Behavior:** Fixed duration, does NOT reset

```
┌─────────────────────────────────────────────────────────────┐
│                 MCP Timeout Modes                            │
└─────────────────────────────────────────────────────────────┘

timeout: -1  →  ASYNC MODE
                Return immediately: { status: "async", sessionId }
                Process continues running
                Caller retrieves results later via team_cache_read

timeout: 0   →  WAIT FOREVER
                Wait until 'result' message or responseTimeout
                No partial results returned
                Only returns on completion or error

timeout: N   →  PARTIAL MODE (N milliseconds)
                Wait N ms, then return:
                {
                  status: "mcp_timeout",
                  partialResponse: "extracted text so far...",
                  rawMessages: [...all messages received]
                }
                Process continues running in background
```

### Interaction Between Timeouts

```
Example: timeout=30000 (30s MCP), responseTimeout=120000 (120s response)

Time    Event
─────   ──────────────────────────────────────────────────────
0s      Tell sent, both timers start
10s     Message received → responseTimeout resets to 120s (now 130s total)
20s     Message received → responseTimeout resets to 120s (now 140s total)
30s     ⚠️  MCP TIMEOUT! → Return partial results to caller
        📍 Process STILL RUNNING in background
        📍 responseTimeout STILL ACTIVE (resets to 120s at 140s)
45s     Message received → responseTimeout resets (now 165s)
50s     'result' message → Process completes successfully
        ✅ Cache entry marked complete
        ℹ️  Caller already got partial response at 30s
```

**Key Insight:** The two timeouts are **orthogonal**:
- MCP timeout controls **caller behavior**
- Response timeout controls **process health**

---

## Data Flow

### Complete Tell Flow (Successful Case)

```
┌──────────────────────────────────────────────────────────────────┐
│                   1. MCP Tool Call                                │
│  send_message(toTeam: "alpha", message: "Hello", timeout: 30000) │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│            2. Iris Orchestrator (THE BRAIN)                       │
│  a. Get/create session → SessionManager                           │
│  b. Check if busy → session.processState === "processing"?       │
│  c. Get/create MessageCache → CacheManager                        │
│  d. Get/create ClaudeProcess → ProcessPool                        │
│  e. Spawn if needed (with SPAWN cache entry)                     │
│  f. Create TELL cache entry                                      │
│  g. Update session.processState = "processing"                   │
│  h. Start responseTimeout timer (120s, resets on messages)       │
│  i. Subscribe to cacheEntry.messages$ (RxJS observable)          │
│  j. Execute: process.executeTell(cacheEntry)                     │
│  k. Start MCP timeout promise (30s fixed)                        │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│         3. ClaudeProcess (DUMB PIPE)                              │
│  a. Check: currentCacheEntry === null? (or throw ProcessBusy)    │
│  b. Set: currentCacheEntry = cacheEntry                           │
│  c. Write to stdin: JSON.stringify({ type: "user", message })    │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│   4. Claude Code Process (External - Black Box)                   │
│  - Receives user message via stdin                                │
│  - Thinks, uses tools, generates response                         │
│  - Writes newline-delimited JSON to stdout                        │
└────────────────────┬─────────────────────────────────────────────┘
                     │ stdout (stream)
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│         5. ClaudeProcess.handleStdoutData() (DUMB PIPE)           │
│  FOR EACH line in stdout:                                         │
│    - Parse JSON                                                   │
│    - currentCacheEntry.addMessage(json)  ← THAT'S IT!             │
│    - IF json.type === "result":                                   │
│        currentCacheEntry = null  (clear for next tell)            │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│          6. CacheEntry (EVENT EMITTER)                            │
│  addMessage(json):                                                │
│    - messages.push({ timestamp, type, data: json })               │
│    - messagesSubject.next(message)  ← Emit to RxJS observable    │
└────────────────────┬─────────────────────────────────────────────┘
                     │ RxJS subscription
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│     7. Iris RxJS Subscription (BUSINESS LOGIC)                    │
│  cacheEntry.messages$.subscribe(msg => {                          │
│    sessionManager.updateLastResponse(sessionId);                  │
│    resetResponseTimeout();  ← Reset 120s timer                    │
│                                                                   │
│    IF msg.type === "result":                                      │
│      handleTellCompletion():                                      │
│        - cacheEntry.complete()                                    │
│        - sessionManager.updateProcessState("idle")                │
│        - sessionManager.incrementMessageCount()                   │
│        - subscription.unsubscribe()                               │
│        - clearTimeout(responseTimeout)                            │
│        - Resolve MCP promise with full response                   │
│  });                                                              │
└───────────────────────────────────────────────────────────────────┘
```

### Error Flow (Response Timeout)

```
┌──────────────────────────────────────────────────────────────────┐
│        Claude Stops Responding (Hung/Crashed)                     │
└────────────────────┬─────────────────────────────────────────────┘
                     │ 120s with NO messages
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│       Iris.handleResponseTimeout() (RECOVERY LOGIC)               │
│  1. cacheEntry.terminate(RESPONSE_TIMEOUT)                        │
│     - Sets status = "terminated"                                  │
│     - Sets terminationReason                                      │
│     - Completes RxJS observable (messagesSubject.complete())      │
│                                                                   │
│  2. Get MessageCache (still alive in CacheManager!)               │
│                                                                   │
│  3. Terminate old process                                         │
│     - oldProcess.terminate() → SIGTERM/SIGKILL                    │
│     - Process removed from pool                                   │
│                                                                   │
│  4. Update session state                                          │
│     - sessionManager.updateProcessState("stopped")                │
│     - sessionManager.setCurrentCacheSessionId(null)               │
│                                                                   │
│  5. Cache preserved for retrieval!                                │
│     - MessageCache still contains all entries                     │
│     - Partial responses available via team_cache_read             │
│                                                                   │
│  6. Next tell will create new process                             │
│     - Same MessageCache reused                                    │
│     - New cache entry added to same cache                         │
└───────────────────────────────────────────────────────────────────┘
```

---

## State Management

### Process State Machine

```
                    ┌──────────┐
                    │ stopped  │ ← Initial state, no process
                    └────┬─────┘
                         │ getOrCreateProcess()
                         │ spawn(spawnCacheEntry)
                         ▼
                    ┌──────────┐
              ┌────►│ spawning │ ← Process starting, waiting for init
              │     └────┬─────┘
              │          │ init message received
              │          │ isReady = true
              │          ▼
              │     ┌──────────┐
              │     │   idle   │ ← Ready, not processing
              │     └────┬─────┘
              │          │ executeTell(cacheEntry)
              │          ▼
              │     ┌────────────┐
              │     │ processing │ ← Actively processing a tell
              │     └────┬───────┘
              │          │
              │          ├──► 'result' message → idle
              │          │
              │          ├──► responseTimeout → terminating
              │          │
              │          └──► process.terminate() → terminating
              │               │
              │               ▼
              │          ┌─────────────┐
              └──────────┤ terminating │ ← Shutting down
                         └─────┬───────┘
                               │ process exit
                               ▼
                         ┌──────────┐
                         │ stopped  │
                         └──────────┘
```

**Stored In:** `SessionManager` → SQLite → `team_sessions.process_state`

**Managed By:** Iris (updates via `sessionManager.updateProcessState()`)

### Cache Entry Status

```
              ┌────────┐
              │ active │ ← Receiving messages, observable open
              └───┬────┘
                  │
          ┌───────┴──────────┐
          │                  │
          ▼                  ▼
    ┌───────────┐      ┌────────────┐
    │ completed │      │ terminated │
    └───────────┘      └────────────┘
     ↑                  ↑
     │                  │
     'result' msg       responseTimeout / crash / manual
```

**Transitions:**
- `active → completed`: Normal completion (result message)
- `active → terminated`: Error condition (timeout, crash, manual kill)

---

## Event-Driven Communication

### RxJS Observable Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                   CacheEntry (Publisher)                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ private messagesSubject = new Subject<CacheMessage>();     │  │
│  │ public messages$: Observable<CacheMessage>;                │  │
│  │                                                            │  │
│  │ addMessage(data: any): void {                             │  │
│  │   const msg = { timestamp, type, data };                  │  │
│  │   this.messages.push(msg);                                │  │
│  │   this.messagesSubject.next(msg); ← Emit to subscribers  │  │
│  │ }                                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Observable stream
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  Subscriber  │  │  Subscriber  │  │  Subscriber  │
      │    (Iris)    │  │   (Iris)     │  │  (Future)    │
      ├──────────────┤  ├──────────────┤  ├──────────────┤
      │ Response     │  │ Completion   │  │ Analytics    │
      │ Timeout      │  │ Detection    │  │ Dashboard    │
      │ Timer Reset  │  │ ('result')   │  │ Monitoring   │
      └──────────────┘  └──────────────┘  └──────────────┘
```

**Benefits for Future Phases:**
- Phase 2 Dashboard can subscribe for real-time updates
- Phase 3 API can stream events to WebSocket clients
- Phase 5 Intelligence can observe patterns for meta-cognition

### Event Types Emitted

| Source | Event Name | Data | Purpose |
|--------|-----------|------|---------|
| ClaudeProcess | `process-spawned` | `{ teamName, pid }` | Process started |
| ClaudeProcess | `process-exited` | `{ teamName, code, signal }` | Process ended |
| ClaudeProcess | `process-error` | `{ teamName, error }` | Process error |
| ClaudeProcess | `process-terminated` | `{ teamName }` | Manual termination |
| ClaudeProcessPool | `process-spawned` | (forwarded) | Pool awareness |
| ClaudeProcessPool | `health-check` | `{ status }` | Periodic health |
| CacheEntry | `messages$` | `CacheMessage` | New message (RxJS) |

---

## Future Phases

Iris is designed for **five progressive phases**:

### Phase 1: Core MCP Server ✅ (CURRENT)
- Process pooling with LRU eviction
- MCP tools for team coordination
- Two-timeout architecture
- Event-driven cache with RxJS
- SQLite session persistence

**Status:** Complete (refactored Oct 2025)

### Phase 2: React Dashboard ✅ **IMPLEMENTED**
**Location:** `src/dashboard/`
**Tech Stack:** React 18 + Vite + Express + Socket.io
**Purpose:** Web UI for monitoring teams, processes, and permissions
**Status:** Production-ready, fully functional

**Server-Side (src/dashboard/server/):**
- `index.ts` - Express server with WebSocket support
- `state-bridge.ts` - State synchronization with Iris core
- `routes/processes.ts` - Process management API
- `routes/config.ts` - Configuration management API

**Client-Side (src/dashboard/client/):**
- `ProcessMonitor.tsx` - Real-time process status monitoring
- `LogViewer.tsx` - Live log streaming with filtering
- `ConfigEditor.tsx` - Visual configuration editor
- `PermissionApprovalModal.tsx` - Manual permission approval UI
- `useWebSocket.ts` - WebSocket integration hook

**Features Implemented:**
- ✅ Real-time process status with WebSocket updates
- ✅ Permission approval system with modal dialogs
- ✅ Real-time log streaming from wonder-logger
- ✅ Session history and statistics
- ✅ Manual process control (wake/sleep/terminate)
- ✅ Configuration editor with validation
- ✅ Health metrics visualization
- ✅ Debug info display (launch commands, config snapshots)

**Integration:** Subscribes to RxJS observables via DashboardStateBridge, forwards events via Socket.io

### Phase 3: HTTP/WebSocket API ⚠️ **PARTIALLY IMPLEMENTED**
**Location:** `src/mcp_server.ts` (integrated) + `src/api/` (planned separate module)
**Tech Stack:** Express + StreamableHTTPServerTransport
**Purpose:** HTTP transport for MCP + external integrations
**Status:** HTTP/WS functionality exists, separate REST API module pending

**Currently Implemented (in MCP server):**
- ✅ HTTP transport mode (`run("http", port)`)
- ✅ `/mcp` - General MCP HTTP endpoint (JSON-RPC over HTTP)
- ✅ `/mcp/:sessionId` - Session-specific endpoint for Reverse MCP
- ✅ Express server with JSON middleware
- ✅ WebSocket support via Dashboard server
- ✅ StreamableHTTPServerTransport integration

**Planned (separate src/api/ module):**
- 🔮 RESTful API wrapper around MCP tools
- 🔮 `POST /api/teams/tell` - HTTP version of send_message
- 🔮 `GET /api/teams/:name/status` - Team status endpoint
- 🔮 `WS /api/stream` - Dedicated real-time event stream

**Note:** HTTP/WebSocket capabilities are fully functional for Dashboard and Reverse MCP, but a dedicated REST API module is still planned.

### Phase 4: CLI Interface ⚠️ **PARTIALLY IMPLEMENTED**
**Location:** `src/cli/`
**Tech Stack:** Plain TypeScript commands (Ink integration planned)
**Purpose:** Terminal commands for installation and management
**Status:** Basic commands implemented, interactive TUI pending

**Currently Implemented (src/cli/commands/):**
- ✅ `install.ts` - Install Iris MCP and register with Claude CLI
- ✅ `uninstall.ts` - Uninstall and cleanup
- ✅ `add-team.ts` - Add team to configuration

**Planned (Ink-based Terminal UI):**
- 🔮 `iris teams list` - Show all teams with status
- 🔮 `iris tell <team> <message>` - Interactive tell with autocomplete
- 🔮 `iris monitor` - Live dashboard in terminal (Ink-based)
- 🔮 `iris cache inspect <sessionId>` - Interactive cache viewer

**Note:** Current CLI uses plain TypeScript. Ink 5 (React for terminals) integration is planned to reuse Dashboard components for TUI.

### Phase 5: Intelligence Layer 🔮
**Location:** `src/intelligence/`
**Tech Stack:** TBD (ML/AI integration)
**Purpose:** Autonomous coordination

**Capabilities:**
- Pattern recognition from event streams
- Proactive team coordination
- Load balancing decisions
- Self-healing infrastructure
- Meta-cognitive reflection

**Foundation:** All events already emitted, observables already in place

---

## Configuration

**File:** `$IRIS_HOME/config.yaml` (or `~/.iris/config.yaml`)

**Key Settings:**

```yaml
settings:
  sessionInitTimeout: 30000     # 30s for session file creation
  responseTimeout: 120000       # 2min for process health (resets)
  idleTimeout: 30000000         # 8.3hr before idle process cleanup
  maxProcesses: 10              # LRU eviction limit
  healthCheckInterval: 30000    # 30s health check frequency

teams:
  team-name:
    path: /absolute/path/to/project
    description: Human-readable description
    idleTimeout: 30000000       # Optional override
    grantPermission: yes        # Permission mode: yes/no/ask/forward
    color: "#FF6B9D"            # Hex color for future UI
```

**Hot-Reload:** Config watched with `fs.watchFile()`, reloads on changes

---

## Performance Characteristics

**Cold Start (No Pool):**
- Session file creation: ~7s
- Process spawn: ~7s per process
- 3 sequential messages: ~21s total

**Warm Start (With Pool):**
- Process reuse: ~2s per message
- 3 messages: ~11s total
- **52% faster!**

**Memory:**
- ~150MB per Claude process
- ~10MB for cache per session
- SQLite database < 1MB for 1000 sessions

**Scalability:**
- Max processes limited by config (default 10)
- LRU eviction prevents runaway memory
- SQLite handles 100K+ sessions easily

---

## Security Considerations

**Input Validation:**
- Team names validated against path traversal
- Messages sanitized (null bytes removed, length limits)
- Timeouts bounded (1s to 1hr)

**Process Isolation:**
- Each team runs in its own directory
- No shared state between processes
- Environment isolation via child_process

**Configuration:**
- Absolute paths required (no relative path traversal)
- Team paths validated on load
- Hot-reload with validation

---

## Logging

**Format:** Structured JSON to stderr
**Levels:** debug, info, warn, error
**Context:** Each logger scoped (e.g., `process:alpha`, `cache-manager`)

**Example:**
```json
{
  "level": "info",
  "context": "iris",
  "message": "Tell completed successfully",
  "sessionId": "uuid-123",
  "cacheEntryType": "tell",
  "messageCount": 5,
  "timestamp": "2025-10-12T22:00:00.000Z"
}
```

**Why stderr?** Stdout reserved for MCP protocol (stdio transport)

---

## Testing Strategy

**Test Structure:**
- `tests/unit/` - Process pool, cache, validation
- `tests/integration/` - End-to-end MCP communication
- `tests/fixtures/` - Mock configurations

**Key Test Cases:**
- Two-timeout interaction (30s MCP, 120s response)
- Process recreation with cache preservation
- LRU eviction under load
- RxJS subscription cleanup
- SQLite schema migration

---

## Deployment

**Installation:**
```bash
npm install -g @iris-mcp/server
iris install  # Creates config, registers with Claude CLI
```

**Running:**
```bash
iris start    # Starts MCP server (stdio transport)
iris start --http  # Future: HTTP transport
```

**Integration with Claude Code:**
- Registered in `~/.claude/config.yaml` as MCP server
- Auto-started by Claude CLI when tools invoked
- Process lifetime managed by Claude CLI

---

## Conclusion

The refactored Iris MCP architecture achieves:

✅ **Clean separation** - Dumb pipe vs. smart brain
✅ **Event-driven** - RxJS observables for reactivity
✅ **Resilient** - Cache survives process failures
✅ **Performant** - 52% faster with process pooling
✅ **Observable** - Rich event streams for monitoring
✅ **Extensible** - Foundation for 5 phases

**Next Steps:**
1. Complete integration testing
2. Production deployment
3. Begin Phase 2 dashboard development

---

## Tech Writer Notes

**Coverage Areas:**
- System architecture and component interaction patterns
- Two-timeout architecture (responseTimeout vs mcpTimeout)
- Data flow diagrams and state machines
- Event-driven communication with RxJS observables
- Cache hierarchy and process pool management
- Future phases (Dashboard, API, CLI, Intelligence Layer)

**Keywords:** architecture, system design, components, data flow, state machine, event-driven, RxJS, observables, cache hierarchy, process pool, two-timeout, responseTimeout, mcpTimeout, Iris orchestrator, ClaudeProcess, business logic layer, transport layer, storage layer

**Last Updated:** 2025-10-19
**Change Context:** MAJOR ARCHITECTURE DOCUMENTATION UPDATE (v3.0). Corrected Phase 2 status - Dashboard is fully implemented and production-ready (not future). Added comprehensive Transport Abstraction Layer section documenting LocalTransport/SSHTransport split. Fixed tool registration diagram (removed non-existent team_cache_read/team_cache_clear tools). Updated database schema diagram with all actual fields (launch_command, team_config_snapshot, etc.). Corrected Phase 3 & 4 status (HTTP/WS partially implemented, CLI partially implemented). Document now accurately reflects actual implementation state vs. planned features. Minor update 2025-10-19: Added get_agent tool to registration diagram (18 tools total).

**Changes from v2.1 → v3.0:**
- ✅ Added Transport Abstraction Layer section (fundamental architecture, was completely undocumented)
- ✅ Updated Phase 2 status: Dashboard fully implemented (not future)
- ✅ Updated Phase 3 status: HTTP/WS functionality exists in MCP server
- ✅ Updated Phase 4 status: Basic CLI commands implemented (Ink integration pending)
- ✅ Fixed tool registration: Removed team_cache_read/team_cache_clear (don't exist)
- ✅ Updated database schema: Added all missing fields
- ✅ Updated ClaudeProcess description: Now coordinator, not direct spawner
- ✅ Added RxJS reactive streams documentation throughout
- ✅ Added debug tooling documentation (getLaunchCommand, getTeamConfigSnapshot)

**Related Files:** ACTIONS.md (tool API), FEATURES.md (features), NOMENCLATURE.md (concepts), REMOTE.md (transport details), SESSION.md (session mgmt), DASHBOARD.md (dashboard docs), PERMISSIONS.md (permission system)

---

**Document Version:** 3.0
**Last Updated:** October 19, 2025
**Author:** Jenova (with Claude Code)
