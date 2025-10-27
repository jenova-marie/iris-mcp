<div align="center">
  <img src="resources/iris-mcp.png" alt="Iris MCP Logo" width="200" height="200">

  <br/>

  <img src="resources/iris-mcp-title.svg" alt="Iris MCP" width="500">

  **Model Context Protocol server for cross-project Claude Code coordination**

  [![Build Status](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml)
  [![codecov](https://codecov.io/gh/jenova-marie/iris-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/jenova-marie/iris-mcp)
  [![npm version](https://badge.fury.io/js/@iris-mcp%2Fserver.svg)](https://badge.fury.io/js/@iris-mcp%2Fserver)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

  Iris MCP enables Claude Code instances across different project directories to communicate and coordinate. Stay in one project while orchestrating teams across your entire codebase ecosystem.
</div>

---

## 🎯 What is Iris MCP?

Iris MCP is a **groundbreaking Model Context Protocol server** that enables direct communication between Claude Code instances across different project directories, machines, and networks, creating the **first true cross-codebase AI collaboration system with remote orchestration**.

### The Problem

Modern software development involves multiple codebases (frontend, backend, mobile, infrastructure) that must stay synchronized. Currently, when you need to coordinate changes across projects:

1. **Context Switch**: Stop work, manually navigate to other project
2. **Launch New Claude**: Start fresh Claude Code session, losing context
3. **Explain Everything**: Re-explain what changed and why
4. **Copy/Paste**: Manually transfer information between projects
5. **Repeat**: Do this for every affected project

This workflow is **slow, error-prone, and breaks your flow state**. Studies show developers lose **23 minutes of productivity** on average when context switching.

### The Iris Solution

Stay in your current project while Claude coordinates with other teams automatically:

```
You (in frontend project):
"Ask the backend team what their API versioning strategy is"

Claude (frontend) → Iris MCP → Claude (backend) → analyzes backend code → responds
                                                                          ↓
"The backend team uses semantic versioning with /api/v1, /api/v2 prefixes"
```

**You never left the frontend project.** Iris handled the coordination automatically.

### What Makes Iris Revolutionary

Iris fills **critical gaps** that no existing multi-agent system addresses:

| Feature | Iris MCP | Symphony of One | Claude-Flow | Agent-MCP | Others |
|---------|-----------|-----------------|-------------|-----------|--------|
| **Cross-Project Communication** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Independent Team Contexts** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Direct Agent-to-Agent Messaging** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Per-Team MCP Server Access** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Zero Shared State** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Natural Language Coordination** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Remote Execution via SSH** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Bidirectional SSH Tunneling** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Session Persistence** | ✅ | ❌ | ❌ | ❌ | ❌ |

**All existing solutions** work within a **single project boundary**. Iris breaks this limitation by enabling communication between completely independent codebases, each with their own:
- Directory structure and dependencies
- `.claude/` configuration
- Session/Context
- MCP servers and tools
- Git repositories
- Team-specific context

### Context Isolation = Better Results

Each team's Claude instance maintains **complete context isolation**, meaning **more accurate, specialized responses**:

```
Team Frontend Claude knows:
✅ React components, Tailwind classes, Redux patterns
✅ Frontend-specific MCP servers (Figma, Storybook)
✅ Frontend CLAUDE.md instructions
❌ Backend database schemas (not needed!)
❌ Mobile iOS/Android specifics (not needed!)

Team Backend Claude knows:
✅ Database schemas, API endpoints, migrations
✅ Backend-specific MCP servers (PostgreSQL, Redis)
✅ Backend CLAUDE.md instructions
❌ Frontend component structure (not needed!)
```

Your frontend in TypeScript/React can coordinate with your backend in Python/Django, and your mobile app in Swift—**all simultaneously, all with perfect context**.

### Real Developer Pain Solved

From GitHub Issue [#2929](https://github.com/anthropics/claude-code/issues/2929):

> "Use cases are infinite. I could have a specialist claude run on my specific server answering to natural language requests, while a local generalist claude call it, having no clue of the specific API."

**Developers are already asking for this!** Iris MCP delivers it.

---

## ✨ Key Features

### Core MCP Server (Phase 1) ✅

- **17 MCP Tools** for comprehensive team coordination
- **Process Pooling** with LRU eviction (10-20x performance improvement)
- **Session Persistence** with SQLite database
- **Transport Abstraction** (Local, SSH, RemoteSSH2)
- **Remote Execution** via OpenSSH client or ssh2 library
- **Reverse MCP Tunneling** for bidirectional communication
- **Session MCP Configuration** with sessionId-based routing
- **Permission Approval System** (yes/no/ask/forward modes)
- **Hot-Reloadable Configuration** with environment variable interpolation
- **Wonder Logger** with OpenTelemetry integration
- **Event-Driven Architecture** with RxJS observables

### Web Dashboard (Phase 2) ✅

- **React SPA** with real-time monitoring
- **WebSocket Integration** for live updates
- **Permission Approval Modal** for interactive approval
- **Log Viewer** with filtering and search
- **Process Monitoring** with health metrics
- **Configuration Editor** for team management

### Remote Teams

Execute Claude Code on **remote machines via SSH** while maintaining local orchestration:

```yaml
teams:
  team-production:
    remote: "ssh user@prod-server"
    claudePath: "~/.local/bin/claude"
    path: "/opt/production/app"
    enableReverseMcp: true  # Enable bidirectional tunneling
```

**Capabilities**:
- Execute on remote servers without local codebase
- Automatic SSH tunnel establishment
- Reverse MCP tunneling for remote→local communication
- Dual SSH implementation (OpenSSH client + ssh2 library)
- Session persistence across SSH connections

### Reverse MCP Tunneling

**Bidirectional orchestration** where remote teams can coordinate local teams:

```
Local Machine ←────SSH Tunnel────→ Remote Machine
  (Iris MCP)      -R 1615:...         (Claude Code)
      ↑                                      │
      └──────── HTTP via tunnel ─────────────┘
```

Remote Claude instances can use Iris MCP tools to:
- Wake local teams
- Send messages to local teams
- Fork local sessions for debugging
- List all configured teams

**Security**: SSH-encrypted tunneling, permission approval system, localhost-only binding.

---

## 🚀 Quick Start

**New to Iris?** Check out **[GETTING_STARTED.md](./GETTING_STARTED.md)** for a complete setup guide!

### One-Command Installation

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/jenova-marie/iris-mcp/main/setup.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/jenova-marie/iris-mcp/main/setup.ps1 | iex
```

> **Note**: The PowerShell script is untested on real Windows systems. If you encounter errors, please [open an issue](https://github.com/jenova-marie/iris-mcp/issues) with error details or submit a PR with fixes. We appreciate your help! 🙏

These interactive scripts will:
- ✓ Check prerequisites (Node.js 18+)
- ✓ Install Iris MCP globally
- ✓ Guide you through team configuration
- ✓ Connect to Claude Code
- ✓ Start the server

**That's it!** You'll be coordinating AI teams in under 5 minutes. 🚀

### Manual Installation

```bash
# Install globally from npm
npm install -g @jenova-marie/iris-mcp

# Verify installation
iris-mcp --version

# Add your projects as teams
iris-mcp add-team frontend ~/code/my-frontend
iris-mcp add-team backend ~/code/my-backend

# Connect to Claude Code
iris-mcp install

# Start the server
iris-mcp
```

See **[GETTING_STARTED.md](./GETTING_STARTED.md)** for detailed usage examples and troubleshooting.

---

## 🛠️ MCP Tools

Iris MCP provides **17 comprehensive tools** for team coordination:

### Communication Tools

#### `send_message`
**Send a message to a team and wait for response.**

```javascript
{
  fromTeam: "team-frontend",
  toTeam: "team-backend",
  message: "What authentication strategy do you use?",
  timeout: 30000  // optional, default 30s
}
```

**Modes**:
- `timeout > 0`: Wait for response (default)
- `timeout: -1`: Fire-and-forget (async)
- `persist: true`: Queue in database for later

**Example prompts**:
- "Tell the backend team about the breaking API change"
- "Ask mobile team if they support push notifications"

---

#### `ask_message`
**Semantic alias for send_message emphasizing questions.**

```javascript
{
  fromTeam: "team-frontend",
  toTeam: "team-backend",
  message: "What database migration system do you use?",
  timeout: 30000
}
```

**Example prompts**:
- "Ask the backend team about their authentication strategy"
- "Find out from mobile team what iOS version they target"

---

#### `quick_message`
**Fire-and-forget messaging without waiting for response.**

```javascript
{
  fromTeam: "team-backend",
  toTeam: "team-frontend",
  message: "New API endpoint deployed: GET /api/v2/users"
}
```

**Example prompts**:
- "Quickly tell frontend team the deployment is complete"
- "Notify all teams about the maintenance window"

---

### Session Management Tools

#### `session_reboot`
**Create a brand new session with fresh UUID.**

```javascript
{
  fromTeam: "team-iris",
  toTeam: "team-backend"
}
```

Terminates existing process and creates new session with clean slate.

---

#### `session_delete`
**Permanently delete a session without creating replacement.**

```javascript
{
  fromTeam: "team-iris",
  toTeam: "team-backend"
}
```

---

#### `session_fork`
**Launch interactive terminal window for manual interaction.**

```javascript
{
  fromTeam: "team-iris",
  toTeam: "team-backend"
}
```

Opens separate terminal with `claude --resume --fork-session` for direct interaction.

---

#### `session_cancel`
**Cancel a running session operation.**

```javascript
{
  fromTeam: "team-iris",
  team: "team-backend"
}
```

Attempts to interrupt long-running operations by sending ESC to stdin.

---

#### `session_report`
**View conversation history for a session.**

```javascript
{
  fromTeam: "team-iris",
  team: "team-backend"
}
```

Returns complete conversation cache including all messages and protocol responses.

---

### Process Management Tools

#### `team_wake`
**Wake up a team by ensuring its process is active.**

```javascript
{
  fromTeam: "team-iris",
  team: "team-backend"
}
```

Creates session-specific process (e.g., `iris->backend`) for conversation isolation.

---

#### `team_launch`
**Semantic alias for team_wake emphasizing activation.**

```javascript
{
  fromTeam: "team-iris",
  team: "team-backend"
}
```

---

#### `team_sleep`
**Put a team to sleep by terminating its process.**

```javascript
{
  fromTeam: "team-iris",
  team: "team-backend",
  force: false  // optional
}
```

---

#### `team_wake_all`
**Wake all configured teams sequentially.**

```javascript
{
  fromTeam: "team-iris",
  parallel: false  // NOT RECOMMENDED - unstable
}
```

**Warning**: Parallel mode causes timeouts due to simultaneous Claude spawning.

---

#### `team_status`
**Get status of teams, processes, and notifications.**

```javascript
{
  fromTeam: "team-iris",
  team: "team-backend",  // optional, omit for all teams
  includeNotifications: true  // optional, default true
}
```

**Response**:
```json
{
  "teams": [{
    "name": "team-backend",
    "path": "/Users/you/projects/backend",
    "active": true,
    "processInfo": {
      "status": "idle",
      "pid": 12345,
      "uptime": 180000
    },
    "sessionInfo": {
      "sessionId": "abc-123",
      "messageCount": 47,
      "lastUsed": 1704067200000
    }
  }],
  "pool": {
    "totalProcesses": 3,
    "maxProcesses": 10
  }
}
```

---

### Utility Tools

#### `list_teams`
**List all configured teams.**

```javascript
{}
```

Returns team names with configuration details (path, description, color, settings).

---

#### `get_logs`
**Query in-memory logs from Iris MCP server.**

```javascript
{
  logs_since: 1704067200000,  // optional timestamp
  level: "error",             // optional: 'trace'|'debug'|'info'|'warn'|'error'|'fatal'
  format: "parsed"            // optional: 'raw'|'parsed'
}
```

---

#### `get_date`
**Get current system date and time.**

```javascript
{}
```

Returns ISO 8601, UTC string, Unix timestamp, and detailed components.

---

#### `permissions__approve`
**Permission approval handler for Claude Code's `--permission-prompt-tool`.**

```javascript
{
  tool_name: "mcp__iris__team_wake",
  input: { team: "team-backend" },
  reason: "Need to coordinate deployment"
}
```

Auto-approves all `mcp__iris__*` tools, denies everything else.

---

## 📁 Project Structure

```
iris-mcp/
├── src/
│   ├── index.ts                      # MCP server entry point
│   ├── iris.ts                       # IrisOrchestrator (Business Logic Layer)
│   ├── config/
│   │   ├── teams-config.ts           # Configuration with Zod validation
│   │   └── iris-config.ts            # Config schema and types
│   ├── session/
│   │   ├── session-manager.ts        # Session database and file management
│   │   ├── session-store.ts          # SQLite session store
│   │   ├── path-utils.ts             # Session file path utilities
│   │   └── types.ts                  # Session interfaces
│   ├── process-pool/
│   │   ├── pool-manager.ts           # Process pool with LRU eviction
│   │   ├── claude-process.ts         # Claude process wrapper
│   │   └── types.ts                  # Process interfaces
│   ├── transport/
│   │   ├── base-transport.ts         # Transport abstraction interface
│   │   ├── local-transport.ts        # Local process execution
│   │   ├── ssh-transport.ts          # OpenSSH client execution
│   │   └── remote-ssh2-transport.ts  # ssh2 library execution
│   ├── actions/
│   │   ├── send-message.ts           # send_message tool
│   │   ├── ask-message.ts            # ask_message tool
│   │   ├── quick-message.ts          # quick_message tool
│   │   ├── session-reboot.ts         # session_reboot tool
│   │   ├── session-delete.ts         # session_delete tool
│   │   ├── session-fork.ts           # session_fork tool
│   │   ├── session-cancel.ts         # session_cancel tool
│   │   ├── team-wake.ts              # team_wake tool
│   │   ├── team-launch.ts            # team_launch tool
│   │   ├── team-sleep.ts             # team_sleep tool
│   │   ├── team-wake-all.ts          # team_wake_all tool
│   │   ├── team-status.ts            # team_status tool
│   │   ├── session-report.ts         # session_report tool
│   │   ├── list-teams.ts             # list_teams tool
│   │   ├── get-logs.ts               # get_logs tool
│   │   ├── get-date.ts               # get_date tool
│   │   └── grant-permission.ts       # permissions__approve tool
│   ├── dashboard/
│   │   ├── app.tsx                   # React SPA entry point
│   │   ├── components/               # React components
│   │   └── server.ts                 # Express + WebSocket backend
│   ├── notifications/
│   │   ├── queue.ts                  # SQLite notification queue
│   │   └── schema.sql                # Database schema
│   ├── logging/
│   │   ├── wonder-logger.ts          # Wonder Logger implementation
│   │   └── opentelemetry.ts          # OpenTelemetry integration
│   └── utils/
│       ├── logger.ts                 # Structured logging to stderr
│       ├── errors.ts                 # Custom error hierarchy
│       ├── validation.ts             # Input validation
│       └── env-interpolation.ts      # Environment variable interpolation
├── docs/
│   ├── CONCEPT.md                    # Vision and conceptual overview
│   ├── ARCHITECTURE.md               # System design and components
│   ├── ACTIONS.md                    # All 17 MCP tools documentation
│   ├── CONFIG.md                     # Configuration management
│   ├── SESSION.md                    # Session management deep dive
│   ├── REMOTE.md                     # Remote execution via SSH
│   ├── REVERSE_MCP.md                # Bidirectional SSH tunneling
│   ├── DASHBOARD.md                  # Web dashboard documentation
│   ├── FEATURES.md                   # Comprehensive feature inventory
│   └── NOMENCLATURE.md               # Core concepts and terminology
├── data/
│   ├── team-sessions.db              # Session database (auto-created)
│   └── notifications.db              # Notification queue (auto-created)
├── config.yaml                       # Your team configuration
└── package.json
```

---

## 🏗️ Architecture

### Three-Layer Design

Iris uses a clean three-layer architecture with strict separation of concerns:

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
│SQLite        │  │Transport Abstraction│
└──────────────┘  └─────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
       ┌─────────────┐        ┌──────────────┐
       │LocalTransport│        │SSHTransport  │
       └─────────────┘        └──────────────┘
```

**Layer 1: IrisOrchestrator (Business Logic Layer)**
- Coordinates SessionManager + ClaudeProcessPool
- Implements complete message flow
- Provides API for MCP tools
- RxJS-based reactive architecture

**Layer 2: SessionManager + ClaudeProcessPool**
- **SessionManager**: Session database management, file validation, 60s caching
- **ClaudeProcessPool**: Process lifecycle, LRU eviction, health monitoring
- Strict separation: SessionManager does NOT spawn processes, Pool does NOT manage sessions

**Layer 3: SessionStore + ClaudeProcess**
- **SessionStore**: SQLite persistence with WAL mode
- **ClaudeProcess**: Transport abstraction (Local, SSH, RemoteSSH2)

### Transport Abstraction

Iris supports multiple execution modes via pluggable transports:

**LocalTransport**:
- Direct child process execution via Node.js `spawn()`
- Lowest latency, highest reliability
- Used for local teams

**SSHTransport** (OpenSSH client):
- Execute remote Claude via `ssh user@host`
- Requires OpenSSH client installed
- Best performance for remote execution
- Production-ready, battle-tested

**RemoteSSH2Transport** (ssh2 library):
- Pure Node.js SSH implementation
- No external dependencies
- Platform-independent
- Experimental, for environments without SSH client

### Session Persistence

**Persistent team-to-team sessions** maintain conversation continuity:

- Each `(fromTeam, toTeam)` pair has exactly one session (e.g., `iris→backend`, `backend→frontend`)
- ALL sessions require both fromTeam and toTeam (no null sessions)
- Sessions stored at `~/.claude/projects/{escaped-path}/{sessionId}.jsonl`
- Database tracks metadata (message count, last used, status)
- Sessions resume across process restarts

**Schema**:
```sql
CREATE TABLE sessions (
  pool_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Process Pool Management

Iris maintains a pool of Claude Code processes with:

- **LRU Eviction**: When pool is full, least recently used process is terminated
- **Idle Timeout**: Processes automatically terminate after 1 hour of inactivity (configurable)
- **Health Checks**: Regular monitoring ensures processes stay healthy (every 30s)
- **Warm Starts**: Reuses existing processes for **10-20x faster responses**
- **Session Resumption**: Each process resumes its specific session via `--resume <sessionId>`

**Two-Timeout Architecture**:
- `responseTimeout`: How long to wait for Claude to respond (default: 2 minutes)
- `mcpTimeout`: Maximum time for MCP server communication (default: 5 seconds)

### Reactive Architecture

Iris uses **RxJS observables** for event-driven communication:

```typescript
// Process events as Observable streams
process.events$
  .pipe(
    filter(event => event.type === 'message-response'),
    timeout(responseTimeout),
    catchError(err => of({ type: 'error', error: err }))
  )
  .subscribe(handleResponse);
```

**Benefits**:
- Composable event handling
- Automatic timeout management
- Error recovery with retry logic
- Backpressure handling

### Session MCP Configuration

Remote teams can be configured with **Session MCP** - per-session MCP configuration:

```yaml
teams:
  team-remote:
    remote: "ssh user@remote-host"
    sessionMcpEnabled: true
    sessionMcpPath: "/path/to/session-mcp-server"
```

Each session gets its own MCP server instance with session-specific context.

### Wonder Logger

**OpenTelemetry-based observability** with structured logging:

```typescript
logger.info('Process spawned', {
  poolKey: 'iris->backend',
  sessionId: 'abc-123',
  pid: 12345,
  transport: 'ssh'
});
```

**Features**:
- Structured JSON logging to stderr
- OpenTelemetry spans and traces
- Context propagation across async boundaries
- Log aggregation support (Grafana, Datadog, etc.)

### Permission Approval System

Four modes for controlling team actions:

- **`yes`**: Auto-approve all actions (default)
- **`no`**: Auto-deny all actions (read-only mode)
- **`ask`**: Prompt user for each action (via Dashboard)
- **`forward`**: Forward permission request to calling team

```yaml
teams:
  team-production:
    grantPermission: ask  # Require approval for all actions
```

---

## 🎯 Configuration

### Example Configuration

```yaml
settings:
  # Process Timeouts
  sessionInitTimeout: 30000     # 30 seconds for session creation
  spawnTimeout: 20000           # 20 seconds for process spawn
  responseTimeout: 120000       # 2 minutes for Claude response
  mcpTimeout: 5000              # 5 seconds for MCP server communication

  # Process Pool
  idleTimeout: 3600000          # 1 hour idle before termination
  maxProcesses: 10              # Max concurrent processes
  healthCheckInterval: 30000    # 30 seconds health check

  # Server
  httpPort: ${IRIS_HTTP_PORT:-1615}
  defaultTransport: http        # stdio or http

teams:
  # Local Team
  team-frontend:
    path: /Users/you/projects/frontend
    description: React frontend application
    idleTimeout: 600000         # 10 minutes (override)
    grantPermission: yes
    color: "#61DAFB"

  # Remote Team with Reverse MCP
  team-production:
    remote: "ssh user@prod-server"
    claudePath: "~/.local/bin/claude"
    path: "/opt/production/app"
    description: Production backend server
    enableReverseMcp: true      # Enable bidirectional tunneling
    reverseMcpPort: 1615        # Port to tunnel
    allowHttp: false            # Use HTTPS for production
    grantPermission: ask        # Require approval for actions
    color: "#E34F26"

  # Remote Team with Session MCP
  team-mobile:
    remote: "ssh user@mobile-server"
    path: "/home/user/mobile-app"
    sessionMcpEnabled: true
    sessionMcpPath: "/usr/local/bin/session-mcp"
    color: "#3DDC84"
```

### Environment Variable Interpolation

Use `${VAR:-default}` syntax for dynamic configuration:

```yaml
settings:
  httpPort: ${IRIS_HTTP_PORT:-1615}
  idleTimeout: ${IRIS_IDLE_TIMEOUT:-3600000}
  maxProcesses: ${IRIS_MAX_PROCESSES:-10}

teams:
  team-production:
    path: ${PROD_PATH}          # Required (throws if not set)
    idleTimeout: ${PROD_TIMEOUT:-1800000}
```

**Example .env file:**
```bash
IRIS_HTTP_PORT=1615
IRIS_MAX_PROCESSES=20
PROD_PATH=/opt/production/app
PROD_TIMEOUT=3600000
```

### Configuration Hot-Reload

Iris watches `config.yaml` with `fs.watchFile()` (1s interval) and automatically reloads configuration changes without server restart.

---

## 🔧 Development

### Build

```bash
pnpm build
```

### Watch Mode

```bash
pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Unit tests only (fast, mocked)
pnpm test:unit

# Integration tests only (slow, real Claude processes)
pnpm test:integration

# Run specific test file
pnpm test:run path/to/test.ts

# Watch mode with UI
pnpm test:ui
```

### Run MCP Inspector

```bash
pnpm inspector
```

This opens the MCP inspector at `http://localhost:5173` to test tools interactively.

### Logs

All logs go to stderr in JSON format:

```json
{"level":"info","context":"server","message":"Iris MCP Server initialized","teams":["frontend","backend"],"timestamp":"2025-01-15T10:30:00.000Z"}
{"level":"info","context":"pool","message":"Process spawned","poolKey":"iris->backend","sessionId":"abc-123","pid":12345,"timestamp":"2025-01-15T10:30:15.000Z"}
```

**Log Contexts**:
- `server`: MCP server lifecycle
- `config`: Configuration loading
- `session-manager`: Session operations
- `session-store`: Database operations
- `pool`: Process pool management
- `process:teamName`: Individual process logs
- `transport:ssh`: SSH transport operations

---

## ⚡ Performance

### Process Pooling Benefits

**Cold Start** (first request to a team):
- Session creation: ~7-12 seconds
- Process spawn: ~1-2 seconds
- Total: ~8-14 seconds

**Warm Start** (subsequent requests):
- Session lookup: ~1ms (cache hit)
- Process reuse: ~1ms (pool hit)
- Total: ~500ms-2s (Claude API time only)

**Speedup**: **10-20x faster** with pooling!

### Session Persistence

**Without Iris** (each request):
- New conversation context every time
- No memory of previous interactions
- Lost context between teams

**With Iris**:
- Persistent `(fromTeam, toTeam)` sessions
- Full conversation history maintained
- Claude remembers previous exchanges

### Resource Efficiency

**Process Pool Management**:
- LRU eviction keeps memory bounded
- Idle timeout (1 hour) terminates unused processes
- Health checks (30s) detect and clean unhealthy processes
- Max 10 concurrent processes (configurable)

**Memory Usage** (typical):
- 10 processes: ~600 MB - 1.25 GB
- Session database: ~2 MB per 10,000 sessions
- Notification queue: ~5 MB per 10,000 notifications

### Test Suite Performance

**Test Optimizations**:
- Unit tests: 203 passing in <2 seconds
- Integration tests: 85% faster (7min → 1min) with `beforeAll` optimization
- Timeout handling: Fixed spurious errors 20s after completion

---

## 🚨 Troubleshooting

### "Team not found" error

**Symptom**: `TeamNotFoundError` when using tools

**Solutions**:
- Check that team name in `config.yaml` matches exactly (case-sensitive)
- Verify the path exists and is absolute
- Restart Iris after modifying `config.yaml` (or wait for hot-reload)

### "Process failed to spawn"

**Symptom**: Error during process creation

**Solutions**:
- Ensure Claude CLI is installed: `which claude`
- Check that the team's project directory exists and is accessible
- Try running `claude --session-id test-$(uuidgen) --print ping` manually in the team directory
- Check logs for detailed error: `context:"process:teamName"`
- For remote teams, verify SSH connectivity: `ssh user@host 'which claude'`

### "Timeout exceeded"

**Symptom**: Message takes longer than configured timeout

**Solutions**:
- Increase `responseTimeout` in settings: `responseTimeout: 180000` (3 minutes)
- Check if the target team's Claude process is stuck (view logs)
- Verify Claude API is responding (not rate-limited)
- For session initialization timeouts, increase `sessionInitTimeout` in config

### "Session file was not created"

**Symptom**: Session initialization fails

**Solutions**:
- Verify `~/.claude/projects/` directory exists: `mkdir -p ~/.claude/projects`
- Check permissions: `ls -la ~/.claude`
- Ensure team path is correct and accessible
- Check available disk space: `df -h`

### SSH Connection Issues

**Symptom**: Remote team execution fails

**Solutions**:
- Test SSH manually: `ssh user@host 'echo hello'`
- Check SSH key authentication is configured
- Verify `claudePath` is correct on remote machine
- For reverse MCP, ensure port 1615 is not blocked
- Check SSH logs: `ssh -v user@host`

### Database Locked

**Symptom**: SQLite errors about locked database

**Solutions**:
- Close other Iris MCP instances
- Delete WAL files: `rm data/*.db-wal data/*.db-shm`
- Check for zombie processes: `ps aux | grep iris`

### Process Pool Full

**Symptom**: All process slots occupied

**Solutions**:
- Increase `maxProcesses` in `config.yaml` settings
- Reduce `idleTimeout` to free processes faster
- Check health check logs to see which processes are active

---

## 🗺️ Roadmap

### Phase 1: Core MCP Server ✅

- **17 MCP Tools** for team coordination
- **Process Pool** with LRU eviction
- **Session Persistence** with SQLite
- **Transport Abstraction** (Local, SSH, RemoteSSH2)
- **Remote Execution** via SSH
- **Reverse MCP Tunneling**
- **Session MCP Configuration**
- **Wonder Logger** with OpenTelemetry
- **Permission Approval System**
- **Hot-Reloadable Configuration**
- **Event-Driven Architecture** with RxJS

### Phase 2: Web Dashboard ✅

- **React SPA** with real-time monitoring
- **WebSocket Integration** for live updates
- **Permission Approval Modal**
- **Log Viewer** with filtering
- **Process Monitoring** with health metrics
- **Configuration Editor**

**Status**: Fully implemented and production-ready!

### Phase 3: Programmatic API 🔮

- RESTful HTTP endpoints
- WebSocket streaming
- API key authentication
- Official SDKs (TypeScript, Python)

See `src/api/README.md`

### Phase 4: CLI Interface 🔮

- `iris ask` command
- `iris status` monitoring
- Interactive shell mode
- Built with Ink (React for terminals)

See `src/cli/README.md`

### Phase 5: Intelligence Layer 🔮

- Loop detection
- Destructive action prevention
- Pattern recognition
- Self-aware coordination
- Autonomous multi-team orchestration

See `src/intelligence/README.md`

---

## 📚 Documentation

### Core Documentation

- **[Getting Started](./GETTING_STARTED.md)** - Installation and quick start guide
- **[Concept](./docs/CONCEPT.md)** - Vision and conceptual overview
- **[Architecture](./docs/ARCHITECTURE.md)** - System design and component interaction
- **[Actions](./docs/ACTIONS.md)** - All 17 MCP tools documentation
- **[Configuration](./docs/CONFIG.md)** - Complete YAML config reference
- **[Features](./docs/FEATURES.md)** - Comprehensive feature inventory
- **[Nomenclature](./docs/NOMENCLATURE.md)** - Core concepts and terminology

### Advanced Topics

- **[Session Management](./docs/SESSION.md)** - Session database and file management
- **[Remote Execution](./docs/REMOTE.md)** - SSH transport and remote teams
- **[Reverse MCP](./docs/REVERSE_MCP.md)** - Bidirectional SSH tunneling
- **[Dashboard](./docs/DASHBOARD.md)** - Web dashboard documentation

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### How to Contribute

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/iris-mcp
cd iris-mcp

# Install dependencies
pnpm install

# Run tests
pnpm test

# Run in watch mode
pnpm dev

# Build the project
pnpm build
```

Please ensure all tests pass before submitting a PR.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🌟 Why "Iris"?

Iris was the Greek goddess of the rainbow and messenger of the gods, bridging heaven and earth. Similarly, Iris MCP bridges your AI agents across project boundaries.

**One messenger. Many teams. Infinite coordination.**

---

Built with ❤️ by Jenova Marie
