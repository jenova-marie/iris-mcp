# Iris MCP - System Architecture

**Version:** 2.0 (Post-Refactor)
**Date:** October 12, 2025
**Status:** Refactored with Iris BLL and new Cache Architecture

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
│  │ Tool Registration                                          │  │
│  │ - team_tell      - team_wake      - team_cache_read       │  │
│  │ - team_isAwake   - team_sleep     - team_cache_clear      │  │
│  │ - team_wake_all  - team_report    - team_getTeamName      │  │
│  │ - team_teams                                               │  │
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
│ (dumb pipe)    │ │ (per team pair) │ │ team-sessions.db     │
├────────────────┤ ├─────────────────┤ ├──────────────────────┤
│ spawn()        │ │ createEntry()   │ │ from_team            │
│ executeTell()  │ │ getAllEntries() │ │ to_team              │
│ pipe to cache  │ │ getStats()      │ │ session_id           │
└────────────────┘ └─────────────────┘ │ process_state        │
                     │                  │ last_response_at     │
                     │ contains         └──────────────────────┘
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
│  team_tell(toTeam: "alpha", message: "Hello", timeout: 30000)    │
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

### Phase 2: React Dashboard 🚧
**Location:** `src/dashboard/`
**Tech Stack:** React 18 + Express + Socket.io
**Purpose:** Web UI for monitoring teams, processes, cache

**Features:**
- Real-time process status
- Cache inspection
- Session history
- Manual process control
- Health metrics visualization

**Integration:** Subscribe to RxJS observables for live updates

### Phase 3: HTTP/WebSocket API 🚧
**Location:** `src/api/`
**Tech Stack:** Express + Socket.io
**Purpose:** External integrations

**Endpoints:**
- `POST /api/teams/tell` - HTTP version of team_tell
- `GET /api/teams/:name/status` - Team status
- `WS /api/stream` - Real-time event stream

### Phase 4: CLI Interface 🚧
**Location:** `src/cli/`
**Tech Stack:** Ink 5 (React for terminals) + Commander
**Purpose:** Terminal UI for humans

**Commands:**
- `iris teams list` - Show all teams
- `iris tell <team> <message>` - Interactive tell
- `iris monitor` - Live dashboard in terminal
- `iris cache inspect <sessionId>` - Cache viewer

**Why Ink?** Reuse React components from Phase 2 dashboard!

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

```json
{
  "settings": {
    "sessionInitTimeout": 30000,    // 30s for session file creation
    "responseTimeout": 120000,       // 2min for process health (resets)
    "idleTimeout": 30000000,         // 8.3hr before idle process cleanup
    "maxProcesses": 10,              // LRU eviction limit
    "healthCheckInterval": 30000     // 30s health check frequency
  },
  "teams": {
    "team-name": {
      "path": "/absolute/path/to/project",
      "description": "Human-readable description",
      "idleTimeout": 30000000,       // Optional override
      "skipPermissions": true,       // Auto-approve Claude actions
      "color": "#FF6B9D"             // Hex color for future UI
    }
  }
}
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

**Document Version:** 2.0
**Last Updated:** October 2025
**Author:** Jenova (with Claude Code)
