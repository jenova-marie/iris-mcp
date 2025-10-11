# Iris MCP: Complete Technical Architecture & Implementation Guide

**A Production-Ready MCP Server for Cross-Project Claude Code Coordination**

**Last Updated**: 2025-10-11
**Version**: 1.0.0 (Post-Refactor - Action-Based Architecture)

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [Action-Based Architecture](#action-based-architecture)
4. [Process Output Caching](#process-output-caching)
5. [Async Task Queue](#async-task-queue)
6. [MCP Protocol Implementation](#mcp-protocol-implementation)
7. [HTTP Transport Support](#http-transport-support)
8. [Process Management & Connection Pooling](#process-management--connection-pooling)
9. [Project Structure](#project-structure)
10. [Complete Implementation](#complete-implementation)
11. [Configuration & Deployment](#configuration--deployment)
12. [Testing & Debugging](#testing--debugging)
13. [Production Considerations](#production-considerations)
14. [API Reference](#api-reference)

---

## 🏗️ Architecture Overview

### High-Level System Design

```
┌──────────────────────────────────────────────────────────────────┐
│                       MCP Host (Claude Desktop)                  │
│                    or Claude Code CLI Instance                   │
│                                                                   │
│  User: "Ask Team Backend about their API versioning strategy"   │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          │ MCP Protocol (stdio/JSON-RPC)
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│              Iris MCP Server (Node.js Process)                    │
│                                                                   │
│  ┌─────────────────── LAYER 1: MCP TRANSPORT ─────────────────┐ │
│  │  MCP Server Core (index.ts)                                 │ │
│  │  • Protocol Handler (JSON-RPC 2.0)                          │ │
│  │  • Action Registry (team_tell, team_isAwake, etc.)         │ │
│  │  • Request/Response Management                              │ │
│  │  • Stdio/HTTP Transport Support                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────── LAYER 2: BUSINESS LOGIC ───────────────────┐ │
│  │  IrisOrchestrator (iris.ts)                                 │ │
│  │  • sendMessage() - coordinates session + process            │ │
│  │  • ask() - convenience wrapper                              │ │
│  │  • getStatus() - aggregates stats                           │ │
│  │  • Handles "Session starting..." async logic                │ │
│  │  • Tracks usage (recordUsage, incrementMessageCount)        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                   ┌────────┴────────┐                             │
│                   ▼                 ▼                             │
│  ┌───────── LAYER 3: INFRASTRUCTURE ──────────────────────────┐ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────┐   │ │
│  │  │  SessionManager (session/session-manager.ts)        │   │ │
│  │  │  • SQLite database (team_sessions table)            │   │ │
│  │  │  • Session lifecycle (create, compact, track)       │   │ │
│  │  │  • getOrCreateSession(fromTeam, toTeam) → sessionId │   │ │
│  │  │  • Calls ClaudeProcess.initializeSessionFile()      │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────┐   │ │
│  │  │  ClaudeProcessPool (process-pool/pool-manager.ts)  │   │ │
│  │  │  • Process lifecycle management                     │   │ │
│  │  │  • getOrCreateProcess(team, sessionId, fromTeam)    │   │ │
│  │  │  • LRU eviction (maxProcesses=10)                   │   │ │
│  │  │  • Health checks every 30s                          │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────┐   │ │
│  │  │  NotificationQueue (notifications/queue.ts)         │   │ │
│  │  │  • SQLite persistent queue                          │   │ │
│  │  │  • Fire-and-forget messages                         │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────┐   │ │
│  │  │  Team Registry (teams.json)                         │   │ │
│  │  │  { "frontend": "/projects/acme-frontend",           │   │ │
│  │  │    "backend": "/projects/acme-backend" }            │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────┬────────────────┬────────────────┬───────────────────┘
            │                │                │
            │ stdio streams  │ stdio streams  │ stdio streams
            │                │                │
┌───────────▼──────────┐  ┌─▼───────────┐  ┌─▼────────────────┐
│ Claude Code Instance │  │  Claude Code │  │  Claude Code      │
│   Team: Frontend     │  │ Team: Backend│  │  Team: Mobile     │
│                      │  │              │  │                   │
│ Session File:        │  │ Session File:│  │ Session File:     │
│ ~/.claude/projects/  │  │ ~/.claude/   │  │ ~/.claude/        │
│   {path}/a1b2c3.jsonl│  │   {path}/    │  │   {path}/         │
│                      │  │   d4e5f6.jsonl│  │   g7h8i9.jsonl   │
│ Process Pool Entry:  │  │              │  │                   │
│ • PID: 12345         │  │ Process Pool │  │ Process Pool      │
│ • Status: idle       │  │ Entry:       │  │ Entry:            │
│ • SessionId: a1b2c3  │  │ • PID: 12346 │  │ • PID: 12347      │
│ • Idle Timer: 3m     │  │ • Status:    │  │ • Status: idle    │
│ • Message Queue: []  │  │   processing │  │ • SessionId: g7h8 │
│                      │  │ • SessionId: │  │ • Idle Timer: 4m  │
│ Working Directory:   │  │   d4e5f6     │  │ • Message Queue:  │
│ /projects/acme-      │  │ • Idle Timer:│  │   []              │
│   frontend/          │  │   paused     │  │                   │
│                      │  │ • Message    │  │ Working Dir:      │
│ Context:             │  │   Queue: [1] │  │ /projects/acme-   │
│ • .claude/           │  │              │  │   mobile/         │
│ • package.json       │  │ Working Dir: │  │                   │
│ • node_modules       │  │ /projects/   │  │ Context:          │
│ • MCP servers        │  │  acme-       │  │ • .claude/        │
│   (Figma, etc.)      │  │  backend/    │  │ • Podfile         │
│                      │  │              │  │ • Swift packages  │
│ stdin/stdout:        │  │ Context:     │  │ • MCP servers     │
│ [open pipes]         │  │ • .claude/   │  │   (iOS sim, etc.) │
│                      │  │ • DB schemas │  │                   │
│                      │  │ • API docs   │  │ stdin/stdout:     │
│                      │  │ • MCP servers│  │ [open pipes]      │
│                      │  │   (Postgres) │  │                   │
│                      │  │ stdin/stdout:│  │                   │
│                      │  │ [open pipes] │  │                   │
└──────────────────────┘  └──────────────┘  └───────────────────┘
```

### Message Flow Diagram

```
User in Frontend Claude
         │
         │ "Ask Team Backend about API versioning"
         ▼
    Claude Frontend
         │
         │ MCP Tool Call: teams_ask("backend", "What's your API versioning?")
         ▼
    MCP Server (index.ts)
         │
         │ Tool handler receives request
         ▼
    IrisOrchestrator.ask(fromTeam, "backend", question, timeout)
         │
         ▼
    SessionManager.getOrCreateSession(fromTeam, "backend")
         │
         ├─ Check SQLite: SELECT * WHERE from_team=? AND to_team=?
         │
         ├─ Session Exists?
         │  └─ Return sessionId from database
         │
         └─ Session Missing?
            ├─ Generate new UUID sessionId
            ├─ Call ClaudeProcess.initializeSessionFile(teamConfig, sessionId)
            │  ├─ spawn('claude', ['--session-id', sessionId, '--print', 'ping'])
            │  ├─ Wait for session file: ~/.claude/projects/{path}/{sessionId}.jsonl
            │  └─ Session file created ✓
            ├─ Store session in SQLite: INSERT INTO team_sessions(...)
            └─ Return sessionId
         │
         ▼
    PoolManager.getOrCreateProcess("backend", sessionId, fromTeam)
         │
         ├─ Check process pool for "backend"
         │
         ├─ Existing Process Found (PID 12346)
         │  ├─ Health check: process.isHealthy() → true
         │  ├─ Reset idle timer
         │  └─ Return process
         │
         └─ Process Missing?
            ├─ Check pool size >= maxProcesses?
            │  └─ Yes: Find LRU process and terminate
            ├─ spawn('claude', ['--input-format', 'stream-json', ...])
            ├─ Set working directory: /projects/acme-backend
            ├─ Setup stdin/stdout pipes
            ├─ Register in pool
            └─ Start idle timer (5 minutes)
         │
         │
         ▼
    Check Process Status
         │
         ├─ Process status == "spawning"?
         │  └─ Yes: Return "Session starting... Please retry in a moment."
         │
         └─ Process ready → Continue
         │
         ▼
    ClaudeProcess.sendMessage(message, timeout)
         │
         │ Write to stdin: {"type":"user","message":"What's your API versioning?","session_id":"..."}
         │
         ▼
    Claude Backend Instance
         │
         │ 1. Receives message via stdin
         │ 2. Analyzes backend codebase
         │ 3. Reads API documentation
         │ 4. Formulates response
         │
         ▼
    Response via stdout
         │
         │ Stream: {"type":"result","response":"We use semantic versioning..."}
         │
         ▼
    ClaudeProcess
         │
         │ 1. Capture stdout
         │ 2. Parse JSON response
         │ 3. Resolve promise
         │ 4. Restart idle timer
         │ 5. Return response to IrisOrchestrator
         │
         ▼
    IrisOrchestrator
         │
         │ 1. Receive response from ClaudeProcess
         │ 2. SessionManager.recordUsage(sessionId)
         │ 3. SessionManager.incrementMessageCount(sessionId)
         │ 4. Return response to MCP server
         │
         ▼
    MCP Server (index.ts)
         │
         │ Format response for MCP protocol
         │
         ▼
    Claude Frontend
         │
         │ "Team Backend says: We use semantic versioning with /v1/, /v2/ prefixes..."
         │
         ▼
    User sees response
```

### Five-Phase Product Roadmap

Iris MCP is architected for **progressive enhancement** across five phases. Phase 1 is currently implemented, with foundational dependencies already installed for future phases.

#### ✅ Phase 1: Core MCP Server (CURRENT)

**Status:** Complete (v1.0.0)
**Focus:** MCP protocol + process pooling + session management + action-based architecture

**Key Features:**
- **Action-Based MCP Interface**: 7 team coordination actions with intuitive verb-based naming
  - `team_tell` - Unified communication (sync/async/persistent modes)
  - `team_isAwake` - Check team process status
  - `team_wake` - Activate team process
  - `team_sleep` - Deactivate team process
  - `team_wake_all` - Bulk team activation
  - `team_report` - View process output cache
  - `team_command` - Execute slash commands (e.g., `/compact`)
- **Process Output Caching**: Structured message storage with ClaudeCache for debugging and analytics
- **Async Task Queue**: RxJS-based per-team queues with backpressure (100-message limit)
- **HTTP Transport Support**: Dual-mode operation (stdio + HTTP) with Commander CLI
- **Process pooling** with LRU eviction (52% performance improvement)
- **Session management** with SQLite persistence
- **Health checks** and idle timeout management
- **Three-layer architecture** (Transport → BLL → Infrastructure)

**Architecture:**
```
MCP Client → index.ts → IrisOrchestrator → {
  SessionManager (SQLite sessions)
  PoolManager (LRU eviction) → ClaudeProcess (with ClaudeCache)
  AsyncQueue (RxJS per-team queues)
}
```

#### 🚧 Phase 2: Web Dashboard

**Status:** Planned
**Focus:** Real-time monitoring and visualization

**Key Features:**
- React SPA for monitoring team interactions
- Real-time process metrics (active sessions, pool status, message counts)
- Session timeline visualization
- Team performance analytics
- Process health monitoring dashboard

**Architecture Addition:**
```
src/dashboard/
├── server.ts          # Express server
├── routes/            # API endpoints
└── components/        # React components (shared with Phase 4 CLI)
```

**Tech Stack:** React ^18.2.0, Express ^4.18.2, Socket.io ^4.7.5

#### 🔮 Phase 3: HTTP/WebSocket API

**Status:** Planned
**Focus:** External integrations and programmatic access

**Key Features:**
- RESTful HTTP endpoints (`POST /teams/:team/ask`, `GET /teams/:team/status`)
- WebSocket for real-time notifications
- API key authentication
- Rate limiting per client
- OpenAPI/Swagger documentation

**Architecture Addition:**
```
src/api/
├── server.ts          # HTTP/WebSocket server
├── routes/            # REST endpoints
├── middleware/        # Auth, rate limiting
└── websocket/         # Real-time events
```

**Tech Stack:** Express ^4.18.2, Socket.io ^4.7.5, ws ^8.18.0

#### 🔮 Phase 4: CLI Interface

**Status:** Planned
**Focus:** Terminal-based team coordination

**Key Features:**
- `iris ask <team> <question>` - Ask team synchronously
- `iris send <team> <message>` - Send async message
- `iris status` - View all team statuses
- `iris watch <team>` - Monitor team activity
- Interactive TUI with real-time updates

**Architecture Addition:**
```
src/cli/
├── index.ts           # CLI entry point
├── commands/          # Command handlers
└── components/        # Ink components (React for terminals)
```

**Tech Stack:** Commander ^12.1.0, Ink ^5.0.1 (React for CLI)

#### 🔮 Phase 5: Intelligence Layer

**Status:** Planned
**Focus:** Autonomous coordination and meta-cognitive abilities

**Key Features:**
- Loop detection (prevent circular team requests)
- Smart routing (route questions to most relevant team)
- Autonomous task delegation
- Cross-team dependency analysis
- Self-aware system monitoring

**Architecture Addition:**
```
src/intelligence/
├── loop-detector.ts       # Circular request prevention
├── smart-router.ts        # ML-based team routing
├── task-delegator.ts      # Autonomous delegation
└── meta-cognitive.ts      # Self-awareness layer
```

**Why Event-Driven Architecture:**
The current event system (`process-spawned`, `message-sent`, `process-error`, etc.) provides the foundation for Phase 5 intelligence. The Intelligence Layer will observe these events to build meta-cognitive awareness and enable autonomous coordination.

**Critical Design Decision:**
All dependencies for phases 1-5 are installed upfront (React, Express, Ink, Commander, Socket.io) to avoid breaking changes during incremental rollout. Only Phase 1 functionality is currently implemented.

---

## 🔧 System Components

### 1. MCP Server Core

**Responsibilities:**
- Handle MCP protocol (JSON-RPC 2.0)
- Register and expose tools
- Route tool calls to appropriate handlers
- Manage stdio transport

**Key Classes:**
- `McpServer` - Main server instance from `@modelcontextprotocol/sdk`
- `StdioServerTransport` - stdio communication layer
- `ToolRegistry` - Registers all team coordination tools

### 2. Process Pool Manager

**Responsibilities:**
- Spawn and manage Claude Code processes
- Maintain connection pool with idle timeout
- Route messages to appropriate processes (requires sessionId)
- Handle process lifecycle (spawn, kill, restart)
- Queue management per process
- LRU eviction when maxProcesses exceeded

**Key Classes:**
- `ClaudeProcessPool` - Pool management with session-aware spawning
- `ClaudeProcess` - Individual process wrapper with static session initialization
- `ProcessConfig` - Configuration per team

**Key Signatures (Updated):**
```typescript
// Now requires sessionId parameter (breaking change from original)
async getOrCreateProcess(
  teamName: string,
  sessionId: string,         // NEW: Required for session-aware spawning
  fromTeam: string | null
): Promise<ClaudeProcess>

// Static method for session file initialization
static async ClaudeProcess.initializeSessionFile(
  teamConfig: TeamConfig,
  sessionId: string,
  sessionInitTimeout?: number
): Promise<void>
```

### 3. Team Registry

**Responsibilities:**
- Map team names to project directories
- Store team-specific configuration
- Validate team existence
- Provide team metadata

**Data Structure:**
```json
{
  "settings": {
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },
  "teams": {
    "frontend": {
      "path": "/absolute/path/to/frontend",
      "description": "React TypeScript frontend",
      "idleTimeout": 600000,
      "skipPermissions": true
    },
    "backend": {
      "path": "/absolute/path/to/backend",
      "description": "Node.js Express API",
      "idleTimeout": 300000,
      "skipPermissions": true
    }
  }
}
```

### 4. Notification Queue

**Responsibilities:**
- Store fire-and-forget notifications
- Persist messages across server restarts
- Track message status (pending, read, expired)
- Clean up old notifications

**Schema (SQLite):**
```sql
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name TEXT NOT NULL,
  from_team TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  status TEXT DEFAULT 'pending' -- pending, read, expired
);

CREATE INDEX idx_team_status ON notifications(team_name, status);
```

### 5. IrisOrchestrator (Business Logic Layer)

**Responsibilities:**
- Coordinate SessionManager and PoolManager
- Orchestrate team-to-team messaging
- Handle "Session starting..." async responses
- Track session usage and message counts
- Provide unified API for tool handlers

**Key Methods:**
- `sendMessage(fromTeam, toTeam, message, options)` - Main coordination method
- `ask(fromTeam, toTeam, question, timeout)` - Synchronous Q&A wrapper
- `getStatus()` - Aggregate session + process statistics
- `shutdown()` - Graceful shutdown coordination

**Architecture Pattern:**
```
MCP Tools → IrisOrchestrator → {
  SessionManager.getOrCreateSession() → sessionId
  PoolManager.getOrCreateProcess(teamName, sessionId, fromTeam) → process
  Process.sendMessage() → response
  SessionManager.recordUsage()
  SessionManager.incrementMessageCount()
}
```

### 6. SessionManager (Session Database Layer)

**Responsibilities:**
- Manage persistent team-to-team sessions
- SQLite database with session metadata
- Session file creation via `ClaudeProcess.initializeSessionFile()`
- Session lifecycle management
- Usage tracking and analytics

**Key Classes:**
- `SessionManager` - Main session orchestrator
- `SessionStore` - SQLite database wrapper
- Path utilities for session file management
- Validation helpers

**Session Lifecycle:**

1. **Startup Discovery:**
   - Validate all team project paths
   - Scan for existing session files
   - Sync database with filesystem

2. **Session Initialization:**
   - Generate UUID for new session
   - Call `ClaudeProcess.initializeSessionFile(teamConfig, sessionId)`
   - Static method spawns: `claude --session-id <uuid> --print ping`
   - Wait for session file creation at: `~/.claude/projects/{escaped-path}/{uuid}.jsonl`
   - Store metadata in SQLite

3. **Session Usage:**
   - `getOrCreateSession(fromTeam, toTeam)` returns sessionId
   - Session files accumulate conversation history
   - Database tracks: created_at, last_used_at, message_count, status

**SQLite Schema:**
```sql
CREATE TABLE team_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_team TEXT,              -- NULL for external clients
  to_team TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  UNIQUE(from_team, to_team)   -- One session per team pair
);

CREATE INDEX idx_team_sessions_from_to ON team_sessions(from_team, to_team);
CREATE INDEX idx_team_sessions_session_id ON team_sessions(session_id);
```

**Session File Structure:**
```
~/.claude/projects/
├── -Users-dev-projects-frontend/
│   ├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl   # Session file
│   └── f9e8d7c6-b5a4-3210-9876-543210fedcba.jsonl
├── -Users-dev-projects-backend/
│   └── d4e5f6g7-h8i9-j0k1-l2m3-n4o5p6q7r8s9.jsonl
```

Each session file contains the full conversation history in JSONL format, allowing Claude to resume context across process restarts.

**Why Sessions Matter:**
- **Persistent Context:** Conversation history survives process termination
- **Performance:** Reuse existing sessions instead of cold starts
- **Team Pairing:** One session per (fromTeam, toTeam) pair ensures isolated conversations
- **Analytics:** Track message counts and usage patterns per team pair

---

## 🎯 Action-Based Architecture

**Major Refactor (2025-10-11)**: The MCP interface was renamed from `tools/` to `actions/` with unified naming convention for better semantic clarity.

### Tool Renaming

| Old Name (teams_*) | New Name (team_*) | Purpose |
|--------------------|-------------------|---------|
| `teams_request` | `team_tell` | Unified communication (sync/async/persistent) |
| `teams_get_status` | `team_isAwake` | Check if teams are active |
| N/A | `team_wake` | Activate team process |
| N/A | `team_sleep` | Deactivate team process |
| N/A | `team_wake_all` | Activate all teams |
| N/A | `team_report` | View team output cache |
| N/A | `team_command` | Execute slash commands (e.g., `/compact`) |

### Design Philosophy

**Action-Oriented Verbs**: The new naming uses natural language verbs that better describe what the action does:
- **tell** - "Tell the backend team about X" (more natural than "request")
- **wake** - "Wake up the team" (activate process)
- **sleep** - "Put the team to sleep" (deactivate process)
- **isAwake** - "Is the team awake?" (check status)
- **report** - "Get a report from the team" (view output cache)

**Unified Interface**: Each action is a separate module in `src/actions/` with clear, single responsibility.

### Action Implementations

**src/actions/tell.ts**:
```typescript
export async function tell(
  args: {
    toTeam: string;
    message: string;
    fromTeam?: string;
    waitForResponse?: boolean;  // Default: true
    timeout?: number;            // Default: 30000ms
    persist?: boolean;           // Use persistent queue
    ttlDays?: number;           // TTL for persistent messages
  },
  iris: IrisOrchestrator
): Promise<TellResponse>
```

**Modes**:
1. **Synchronous** (`waitForResponse=true`): Tell and wait for response
2. **Asynchronous** (`waitForResponse=false`): Fire-and-forget via AsyncQueue
3. **Persistent** (`persist=true`): Queue in SQLite notification table

**src/actions/isAwake.ts**:
```typescript
export async function isAwake(
  args: { team?: string; includeNotifications?: boolean },
  iris: IrisOrchestrator,
  processPool: ClaudeProcessPool,
  configManager: TeamsConfigManager
): Promise<IsAwakeResponse>
```

Returns process status (idle, processing, stopped), session info, and notification counts.

**src/actions/wake.ts**:
```typescript
export async function wake(
  args: { team: string; fromTeam?: string },
  iris: IrisOrchestrator,
  processPool: ClaudeProcessPool,
  sessionManager: SessionManager
): Promise<WakeResponse>
```

Ensures team's Claude process is active in the pool. Spawns process if not already running.

**src/actions/sleep.ts**:
```typescript
export async function sleep(
  args: { team: string; fromTeam?: string; force?: boolean },
  processPool: ClaudeProcessPool
): Promise<SleepResponse>
```

Terminates team's process and frees resources. `force` flag allows termination even if busy.

**src/actions/wake-all.ts**:
```typescript
export async function wakeAll(
  args: { fromTeam?: string; parallel?: boolean },
  iris: IrisOrchestrator,
  processPool: ClaudeProcessPool,
  sessionManager: SessionManager
): Promise<WakeAllResponse>
```

Wake up all configured teams. `parallel` flag enables concurrent spawning for faster startup.

**src/actions/report.ts**:
```typescript
export async function report(
  args: { team: string; fromTeam?: string },
  processPool: ClaudeProcessPool
): Promise<ReportResponse>
```

View cached stdout/stderr from team's process without clearing it. Returns structured message exchanges.

**src/actions/command.ts**:
```typescript
export async function command(
  args: { team: string; command: string; args?: string; fromTeam?: string },
  iris: IrisOrchestrator
): Promise<CommandResponse>
```

Execute slash commands on team's Claude instance. Currently only supports `/compact`.

### Action Registration

Actions are registered in `src/index.ts`:

```typescript
const TOOLS: Tool[] = [
  {
    name: "team_tell",
    description: "Tell a message to a specific team. Supports sync, async, and persistent modes.",
    inputSchema: { /* ... */ }
  },
  {
    name: "team_isAwake",
    description: "Check if teams are awake (active) or asleep (inactive).",
    inputSchema: { /* ... */ }
  },
  // ... other actions
];
```

**Benefits of Action-Based Architecture**:
- ✅ More intuitive naming (verb-based, not noun-based)
- ✅ Better separation of concerns (one action per file)
- ✅ Easier to extend with new actions
- ✅ Preparation for CLI and web dashboard interfaces (Phase 4)
- ✅ Consistent with natural language patterns

---

## 🗄️ Process Output Caching

**Feature Added (2025-10-11)**: ClaudeCache provides structured message storage for debugging and monitoring.

### ClaudeCache Architecture

**Location**: `src/process-pool/claude-cache.ts`

**Purpose**: Capture and store all I/O from Claude processes for debugging, analytics, and the `team_report` action.

### Data Structures

**MessageExchange**: Tracks request/response pairs
```typescript
interface MessageExchange {
  id: string;                    // Unique identifier
  request: string;                // What was sent to Claude
  response: string;               // What Claude responded (accumulating)
  status: 'pending' | 'streaming' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
  duration?: number;             // Duration in milliseconds
  error?: string;                // Error message if failed
  metadata?: {
    tokenCount?: number;
    cost?: number;
    model?: string;
  };
}
```

**ProtocolMessage**: Stores raw JSON protocol messages
```typescript
interface ProtocolMessage {
  timestamp: Date;
  type: string;                  // e.g., "system", "stream_event"
  subtype?: string;              // e.g., "init", "message_start"
  raw: string;                   // Original JSON string
  parsed: any;                    // Parsed JSON object
  messageId?: string;            // Link to MessageExchange
}
```

### Cache Configuration

```typescript
interface CacheConfig {
  maxMessages?: number;          // Max message exchanges to keep (default: 100)
  maxProtocolMessages?: number;  // Max protocol messages to keep (default: 500)
  maxMessageAge?: number;        // Max age in milliseconds (default: 1 hour)
  preserveErrors?: boolean;      // Keep error messages longer (default: true)
}
```

### Cache Operations

**Lifecycle Management**:
```typescript
// Start tracking a new message
const messageId = cache.startMessage("What is the current directory?");

// Append streaming response chunks
cache.appendToCurrentMessage("The current");
cache.appendToCurrentMessage(" directory is /projects/frontend");

// Complete the message
cache.completeCurrentMessage();

// Or mark as error
cache.errorCurrentMessage("Timeout exceeded");
```

**Querying**:
```typescript
// Get recent messages
const recent = cache.getRecentMessages(10);

// Get messages since timestamp
const since = cache.getMessagesSince(new Date(Date.now() - 3600000));

// Get pending/streaming messages
const pending = cache.getPendingMessages();

// Get completed messages
const completed = cache.getCompletedMessages();

// Get error messages
const errors = cache.getErrorMessages();

// Get protocol messages for a specific message
const protocol = cache.getProtocolMessages(messageId);
```

**Reporting**:
```typescript
// Get cache summary
const report = cache.getReport();
/*
{
  totalMessages: 42,
  pendingMessages: 1,
  completedMessages: 40,
  errorMessages: 1,
  averageDuration: 1250,
  oldestMessage: Date(2025-10-11T10:00:00Z),
  newestMessage: Date(2025-10-11T11:30:00Z),
  cacheSize: {
    messages: 42,
    protocolMessages: 156
  }
}
*/

// Export messages as JSON or text
const json = cache.exportMessages('json');
const text = cache.exportMessages('text');
```

### Integration with ClaudeProcess

**Cache Initialization**:
```typescript
class ClaudeProcess {
  private cache: ClaudeCache;

  constructor(teamName: string, teamConfig: TeamConfig, idleTimeout: number) {
    // ...
    this.cache = new ClaudeCache(teamName, {
      maxMessages: 100,
      maxProtocolMessages: 500,
      maxMessageAge: 3600000,  // 1 hour
      preserveErrors: true,
    });
  }
}
```

**Capturing stdout**:
```typescript
private handleStdout(data: Buffer): void {
  const rawData = data.toString();

  // Parse protocol messages
  const lines = rawData.split('\n').filter(line => line.trim());
  for (const line of lines) {
    try {
      const jsonResponse = JSON.parse(line);

      // Store in cache
      this.cache.addProtocolMessage(line);

      // Handle different message types
      if (jsonResponse.type === 'stream_event') {
        const event = jsonResponse.event;

        if (event?.type === 'message_start') {
          this.cache.markMessageStreaming();
        } else if (event?.type === 'content_block_delta') {
          const deltaText = event.delta?.text || '';
          this.cache.appendToCurrentMessage(deltaText);
        } else if (event?.type === 'message_stop') {
          this.cache.completeCurrentMessage();
        }
      }
    } catch (error) {
      // Not JSON, ignore
    }
  }
}
```

**Capturing stderr**:
```typescript
private handleStderr(data: Buffer): void {
  const errorData = data.toString();
  this.cache.appendStderr(errorData);
}
```

### PoolManager Integration

**Cache Management**:
```typescript
class ClaudeProcessPool {
  private caches = new Map<string, ClaudeCache>();

  async getOrCreateProcess(teamName: string, ...): Promise<ClaudeProcess> {
    // Create cache for new process
    if (!this.caches.has(teamName)) {
      const cache = new ClaudeCache(teamName);
      this.caches.set(teamName, cache);
    }

    // Pass cache to process
    const process = new ClaudeProcess(teamName, teamConfig, idleTimeout);
    // ...
  }

  getCacheForTeam(teamName: string): ClaudeCache | undefined {
    return this.caches.get(teamName);
  }

  async terminateProcess(teamName: string) {
    // Clean up cache
    this.caches.delete(teamName);
    // ...
  }
}
```

### Use Cases

**Debugging**:
```bash
# View process output for debugging
$ iris team_report --team backend

{
  "totalMessages": 15,
  "recentMessages": [
    {
      "id": "msg-1-1731355200000",
      "request": "What is the current directory?",
      "response": "The current directory is /projects/backend",
      "status": "completed",
      "duration": 1234
    }
  ]
}
```

**Monitoring**:
- Track response times per team
- Identify teams with frequent errors
- Measure token usage and costs

**Analytics**:
- Average response duration per team
- Message volume per team
- Error rates and patterns

**Circular Buffer**: Cache automatically evicts old messages when limits are reached, keeping most recent data.

---

## ⚡ Async Task Queue

**Feature Added (2025-10-11)**: AsyncQueue provides RxJS-based async task coordination for fire-and-forget operations.

### Architecture Overview

**Location**: `src/async/queue.ts`

**Purpose**: Manage asynchronous operations (tell, command, sleep) without blocking the caller.

**Key Features**:
- Per-team queues for parallel cross-team processing
- Serial processing within each team queue (FIFO)
- 100-message rolling limit per team
- No timeouts - tasks wait indefinitely until processed
- Reactive coordination with RxJS

### Design Pattern

**RxJS Observables**: Each team has a `Subject<AsyncTask>` that processes tasks serially using `concatMap`.

```typescript
class AsyncQueue {
  private queues = new Map<string, Subject<AsyncTask>>();

  private getOrCreateQueue(teamName: string): Subject<AsyncTask> {
    if (!this.queues.has(teamName)) {
      const queue = new Subject<AsyncTask>();

      // Serial processing with concatMap (FIFO order)
      queue
        .pipe(
          concatMap((task) => this.processTask(task)),
          catchError((error) => {
            logger.error("Queue processing error", { error });
            return of(null); // Continue despite errors
          }),
        )
        .subscribe();

      this.queues.set(teamName, queue);
    }

    return this.queues.get(teamName)!;
  }
}
```

### Task Types

```typescript
type AsyncTaskType = "tell" | "command" | "sleep";

interface AsyncTask {
  taskId: string;          // Unique identifier
  type: AsyncTaskType;
  toTeam: string;
  fromTeam: string | null;
  content: string;         // Message or command
  timeout?: number;        // Default: 30000ms
  args?: string;           // For command type
  enqueuedAt: number;
}
```

### Queue Operations

**Enqueue Task**:
```typescript
const taskId = asyncQueue.enqueue({
  type: "tell",
  toTeam: "backend",
  fromTeam: "frontend",
  content: "Deploy the new feature",
  timeout: 60000
});
// Returns immediately with taskId
```

**Process Task**:
```typescript
private async processTask(task: AsyncTask): Promise<AsyncTaskResult> {
  // Route to appropriate handler based on task type
  switch (task.type) {
    case "tell":
      response = await this.iris.sendMessage(
        task.fromTeam,
        task.toTeam,
        task.content,
        { timeout: task.timeout || 30000, waitForResponse: true }
      );
      break;

    case "command":
      const commandStr = task.args ? `/${task.content} ${task.args}` : `/${task.content}`;
      response = await this.iris.sendMessage(
        task.fromTeam,
        task.toTeam,
        commandStr,
        { timeout: task.timeout || 30000, waitForResponse: true }
      );
      break;

    case "sleep":
      response = await this.iris.sendMessage(
        task.fromTeam,
        task.toTeam,
        task.content,
        { timeout: task.timeout || 30000, waitForResponse: true }
      );
      break;
  }

  return {
    taskId: task.taskId,
    type: task.type,
    toTeam: task.toTeam,
    success: true,
    response,
    duration: Date.now() - startTime,
    completedAt: Date.now()
  };
}
```

### Queue Statistics

```typescript
interface QueueStats {
  teamName: string;
  pending: number;      // Tasks currently in queue
  processed: number;    // Total tasks completed
  failed: number;       // Total tasks that failed
  maxQueueSize: number; // Rolling limit (100)
}

// Get stats for a specific team
const stats = asyncQueue.getQueueStats("backend");

// Get stats for all teams
const allStats = asyncQueue.getAllQueueStats();
```

### Integration with Actions

**tell action (async mode)**:
```typescript
export async function tell(args, iris: IrisOrchestrator): Promise<TellResponse> {
  if (!args.waitForResponse) {
    // Async mode: enqueue task
    const taskId = iris.asyncQueue.enqueue({
      type: "tell",
      toTeam: args.toTeam,
      fromTeam: args.fromTeam,
      content: args.message,
      timeout: args.timeout
    });

    return {
      success: true,
      taskId,
      message: "Message enqueued for async processing"
    };
  } else {
    // Sync mode: wait for response
    const response = await iris.sendMessage(...);
    return { success: true, response };
  }
}
```

**command action**:
```typescript
export async function command(args, iris: IrisOrchestrator): Promise<CommandResponse> {
  // All commands are async
  const taskId = iris.asyncQueue.enqueue({
    type: "command",
    toTeam: args.team,
    fromTeam: args.fromTeam,
    content: args.command,
    args: args.args,
    timeout: 30000
  });

  return {
    success: true,
    taskId,
    message: `Command /${args.command} enqueued for team ${args.team}`
  };
}
```

### Orchestrator Integration

```typescript
class IrisOrchestrator {
  private asyncQueue: AsyncQueue;

  constructor(sessionManager, processPool) {
    this.sessionManager = sessionManager;
    this.processPool = processPool;
    this.asyncQueue = new AsyncQueue(this);  // Pass self reference
  }

  async shutdown() {
    this.asyncQueue.shutdown();  // Complete all queues
    await this.processPool.terminateAll();
    this.sessionManager.close();
  }
}
```

### Error Handling

**Task Failure**:
```typescript
{
  taskId: "abc123",
  type: "tell",
  toTeam: "backend",
  success: false,
  error: "Process timeout after 30000ms",
  duration: 30001,
  completedAt: 1731355230000
}
```

**Queue Full**:
```typescript
// Throws error if queue has 100 pending tasks
throw new Error(
  `Queue for team 'backend' is full (100 tasks). Please wait.`
);
```

### Benefits

- **Non-Blocking**: Caller doesn't wait for async tasks to complete
- **Parallel Teams**: Different teams' queues process concurrently
- **Serial Within Team**: Messages to same team are processed in order
- **Backpressure**: 100-message limit prevents queue overload
- **Reactive**: Built on RxJS for robust async coordination

---

## 📡 MCP Protocol Implementation

### Understanding MCP

The Model Context Protocol uses JSON-RPC 2.0 for communication. From the [official MCP documentation](https://modelcontextprotocol.io):

> MCP provides a standardized way to connect LLMs with the context they need.

**Key Concepts:**

1. **Transport Layer:** stdio (standard input/output) or SSE (Server-Sent Events)
2. **Message Format:** JSON-RPC 2.0
3. **Core Primitives:**
   - **Tools:** Functions that AI can call
   - **Resources:** Data sources AI can access
   - **Prompts:** Reusable prompt templates

### MCP Server Initialization

Based on the [TypeScript SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Create MCP server
const server = new McpServer({
  name: 'teams-mcp',
  version: '1.0.0'
});

// Register tools
server.registerTool(
  'teams_ask',
  {
    title: 'Ask Team',
    description: 'Ask another team a question and wait for their response',
    inputSchema: {
      team_name: z.string().describe('Target team name'),
      question: z.string().describe('Question to ask')
    },
    outputSchema: {
      response: z.string(),
      team: z.string(),
      timestamp: z.number()
    }
  },
  async ({ team_name, question }) => {
    // Implementation here
  }
);

// Connect to stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Teams MCP server running'); // stderr for logging
}

main();
```

### Tool Registration Pattern

Each tool follows this structure:

```typescript
server.registerTool(
  'tool_name',           // Unique tool identifier
  {
    title: 'Human Readable Title',
    description: 'What this tool does',
    inputSchema: {       // Zod schema for validation
      param1: z.string(),
      param2: z.number().optional()
    },
    outputSchema: {      // Zod schema for response
      result: z.string()
    }
  },
  async (params) => {    // Implementation function
    // Tool logic here
    return {
      content: [
        {
          type: 'text',
          text: 'Response text'
        }
      ],
      structuredContent: { /* optional structured data */ }
    };
  }
);
```

### Protocol Versioning

MCP uses date-based versioning (YYYY-MM-DD format). From the [MCP specification](https://spec.modelcontextprotocol.io):

> The current protocol version is `2024-11-05`

Version negotiation happens during initialization:

```typescript
// Client sends
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": {
      "name": "Claude Desktop",
      "version": "1.0.0"
    }
  },
  "id": 1
}

// Server responds
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "teams-mcp",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": {}
    }
  },
  "id": 1
}
```

---

## 🌐 HTTP Transport Support

**Feature Added (2025-10-11)**: Iris MCP now supports HTTP transport in addition to stdio, enabling web clients and external integrations.

### Transport Modes

**Stdio Mode** (Default):
- Standard input/output communication
- Used by Claude Desktop and Claude Code CLI
- MCP protocol over stdin/stdout pipes

**HTTP Mode** (New):
- HTTP server with JSON-RPC 2.0 over POST requests
- Server-Sent Events (SSE) for streaming responses
- Stateless request handling with StreamableHTTPServerTransport

### Configuration

**teams.json**:
```json
{
  "settings": {
    "defaultTransport": "stdio",  // or "http"
    "httpPort": 1615,
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },
  "teams": {
    // ... team configurations
  }
}
```

### Command-Line Interface

**Start with stdio** (default):
```bash
$ iris-mcp
# or
$ iris-mcp --transport stdio
```

**Start with HTTP**:
```bash
$ iris-mcp --transport http --port 1615
# Server starts on http://localhost:1615
```

### HTTP Server Implementation

**src/index.ts**:
```typescript
async run(
  transport: "stdio" | "http" = "stdio",
  port: number = 1615
): Promise<void> {
  // Initialize session manager
  await this.sessionManager.initialize();

  if (transport === "http") {
    // HTTP transport mode
    const app = express();
    app.use(express.json());

    // MCP endpoint
    app.all("/mcp", async (req, res) => {
      // Create stateless transport for each request
      const httpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
        enableJsonResponse: true,
      });

      // Connect to MCP server
      await this.server.connect(httpTransport);

      // Handle request (POST for JSON-RPC, GET for SSE)
      await httpTransport.handleRequest(req, res, req.body);
    });

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        transport: "http",
        server: "@iris-mcp/server",
        version: "1.0.0",
      });
    });

    app.listen(port, () => {
      logger.info(`Iris MCP Server running on HTTP port ${port}`);
      logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
      logger.info(`Health check: http://localhost:${port}/health`);
    });
  } else {
    // Stdio transport mode
    const stdioTransport = new StdioServerTransport();
    await this.server.connect(stdioTransport);
    logger.info("Iris MCP Server running on stdio");
  }
}
```

### API Endpoints

**POST /mcp** - MCP JSON-RPC requests:
```bash
curl -X POST http://localhost:1615/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

**GET /health** - Health check:
```bash
curl http://localhost:1615/health

{
  "status": "ok",
  "transport": "http",
  "server": "@iris-mcp/server",
  "version": "1.0.0"
}
```

### Client Integration

**JavaScript/TypeScript**:
```typescript
// Connect to HTTP MCP server
const response = await fetch("http://localhost:1615/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "team_tell",
      arguments: {
        toTeam: "backend",
        message: "Deploy version 2.0",
        fromTeam: "frontend"
      }
    },
    id: 1
  })
});

const result = await response.json();
console.log(result.result);
```

**Python**:
```python
import requests

response = requests.post(
    "http://localhost:1615/mcp",
    json={
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "team_isAwake",
            "arguments": {"team": "backend"}
        },
        "id": 1
    }
)

print(response.json()["result"])
```

### Stateless vs Stateful

**Stateless Mode** (Current):
- Each HTTP request creates a new transport
- No session persistence across requests
- Suitable for RESTful API usage
- Transport destroyed after response sent

**Stateful Mode** (Future):
- Server-Sent Events (SSE) for persistent connections
- Session IDs track client state
- Real-time streaming of responses
- Planned for Phase 3

### Benefits

**HTTP Transport Advantages**:
- ✅ Web browser clients can connect directly
- ✅ External tools can integrate via HTTP API
- ✅ RESTful API pattern familiar to developers
- ✅ Health check endpoint for monitoring
- ✅ Supports CORS for cross-origin requests (configurable)

**Stdio Transport Advantages**:
- ✅ Direct integration with Claude Desktop/CLI
- ✅ No network overhead (process pipes)
- ✅ Simpler security model (no exposed ports)
- ✅ Better for local development

### Security Considerations

**HTTP Mode**:
- Currently no authentication (Phase 3 will add API keys)
- Bind to `localhost` only by default
- Consider firewall rules for production
- HTTPS recommended for production (use reverse proxy)

**Stdio Mode**:
- Process-level isolation
- No network exposure
- Suitable for local development and CLI usage

### Dependencies

HTTP transport requires:
- `express` ^4.18.2 - Web framework
- `@modelcontextprotocol/sdk` ^0.6.0 - StreamableHTTPServerTransport
- `commander` ^12.1.0 - CLI argument parsing

---

## 🔄 Process Management & Connection Pooling

### The Performance Problem

**Without Connection Pooling:**
```
Message 1: 5s startup + 2s execution = 7s total
Message 2: 5s startup + 2s execution = 7s total
Message 3: 5s startup + 2s execution = 7s total
────────────────────────────────────────────
Total: 21 seconds for 3 messages
```

**With Connection Pooling:**
```
Message 1: 5s startup + 2s execution = 7s total (cold start)
Message 2: 0s startup + 2s execution = 2s total (warm!)
Message 3: 0s startup + 2s execution = 2s total (warm!)
────────────────────────────────────────────
Total: 11 seconds for 3 messages (52% faster!)
```

### Process Pool Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ClaudeProcessPool                                           │
│                                                              │
│  Configuration:                                              │
│  • idleTimeout: 300000ms (5 minutes)                        │
│  • maxProcesses: 10                                         │
│  • healthCheckInterval: 30000ms                             │
│                                                              │
│  Active Processes Map:                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ "frontend" → ClaudeProcess {                         │  │
│  │   pid: 12345,                                        │  │
│  │   status: 'idle',                                    │  │
│  │   lastUsed: 1234567890,                              │  │
│  │   idleTimer: Timeout<5min>,                          │  │
│  │   messageQueue: [],                                  │  │
│  │   stdin: WritableStream,                             │  │
│  │   stdout: ReadableStream                             │  │
│  │ }                                                     │  │
│  │                                                       │  │
│  │ "backend" → ClaudeProcess {                          │  │
│  │   pid: 12346,                                        │  │
│  │   status: 'processing',                              │  │
│  │   lastUsed: 1234567895,                              │  │
│  │   idleTimer: null,                                   │  │
│  │   messageQueue: [Message],                           │  │
│  │   stdin: WritableStream,                             │  │
│  │   stdout: ReadableStream                             │  │
│  │ }                                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Methods:                                                    │
│  • getOrCreateProcess(teamName): ClaudeProcess              │
│  • terminateProcess(teamName): void                         │
│  • terminateAll(): void                                     │
│  • findLeastRecentlyUsed(): string                          │
│  • healthCheckAll(): void                                   │
└─────────────────────────────────────────────────────────────┘
```

### ClaudeProcess Lifecycle

```
┌─────────────┐
│   SPAWN     │  spawn('claude', [...])
└──────┬──────┘
       │
       │ Setup stdin/stdout pipes
       │ Start idle timer (5 min)
       │ Register in pool
       ▼
┌─────────────┐
│    IDLE     │  Waiting for messages
└──────┬──────┘  Timer counting down
       │
       │ Message received
       │ Reset timer
       │ Add to queue
       ▼
┌─────────────┐
│ PROCESSING  │  Executing message
└──────┬──────┘  Timer paused
       │
       │ Response received
       │ Restart timer
       ▼
┌─────────────┐
│    IDLE     │  Ready for next message
└──────┬──────┘  Timer counting down
       │
       │ Timeout (5 min elapsed)
       │ No messages
       ▼
┌─────────────┐
│ TERMINATING │  Kill process
└──────┬──────┘  Remove from pool
       │
       ▼
┌─────────────┐
│   STOPPED   │  Process exited
└─────────────┘  Resources freed
```

### Health Check System

```typescript
class ClaudeProcessPool {
  private healthCheckInterval: NodeJS.Timeout | null = null;

  startHealthChecks() {
    this.healthCheckInterval = setInterval(
      () => this.healthCheckAll(),
      this.config.healthCheckInterval
    );
  }

  async healthCheckAll() {
    for (const [teamName, process] of this.processes) {
      try {
        const healthy = await process.healthCheck();
        if (!healthy) {
          console.error(`Health check failed for ${teamName}, restarting...`);
          await this.terminateProcess(teamName);
          // Next request will create fresh process
        }
      } catch (error) {
        console.error(`Health check error for ${teamName}:`, error);
      }
    }
  }
}

class ClaudeProcess {
  async healthCheck(timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeout);

      // Send simple ping message
      const pingMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'ping' },
        session_id: `health-${Date.now()}`
      }) + '\n';

      const onData = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'result') {
            clearTimeout(timer);
            this.child.stdout!.off('data', onData);
            resolve(true);
          }
        } catch (e) {
          // Continue listening
        }
      };

      this.child.stdout!.on('data', onData);
      this.child.stdin!.write(pingMessage);
    });
  }
}
```

---

## 📁 Project Structure

```
iris-mcp/
├── package.json
├── tsconfig.json
├── README.md
├── BREAKING.md                      # Breaking changes documentation
├── CLAUDE.md                        # Project instructions for Claude Code
├── teams.json                       # Team registry configuration
├── src/
│   ├── index.ts                     # MCP server entry + action registration + HTTP/stdio
│   ├── iris.ts                      # IrisOrchestrator (Business Logic Layer)
│   │
│   ├── actions/                     # 🆕 Action-Based MCP Interface (Phase 1)
│   │   ├── index.ts                 # Action exports
│   │   ├── tell.ts                  # team_tell (sync/async/persistent)
│   │   ├── isAwake.ts               # team_isAwake (status check)
│   │   ├── wake.ts                  # team_wake (activate process)
│   │   ├── sleep.ts                 # team_sleep (deactivate process)
│   │   ├── wake-all.ts              # team_wake_all (bulk activation)
│   │   ├── report.ts                # team_report (view cache)
│   │   └── command.ts               # team_command (slash commands)
│   │
│   ├── async/                       # 🆕 Async Task Queue (Phase 1)
│   │   └── queue.ts                 # RxJS-based per-team queues
│   │
│   ├── session/                     # Session Management Layer
│   │   ├── session-manager.ts       # Main session orchestrator
│   │   ├── session-store.ts         # SQLite database wrapper
│   │   ├── path-utils.ts            # Session file path utilities
│   │   ├── validation.ts            # Session validation helpers
│   │   ├── metrics.ts               # Session analytics
│   │   └── types.ts                 # Session type definitions
│   │
│   ├── process-pool/
│   │   ├── pool-manager.ts          # ClaudeProcessPool (session-aware)
│   │   ├── claude-process.ts        # ClaudeProcess + static initializeSessionFile()
│   │   ├── claude-cache.ts          # 🆕 ClaudeCache (output caching)
│   │   └── types.ts                 # Process type definitions
│   │
│   ├── config/
│   │   └── teams-config.ts          # Configuration loader + hot-reload
│   │
│   ├── notifications/
│   │   └── queue.ts                 # SQLite persistent notification queue
│   │
│   └── utils/
│       ├── logger.ts                # Structured JSON logging to stderr
│       ├── validation.ts            # Input validation (teams, messages, timeouts)
│       └── errors.ts                # Custom error hierarchy
│
├── tests/
│   ├── unit/
│   │   ├── session/
│   │   │   └── session-manager.test.ts
│   │   ├── process-pool/
│   │   │   └── pool-manager.test.ts
│   │   └── tools/
│   │       ├── teams-ask.test.ts
│   │       └── teams-send-message.test.ts
│   ├── integration/
│   │   ├── session/
│   │   │   └── session-manager.test.ts  # Uses beforeAll pattern
│   │   ├── process/
│   │   │   ├── claude-process.test.ts
│   │   │   └── pool-manager.test.ts
│   │   └── tools/
│   │       └── mcp-tools.test.ts
│   └── fixtures/
│       └── mock-teams.json
│
├── data/                            # SQLite databases (gitignored)
│   ├── team-sessions.db             # Session metadata
│   └── notifications.db             # Notification queue
│
├── docs/
│   ├── ARCHITECTURE.md              # This file
│   ├── SESSION.md                   # Session management deep dive
│   └── future/                      # Future phase documentation
│
└── dist/                            # Compiled output (gitignored)
    ├── index.js
    └── ...
```

**Key Changes from Original Design (v1.0.0 - 2025-10-11):**
- **🆕 actions/:** Action-based MCP interface (replaced tools/)
- **🆕 async/:** RxJS-based async task queue for non-blocking operations
- **🆕 claude-cache.ts:** Structured output caching for debugging and analytics
- **🆕 HTTP transport:** Dual-mode operation (stdio + HTTP) with Commander CLI
- **🆕 iris.ts:** Business Logic Layer for orchestration
- **🆕 session/:** Complete session management subsystem
- **Updated:** Process pool now session-aware (requires sessionId)
- **Updated:** Actions use IrisOrchestrator instead of direct pool access

---

## 💻 Complete Implementation

### package.json

```json
{
  "name": "@teams-mcp/server",
  "version": "1.0.0",
  "description": "MCP server for cross-project Claude Code coordination",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "teams-mcp": "./dist/bin/teams-mcp.js"
  },
  "scripts": {
    "build": "tsc && node -e \"require('fs').chmodSync('dist/bin/teams-mcp.js', '755')\"",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "inspector": "npx @modelcontextprotocol/inspector dist/index.js",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.6.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.11.24",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  },
  "files": [
    "dist"
  ],
  "keywords": [
    "mcp",
    "claude",
    "claude-code",
    "multi-agent",
    "coordination",
    "team-collaboration"
  ],
  "author": "Your Name",
  "license": "MIT"
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### src/index.ts

```typescript
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfigManager } from './config/teams-config.js';
import { ClaudeProcessPool } from './process-pool/pool-manager.js';
import { SessionManager } from './session/session-manager.js';
import { IrisOrchestrator } from './iris.js';
import { NotificationQueue } from './notifications/queue.js';
import { Logger } from './utils/logger.js';
import { teamsAsk, teamsSendMessage, teamsNotify, teamsGetStatus } from './tools/index.js';

const logger = new Logger('server');

class IrisMcpServer {
  private server: Server;
  private configManager: ReturnType<typeof getConfigManager>;
  private sessionManager: SessionManager;
  private processPool: ClaudeProcessPool;
  private notificationQueue: NotificationQueue;
  private iris: IrisOrchestrator;

  constructor() {
    this.server = new Server(
      { name: "@iris-mcp/server", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    // Initialize components
    this.configManager = getConfigManager();
    const config = this.configManager.load();

    // LAYER 3: Infrastructure
    this.sessionManager = new SessionManager(config);
    this.processPool = new ClaudeProcessPool(this.configManager, config.settings);
    this.notificationQueue = new NotificationQueue();

    // LAYER 2: Business Logic
    this.iris = new IrisOrchestrator(this.sessionManager, this.processPool);

    // LAYER 1: MCP Transport
    this.setupHandlers();
    this.setupEventListeners();

    logger.info('Iris MCP Server initialized', {
      teams: Object.keys(config.teams),
      maxProcesses: config.settings.maxProcesses,
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'teams_ask':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await teamsAsk(args as any, this.iris), null, 2),
            }],
          };

        case 'teams_send_message':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await teamsSendMessage(args as any, this.iris), null, 2),
            }],
          };

        case 'teams_notify':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await teamsNotify(args as any, this.notificationQueue), null, 2),
            }],
          };

        case 'teams_get_status':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await teamsGetStatus(args as any, this.iris, this.configManager), null, 2),
            }],
          };

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async run() {
    // Initialize sessions (pre-create session files for all teams)
    await this.sessionManager.initialize();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down Iris MCP server...');
      await this.iris.shutdown();
      this.notificationQueue.close();
      process.exit(0);
    });

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('Iris MCP server running');
  }
}

// Start server
const server = new IrisMcpServer();
server.run().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
```

**Key Changes:**
- **Three-layer initialization:** Infrastructure → BLL → Transport
- **SessionManager:** Manages session database and file creation
- **IrisOrchestrator:** Coordinates SessionManager + PoolManager
- **Session pre-initialization:** `sessionManager.initialize()` creates session files on startup
- **Tool handlers:** Now pass `this.iris` instead of `this.processPool`

### src/iris.ts (Business Logic Layer)

```typescript
import { SessionManager } from "./session/session-manager.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("iris");

export interface SendMessageOptions {
  timeout?: number;
  waitForResponse?: boolean;
}

export class IrisOrchestrator {
  constructor(
    private sessionManager: SessionManager,
    private processPool: ClaudeProcessPool,
  ) {}

  /**
   * Send a message from one team to another
   * Orchestrates: Session lookup → Process spawn → Message send → Usage tracking
   */
  async sendMessage(
    fromTeam: string | null,
    toTeam: string,
    message: string,
    options: SendMessageOptions = {},
  ): Promise<string> {
    const { timeout = 30000, waitForResponse = true } = options;

    // Step 1: Get or create session for team pair
    const session = await this.sessionManager.getOrCreateSession(fromTeam, toTeam);

    logger.debug("Session obtained", { sessionId: session.sessionId });

    // Step 2: Get or create process with session ID
    const process = await this.processPool.getOrCreateProcess(
      toTeam,
      session.sessionId,
      fromTeam,
    );

    // Step 3: Check if process is still spawning
    const metrics = process.getMetrics();
    if (metrics.status === "spawning") {
      logger.info("Process is spawning, returning early");
      return "Session starting... Please retry your request in a moment.";
    }

    if (!waitForResponse) {
      // Fire-and-forget mode
      process.sendMessage(message, timeout).catch((error) => {
        logger.error("Fire-and-forget message failed", { error });
      });

      this.sessionManager.recordUsage(session.sessionId);
      this.sessionManager.incrementMessageCount(session.sessionId);

      return "Message sent (fire-and-forget mode)";
    }

    // Step 4: Send message and wait for response
    const response = await process.sendMessage(message, timeout);

    // Step 5: Track session usage and message count
    this.sessionManager.recordUsage(session.sessionId);
    this.sessionManager.incrementMessageCount(session.sessionId);

    return response;
  }

  /**
   * Ask a question (convenience wrapper for sendMessage)
   */
  async ask(
    fromTeam: string | null,
    toTeam: string,
    question: string,
    timeout?: number,
  ): Promise<string> {
    return this.sendMessage(fromTeam, toTeam, question, {
      timeout,
      waitForResponse: true,
    });
  }

  /**
   * Get system status (sessions + processes)
   */
  getStatus() {
    const sessionStats = this.sessionManager.getStats();
    const poolStatus = this.processPool.getStatus();

    return {
      sessions: { total: sessionStats.total, active: sessionStats.active },
      processes: { total: poolStatus.totalProcesses, maxProcesses: poolStatus.maxProcesses },
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Iris orchestrator");
    await this.processPool.terminateAll();
    this.sessionManager.close();
  }
}
```

### src/session/session-manager.ts (Excerpt)

```typescript
import { SessionStore } from "./session-store.js";
import { ClaudeProcess } from "../process-pool/claude-process.js";
import type { TeamsConfig, SessionInfo } from "./types.js";

export class SessionManager {
  private store: SessionStore;
  private teamsConfig: TeamsConfig;
  private sessionCache = new Map<string, SessionInfo>();

  constructor(teamsConfig: TeamsConfig, dbPath?: string) {
    this.teamsConfig = teamsConfig;
    this.store = new SessionStore(dbPath);
  }

  /**
   * Initialize: Pre-create session files for all teams
   */
  async initialize(): Promise<void> {
    for (const [teamName, teamConfig] of Object.entries(this.teamsConfig.teams)) {
      const existing = this.store.getByTeamPair(null, teamName);

      if (!existing) {
        const sessionId = generateSecureUUID();

        // Call static method to create session file
        await ClaudeProcess.initializeSessionFile(
          teamConfig,
          sessionId,
          this.teamsConfig.settings.sessionInitTimeout,
        );

        // Store in database
        this.store.create({
          fromTeam: null,
          toTeam: teamName,
          sessionId,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        });
      }
    }
  }

  /**
   * Get or create session for team pair
   */
  async getOrCreateSession(
    fromTeam: string | null,
    toTeam: string,
  ): Promise<SessionInfo> {
    // Check database
    const existing = this.store.getByTeamPair(fromTeam, toTeam);
    if (existing) return existing;

    // Create new session
    const sessionId = generateSecureUUID();
    const teamConfig = this.teamsConfig.teams[toTeam];

    await ClaudeProcess.initializeSessionFile(
      teamConfig,
      sessionId,
      this.teamsConfig.settings.sessionInitTimeout,
    );

    return this.store.create({
      fromTeam,
      toTeam,
      sessionId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  }

  recordUsage(sessionId: string): void {
    this.store.updateLastUsed(sessionId, Date.now());
  }

  incrementMessageCount(sessionId: string): void {
    this.store.incrementMessageCount(sessionId);
  }

  getStats() {
    return this.store.getStats();
  }

  close() {
    this.store.close();
  }
}
```

### src/process-pool/types.ts

```typescript
export interface ProcessPoolConfig {
  idleTimeout: number;
  maxProcesses: number;
  healthCheckInterval: number;
}

export interface TeamConfig {
  path: string;
  description: string;
  idleTimeout?: number;
  skipPermissions?: boolean;
}

export interface ProcessMessage {
  message: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export type ProcessStatus = 'spawning' | 'idle' | 'processing' | 'terminating' | 'stopped';

export interface ProcessMetrics {
  pid: number | undefined;
  status: ProcessStatus;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  idleTimeRemaining: number;
}
```

### src/process-pool/claude-process.ts (Excerpt)

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { ProcessMessage, ProcessStatus, TeamConfig } from './types.js';
import { Logger } from '../utils/logger.js';

export class ClaudeProcess extends EventEmitter {
  // Instance fields and constructor (same as before)...

  /**
   * 🆕 STATIC METHOD: Initialize session file
   * Creates a session JSONL file for a team using claude --session-id command
   */
  static async initializeSessionFile(
    teamConfig: TeamConfig,
    sessionId: string,
    sessionInitTimeout = 30000,
  ): Promise<void> {
    const logger = new Logger(`session-init:${sessionId.slice(0, 8)}`);

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let responseReceived = false;

      // Spawn: claude --session-id <uuid> --print ping
      const args = ['--session-id', sessionId, '--print', 'ping'];
      if (teamConfig.skipPermissions) {
        args.push('--dangerously-skip-permissions');
      }

      const claudeProcess = spawn('claude', args, {
        cwd: teamConfig.path,
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      // Compute session file path
      const homedir = process.env.HOME || process.env.USERPROFILE || '';
      const escapedPath = teamConfig.path.replace(/\\//g, '-');
      const sessionFilePath = `${homedir}/.claude/projects/${escapedPath}/${sessionId}.jsonl`;

      // Timeout handler with proper cleanup
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        if (!responseReceived) {
          logger.error('Session initialization timeout');
          claudeProcess.kill();
          reject(new ProcessError(`Session initialization timeout for ${sessionId}`));
        }
      }, sessionInitTimeout);

      // Watch for any stdout response
      claudeProcess.stdout?.on('data', (data) => {
        responseReceived = true;

        // Verify session file exists
        if (existsSync(sessionFilePath)) {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          claudeProcess.kill();
          logger.info('Session file created', { sessionFilePath });
          resolve();
        }
      });

      claudeProcess.on('exit', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        if (code !== 0 && !responseReceived) {
          reject(new ProcessError(`Session init exited with code ${code}`));
        }
      });
    });
  }

  constructor(
    teamName: string,
    teamConfig: TeamConfig,
    idleTimeout: number
  ) {
    super();
    this.teamName = teamName;
    this.teamConfig = teamConfig;
    this.idleTimeout = teamConfig.idleTimeout || idleTimeout;
    this.logger = new Logger(`claude-process:${teamName}`);

    // Spawn Claude Code process
    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json'
    ];

    if (teamConfig.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    this.child = spawn('claude', args, {
      cwd: teamConfig.path,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.logger.info('Process spawned', {
      pid: this.child.pid,
      cwd: teamConfig.path
    });

    this.setupListeners();
    this.status = 'idle';
    this.startIdleTimer();
  }

  private setupListeners() {
    let buffer = '';

    // Handle stdout
    this.child.stdout!.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          this.handleMessage(parsed);
        } catch (e) {
          this.logger.error('Failed to parse stdout', { line, error: e });
        }
      }
    });

    // Handle stderr (logging from Claude)
    this.child.stderr!.on('data', (data) => {
      this.logger.debug('Claude stderr', { data: data.toString() });
    });

    // Handle process exit
    this.child.on('close', (code) => {
      this.logger.info('Process closed', { code });
      this.status = 'stopped';
      this.emit('closed');
    });

    this.child.on('error', (error) => {
      this.logger.error('Process error', error);
      this.status = 'stopped';
      this.emit('error', error);
    });
  }

  private handleMessage(message: any) {
    this.logger.debug('Received message', { type: message.type });

    if (message.type === 'result' || message.type === 'error') {
      // Message processing complete
      if (this.currentMessage) {
        if (message.type === 'error') {
          this.currentMessage.reject(new Error(message.error));
        } else {
          this.currentMessage.resolve(message);
        }
        this.currentMessage = null;
        this.messagesProcessed++;
        this.lastUsed = Date.now();
      }

      // Process next queued message if any
      this.processNextMessage();
    }
  }

  async sendMessage(message: string): Promise<any> {
    this.logger.debug('Queueing message', { queueLength: this.messageQueue.length });

    return new Promise((resolve, reject) => {
      this.messageQueue.push({ message, resolve, reject });

      // If no message is currently being processed, start immediately
      if (!this.currentMessage) {
        this.processNextMessage();
      }
    });
  }

  private processNextMessage() {
    if (this.messageQueue.length === 0) {
      this.status = 'idle';
      this.startIdleTimer();
      return;
    }

    const { message, resolve, reject } = this.messageQueue.shift()!;
    this.currentMessage = { message, resolve, reject };
    this.status = 'processing';
    this.resetIdleTimer();

    const stdinMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: message
      },
      session_id: `teams-${this.teamName}-${Date.now()}`
    }) + '\n';

    this.logger.debug('Writing to stdin', { message: message.substring(0, 100) });
    this.child.stdin!.write(stdinMessage);
  }

  resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startIdleTimer() {
    this.resetIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.logger.info(`Idle timeout reached (${this.idleTimeout}ms)`);
      this.emit('idle-timeout');
    }, this.idleTimeout);
  }

  async healthCheck(timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeout);

      const pingMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'ping' },
        session_id: `health-${Date.now()}`
      }) + '\n';

      const onData = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'result') {
            clearTimeout(timer);
            this.child.stdout!.off('data', onData);
            resolve(true);
          }
        } catch (e) {
          // Continue listening
        }
      };

      this.child.stdout!.on('data', onData);
      this.child.stdin!.write(pingMessage);
    });
  }

  getMetrics(): any {
    return {
      pid: this.child.pid,
      status: this.status,
      messagesProcessed: this.messagesProcessed,
      lastUsed: this.lastUsed,
      uptime: Date.now() - this.spawnTime,
      idleTimeRemaining: this.idleTimer ? this.idleTimeout : 0,
      queueLength: this.messageQueue.length
    };
  }

  isHealthy(): boolean {
    return this.child.exitCode === null && !this.child.killed;
  }

  kill() {
    this.resetIdleTimer();
    if (this.child && !this.child.killed) {
      this.logger.info('Killing process');
      this.status = 'terminating';
      this.child.kill('SIGTERM');
    }
  }
}
```

### src/process-pool/pool-manager.ts (Excerpt)

```typescript
import { ClaudeProcess } from './claude-process.js';
import { ProcessPoolConfig } from './types.js';
import { Logger } from '../utils/logger.js';

export class ClaudeProcessPool {
  private processes: Map<string, ClaudeProcess> = new Map();
  private config: ProcessPoolConfig;
  private logger: Logger;

  constructor(
    private configManager: ReturnType<typeof getConfigManager>,
    config: ProcessPoolConfig
  ) {
    this.config = config;
    this.logger = new Logger('process-pool');
  }

  setTeamConfigs(configs: Record<string, TeamConfig>) {
    for (const [name, config] of Object.entries(configs)) {
      this.teamConfigs.set(name, config);
    }
  }

  /**
   * 🆕 Now requires sessionId parameter (breaking change)
   */
  async getOrCreateProcess(
    teamName: string,
    sessionId: string,           // NEW: Required for session-aware spawning
    fromTeam: string | null = null
  ): Promise<ClaudeProcess> {
    // Check if process already exists
    if (this.processes.has(teamName)) {
      const process = this.processes.get(teamName)!;

      // Health check
      if (process.isHealthy()) {
        this.logger.debug('Reusing existing process', { teamName, sessionId });
        process.resetIdleTimer();
        return process;
      } else {
        this.logger.warn('Process unhealthy, terminating', { teamName });
        await this.terminateProcess(teamName);
      }
    }

    // Check process limit (LRU eviction)
    if (this.processes.size >= this.config.maxProcesses) {
      const lru = this.findLeastRecentlyUsed();
      this.logger.info('Process limit reached, terminating LRU', {
        lru,
        limit: this.config.maxProcesses
      });
      await this.terminateProcess(lru);
    }

    // Create new process with session context
    return await this.createProcess(teamName);
  }

  private async createProcess(teamName: string): Promise<ClaudeProcess> {
    const teamConfig = this.teamConfigs.get(teamName);
    if (!teamConfig) {
      throw new Error(`Team "${teamName}" not found in configuration`);
    }

    this.logger.info('Creating new process', { teamName });

    const process = new ClaudeProcess(
      teamName,
      teamConfig,
      this.config.idleTimeout
    );

    // Auto-cleanup on idle timeout
    process.on('idle-timeout', () => {
      this.terminateProcess(teamName);
    });

    // Handle unexpected closure
    process.on('closed', () => {
      this.processes.delete(teamName);
    });

    this.processes.set(teamName, process);
    return process;
  }

  async terminateProcess(teamName: string) {
    const process = this.processes.get(teamName);
    if (process) {
      this.logger.info('Terminating process', { teamName });
      process.kill();
      this.processes.delete(teamName);
    }
  }

  async terminateAll() {
    this.logger.info('Terminating all processes', {
      count: this.processes.size
    });

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    for (const [teamName, process] of this.processes) {
      process.kill();
    }
    this.processes.clear();
  }

  private findLeastRecentlyUsed(): string {
    let oldest = { team: '', time: Date.now() };

    for (const [team, process] of this.processes) {
      const metrics = process.getMetrics();
      if (metrics.lastUsed < oldest.time) {
        oldest = { team, time: metrics.lastUsed };
      }
    }

    return oldest.team;
  }

  startHealthChecks() {
    this.healthCheckInterval = setInterval(
      () => this.healthCheckAll(),
      this.config.healthCheckInterval
    );

    this.logger.info('Health checks started', {
      interval: this.config.healthCheckInterval
    });
  }

  private async healthCheckAll() {
    for (const [teamName, process] of this.processes) {
      try {
        const healthy = await process.healthCheck();
        if (!healthy) {
          this.logger.error('Health check failed, restarting', { teamName });
          await this.terminateProcess(teamName);
        }
      } catch (error) {
        this.logger.error('Health check error', { teamName, error });
      }
    }
  }

  getStatus() {
    const status: any = {
      totalProcesses: this.processes.size,
      maxProcesses: this.config.maxProcesses,
      processes: {}
    };

    for (const [teamName, process] of this.processes) {
      status.processes[teamName] = process.getMetrics();
    }

    return status;
  }
}
```

### src/tools/teams-ask.ts

```typescript
import { z } from 'zod';
import { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('tool:teams_ask');

export function registerTeamsAsk(
  server: any,
  processPool: ClaudeProcessPool
) {
  server.registerTool(
    'teams_ask',
    {
      title: 'Ask Team',
      description: 'Ask another team a question and wait for their response. Use this when you need information about another team\'s codebase or decisions.',
      inputSchema: {
        team_name: z.string().describe('Target team name (e.g., "frontend", "backend")'),
        question: z.string().describe('Question to ask the team')
      },
      outputSchema: {
        response: z.string(),
        team: z.string(),
        timestamp: z.number()
      }
    },
    async ({ team_name, question }) => {
      logger.info('Processing teams_ask', { team_name, question: question.substring(0, 50) });

      try {
        // Get or create Claude process for target team
        const process = await processPool.getOrCreateProcess(team_name);

        // Send message and wait for response
        const response = await process.sendMessage(question);

        const result = {
          response: response.response || response.content || 'No response',
          team: team_name,
          timestamp: Date.now()
        };

        logger.info('teams_ask completed', { team_name });

        return {
          content: [
            {
              type: 'text',
              text: `Team ${team_name} responded:\n\n${result.response}`
            }
          ],
          structuredContent: result
        };
      } catch (error) {
        logger.error('teams_ask failed', { team_name, error });
        throw error;
      }
    }
  );
}
```

### src/tools/index.ts

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import { NotificationQueue } from '../notifications/queue.js';
import { registerTeamsAsk } from './teams-ask.js';
import { registerTeamsSendMessage } from './teams-send-message.js';
import { registerTeamsNotify } from './teams-notify.js';
import { registerTeamsGetStatus } from './teams-get-status.js';

export interface ToolContext {
  processPool: ClaudeProcessPool;
  notificationQueue: NotificationQueue;
  config: any;
}

export function registerTools(
  server: McpServer,
  context: ToolContext
) {
  registerTeamsAsk(server, context.processPool);
  registerTeamsSendMessage(server, context.processPool);
  registerTeamsNotify(server, context.notificationQueue);
  registerTeamsGetStatus(server, context.processPool, context.config);
}
```

---

## ⚙️ Configuration & Deployment

### teams.json Configuration

```json
{
  "settings": {
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },
  "teams": {
    "frontend": {
      "path": "/Users/dev/projects/acme-frontend",
      "description": "React TypeScript frontend with Tailwind",
      "idleTimeout": 600000,
      "skipPermissions": true
    },
    "backend": {
      "path": "/Users/dev/projects/acme-backend",
      "description": "Node.js Express REST API",
      "idleTimeout": 300000,
      "skipPermissions": true
    },
    "mobile": {
      "path": "/Users/dev/projects/acme-mobile",
      "description": "React Native mobile app",
      "idleTimeout": 300000,
      "skipPermissions": true
    }
  }
}
```

### Installation

**Global Installation:**
```bash
npm install -g @teams-mcp/server
```

**Project Installation:**
```bash
cd your-project
npm install @teams-mcp/server --save-dev
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "teams": {
      "command": "npx",
      "args": ["-y", "@teams-mcp/server"],
      "env": {
        "TEAMS_CONFIG": "/Users/you/.config/teams-mcp/teams.json",
        "TEAMS_IDLE_TIMEOUT": "300000",
        "TEAMS_MAX_PROCESSES": "10"
      }
    }
  }
}
```

### Claude Code CLI Configuration

```bash
# Add Teams MCP to Claude Code
claude mcp add teams \
  --scope user \
  --env TEAMS_CONFIG=/path/to/teams.json \
  -- npx -y @teams-mcp/server

# Verify installation
claude mcp list

# Test the server
claude mcp get teams
```

---

## 🧪 Testing & Debugging

### Using MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is essential for debugging:

```bash
# Build your server
npm run build

# Start inspector
npx @modelcontextprotocol/inspector dist/index.js

# Open browser to http://localhost:5173
# Connect to your MCP server
# Test tools interactively
```

### Unit Tests Example

**Testing Tool Handlers (with IrisOrchestrator mock):**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { teamsAsk } from '../src/tools/teams-ask.js';
import type { IrisOrchestrator } from '../src/iris.js';

describe('teams_ask', () => {
  it('should call iris.ask() with correct parameters', async () => {
    // Mock IrisOrchestrator
    const mockIris = {
      ask: vi.fn().mockResolvedValue('Test response'),
    } as unknown as IrisOrchestrator;

    const result = await teamsAsk(
      { team: 'backend', question: 'What is your API version?', fromTeam: 'frontend' },
      mockIris
    );

    expect(mockIris.ask).toHaveBeenCalledWith(
      'frontend',  // fromTeam
      'backend',   // toTeam
      'What is your API version?',  // question
      30000        // default timeout
    );
    expect(result.response).toBe('Test response');
  });
});
```

**Testing SessionManager (with ClaudeProcess static mock):**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../src/session/session-manager.js';
import { ClaudeProcess } from '../src/process-pool/claude-process.js';

describe('SessionManager', () => {
  beforeEach(() => {
    // Mock static method
    vi.spyOn(ClaudeProcess, 'initializeSessionFile').mockResolvedValue();
  });

  it('should initialize session file for new session', async () => {
    const manager = new SessionManager(mockConfig, ':memory:');

    const session = await manager.getOrCreateSession(null, 'team-alpha');

    expect(ClaudeProcess.initializeSessionFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/projects/team-alpha' }),
      expect.stringMatching(/^[0-9a-f-]{36}$/),  // UUID format
      30000
    );
    expect(session.sessionId).toBeDefined();
  });
});
```

**Integration Tests (using beforeAll for performance):**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SessionManager } from '../src/session/session-manager.js';

describe('SessionManager Integration', () => {
  let manager: SessionManager;

  // Use beforeAll instead of beforeEach (85% faster)
  beforeAll(async () => {
    manager = new SessionManager(config, ':memory:');
    await manager.initialize();  // Pre-create all session files once
  }, 120000);  // 2 minute timeout for initialization

  afterAll(() => {
    manager.close();
  });

  it('should return existing session for team pair', async () => {
    const session1 = await manager.getOrCreateSession(null, 'team-alpha');
    const session2 = await manager.getOrCreateSession(null, 'team-alpha');

    expect(session1.sessionId).toBe(session2.sessionId);
  });
});
```

### Logging Configuration

```typescript
// src/utils/logger.ts
export class Logger {
  constructor(private context: string) {}

  info(message: string, meta?: any) {
    console.error(JSON.stringify({
      level: 'info',
      context: this.context,
      message,
      ...meta,
      timestamp: new Date().toISOString()
    }));
  }

  error(message: string, error?: any) {
    console.error(JSON.stringify({
      level: 'error',
      context: this.context,
      message,
      error: error?.message || error,
      stack: error?.stack,
      timestamp: new Date().toISOString()
    }));
  }

  debug(message: string, meta?: any) {
    if (process.env.DEBUG) {
      console.error(JSON.stringify({
        level: 'debug',
        context: this.context,
        message,
        ...meta,
        timestamp: new Date().toISOString()
      }));
    }
  }
}
```

---

## 🚀 Production Considerations

### Performance Tuning

**Idle Timeout Configuration:**
- **Short timeout (1-2 min):** Lower memory usage, more cold starts
- **Medium timeout (5 min):** Balanced (recommended)
- **Long timeout (15+ min):** Faster responses, higher memory usage

**Max Processes:**
- **Low (3-5):** Suitable for small teams, limited RAM
- **Medium (10-15):** Recommended for most cases
- **High (20+):** Large organizations, requires significant RAM

**Memory Usage Estimates:**
```
Per Claude Code Process: ~150-250 MB
10 idle processes: ~2 GB RAM
20 idle processes: ~4 GB RAM
```

### Security Considerations

1. **File System Access**
   - Each team's Claude instance only has access to its configured directory
   - Use `--dangerously-skip-permissions` only in trusted environments
   - Consider running in sandboxed containers

2. **Message Validation**
   - All inputs validated with Zod schemas
   - Sanitize team names to prevent path traversal
   - Rate limit tool calls per team

3. **Process Isolation**
   - Each Claude process runs in separate cwd
   - No shared state between processes
   - Processes can't access parent Teams MCP server memory

### Monitoring & Observability

**Key Metrics to Track:**
- Active process count
- Messages processed per team
- Average response time
- Health check failures
- Process spawn/terminate events

**Logging Best Practices:**
- Use structured JSON logs
- Log to stderr (MCP uses stdout for protocol)
- Include correlation IDs for request tracing
- Set appropriate log levels (info/debug/error)

### Error Handling

```typescript
// Graceful degradation
try {
  const process = await pool.getOrCreateProcess(teamName);
  const response = await process.sendMessage(question);
  return response;
} catch (error) {
  if (error.message.includes('timeout')) {
    // Retry once
    const process = await pool.getOrCreateProcess(teamName);
    return await process.sendMessage(question);
  }

  // Fall back to error message
  return {
    error: true,
    message: `Failed to contact team ${teamName}: ${error.message}`
  };
}
```

---

## 📚 API Reference

### MCP Actions

**Note**: All action names follow the `team_*` convention (verb-based naming for natural language interaction).

#### team_tell

Unified communication action supporting synchronous, asynchronous, and persistent modes.

**Parameters:**
- `toTeam` (string, required): Target team identifier
- `message` (string, required): Message content
- `fromTeam` (string, optional): Source team identifier
- `waitForResponse` (boolean, optional): Wait for response (default: true)
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)
- `persist` (boolean, optional): Use persistent queue (default: false)
- `ttlDays` (number, optional): TTL for persistent messages (default: 30)

**Returns:**
```typescript
{
  success: boolean;
  response?: string;         // Only if waitForResponse=true
  taskId?: string;           // Only if waitForResponse=false
  message: string;
}
```

**Modes:**
1. **Synchronous** (default): `waitForResponse=true` - Tell and wait for response
2. **Asynchronous**: `waitForResponse=false` - Fire-and-forget via AsyncQueue
3. **Persistent**: `persist=true` - Queue in SQLite notification table

**Examples:**
```typescript
// Synchronous mode (wait for response)
await team_tell({
  toTeam: "backend",
  message: "What database migration system do you use?",
  fromTeam: "frontend",
  waitForResponse: true,
  timeout: 30000
})
// Returns: { success: true, response: "We use Prisma for migrations..." }

// Asynchronous mode (fire-and-forget)
await team_tell({
  toTeam: "backend",
  message: "Deploy version 2.0",
  fromTeam: "frontend",
  waitForResponse: false
})
// Returns: { success: true, taskId: "abc123", message: "Message enqueued..." }

// Persistent mode (survives server restarts)
await team_tell({
  toTeam: "backend",
  message: "Review security audit",
  fromTeam: "frontend",
  persist: true,
  ttlDays: 7
})
// Returns: { success: true, message: "Message persisted to queue" }
```

#### team_isAwake

Check if teams are awake (active) or asleep (inactive).

**Parameters:**
- `team` (string, optional): Specific team or omit for all
- `includeNotifications` (boolean, optional): Include notification counts (default: false)

**Returns:**
```typescript
{
  teams: {
    [teamName: string]: {
      status: 'idle' | 'processing' | 'stopped';
      pid?: number;
      lastUsed?: number;
      messagesProcessed?: number;
      queueLength?: number;
      notifications?: number;  // If includeNotifications=true
    }
  };
  poolStatus: {
    totalProcesses: number;
    maxProcesses: number;
  };
}
```

**Example:**
```typescript
await team_isAwake({ team: "backend", includeNotifications: true })
// Returns: { teams: { backend: { status: 'idle', pid: 12345, ... } } }
```

#### team_wake

Activate a team's Claude process (ensure it's running in the pool).

**Parameters:**
- `team` (string, required): Team to activate
- `fromTeam` (string, optional): Source team identifier

**Returns:**
```typescript
{
  success: boolean;
  message: string;
  status: 'spawned' | 'already_active';
  pid?: number;
}
```

**Example:**
```typescript
await team_wake({ team: "backend", fromTeam: "frontend" })
// Returns: { success: true, message: "Team 'backend' is now active", status: 'spawned' }
```

#### team_sleep

Deactivate a team's Claude process (terminate and free resources).

**Parameters:**
- `team` (string, required): Team to deactivate
- `fromTeam` (string, optional): Source team identifier
- `force` (boolean, optional): Force termination even if busy (default: false)

**Returns:**
```typescript
{
  success: boolean;
  message: string;
}
```

**Example:**
```typescript
await team_sleep({ team: "backend", fromTeam: "frontend" })
// Returns: { success: true, message: "Team 'backend' has been put to sleep" }
```

#### team_wake_all

Activate all configured teams' Claude processes.

**Parameters:**
- `fromTeam` (string, optional): Source team identifier
- `parallel` (boolean, optional): Spawn processes concurrently (default: false)

**Returns:**
```typescript
{
  success: boolean;
  message: string;
  results: {
    [teamName: string]: {
      success: boolean;
      status: 'spawned' | 'already_active' | 'failed';
      error?: string;
    }
  };
}
```

**Example:**
```typescript
await team_wake_all({ fromTeam: "frontend", parallel: true })
// Returns: { success: true, message: "All teams activated", results: {...} }
```

#### team_report

View cached stdout/stderr from team's process without clearing it.

**Parameters:**
- `team` (string, required): Team to get report from
- `fromTeam` (string, optional): Source team identifier

**Returns:**
```typescript
{
  success: boolean;
  team: string;
  cache: {
    totalMessages: number;
    pendingMessages: number;
    completedMessages: number;
    errorMessages: number;
    averageDuration: number;
    recentMessages: MessageExchange[];
  };
}
```

**MessageExchange Structure:**
```typescript
{
  id: string;
  request: string;
  response: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  error?: string;
  metadata?: {
    tokenCount?: number;
    cost?: number;
    model?: string;
  };
}
```

**Example:**
```typescript
await team_report({ team: "backend", fromTeam: "frontend" })
// Returns: { success: true, cache: { totalMessages: 42, recentMessages: [...] } }
```

#### team_command

Execute slash commands on team's Claude instance.

**Parameters:**
- `team` (string, required): Target team
- `command` (string, required): Command to execute (e.g., "compact")
- `args` (string, optional): Command arguments
- `fromTeam` (string, optional): Source team identifier

**Returns:**
```typescript
{
  success: boolean;
  taskId: string;
  message: string;
}
```

**Supported Commands:**
- `/compact` - Compact session history to reduce context size

**Example:**
```typescript
await team_command({ team: "backend", command: "compact", fromTeam: "frontend" })
// Returns: { success: true, taskId: "abc123", message: "Command /compact enqueued..." }
```

---

## 🎯 Conclusion

This architecture provides a production-ready foundation for Teams MCP. Key highlights:

✅ **52%+ performance improvement** with connection pooling
✅ **Full MCP protocol compliance** using official SDK
✅ **Robust process management** with health checks
✅ **Comprehensive error handling** and logging
✅ **Scalable to 10+ concurrent teams**
✅ **Memory efficient** with configurable limits

### Next Steps

1. **Implement remaining tools** (teams_notify, teams_get_status)
2. **Add notification queue** with SQLite
3. **Write comprehensive tests** (unit + integration)
4. **Create example configurations** for common setups
5. **Publish to npm** as `@teams-mcp/server`
6. **Document real-world use cases** with screenshots

### Resources

- [MCP Official Documentation](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification](https://spec.modelcontextprotocol.io)
- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Claude Code CLI Reference](https://docs.claude.com/en/docs/claude-code/cli-reference)

---

**Ready to build the future of cross-project AI collaboration!** 🚀
