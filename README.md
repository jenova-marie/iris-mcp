<div align="center">
  <img src="resources/iris-mcp.png" alt="Iris MCP Logo" width="200" height="200">

  # Iris MCP

  **Model Context Protocol server for cross-project Claude Code coordination**

  [![Build Status](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml)
  [![Test Coverage](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/jenova-marie/iris-mcp/actions)
  [![npm version](https://badge.fury.io/js/@iris-mcp%2Fserver.svg)](https://badge.fury.io/js/@iris-mcp%2Fserver)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

  Iris MCP enables Claude Code instances across different project directories to communicate and coordinate. Stay in one project while asking questions to teams in other codebases.
</div>

---

## 🎯 What is Iris MCP?

Iris MCP is a revolutionary MCP server that lets Claude Code teams talk to each other. Instead of manually context-switching between projects, you can:

```
You (in frontend project):
"Using Iris, ask the backend team what their API versioning strategy is"

Claude (in frontend) → Iris MCP → Claude (in backend) → analyzes backend code → responds
                                                                              ↓
"The backend team uses semantic versioning with /api/v1, /api/v2 prefixes"
```

**You never left the frontend project.** Iris handled the coordination automatically.

---

## 🆕 What's New in Phase 1 (Current)

### Architecture Improvements

✅ **Three-Layer Design**: Clean separation between SessionManager, ProcessPool, and IrisOrchestrator
✅ **Session Persistence**: Team-to-team conversations maintained across restarts
✅ **Eager Initialization**: All team sessions pre-created at startup (no cold starts!)
✅ **LRU Process Pooling**: 10-20x faster warm starts with intelligent eviction
✅ **Dual-Role ClaudeProcess**: Static session initialization + instance process management

### Performance Gains

- **52%+ faster responses** with process pooling
- **85% faster test suite** with `beforeAll` optimization
- **Warm starts**: 500ms-2s (vs 8-14s cold starts)
- **Proper timeout cleanup**: Fixed spurious errors 20s after completion

### New Features

- **Session database** (SQLite) tracks metadata for all team interactions
- **Health monitoring** every 30 seconds detects unhealthy processes
- **Configurable timeouts** per team (`idleTimeout`, `sessionInitTimeout`)
- **Event system** emits lifecycle events for observability
- **Comprehensive docs** (SESSION.md, CLAUDE.md, POOL.md)

### Developer Experience

- **203 unit tests** passing in <2 seconds
- **Integration tests** optimized for speed
- **Structured JSON logging** to stderr
- **Type-safe configuration** with Zod validation

---

## 🚀 Quick Start

### Installation

```bash
# Install globally from npm
npm install -g @iris-mcp/server

# Or install locally in your project
npm install @iris-mcp/server

# Or clone and build from source
git clone https://github.com/jenova-marie/iris-mcp
cd iris-mcp
pnpm install
pnpm build
```

### Configuration

Create a `teams.json` file (copy from `src/config/teams.example.json`):

```json
{
  "settings": {
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },
  "teams": {
    "frontend": {
      "path": "/Users/you/projects/acme-frontend",
      "description": "React TypeScript frontend with Tailwind",
      "skipPermissions": true,
      "color": "#61dafb"
    },
    "backend": {
      "path": "/Users/you/projects/acme-backend",
      "description": "Node.js Express REST API",
      "skipPermissions": true,
      "color": "#68a063"
    },
    "mobile": {
      "path": "/Users/you/projects/acme-mobile",
      "description": "React Native mobile app",
      "skipPermissions": true,
      "color": "#0088cc"
    }
  }
}
```

### Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["/path/to/iris-mcp/dist/index.js"]
    }
  }
}
```

### Start Using

Restart Claude Desktop. **First startup will take 60-90 seconds** as Iris pre-initializes sessions for all teams (eager initialization).

Then start a conversation:

```
> "Ask the backend team what database they use"
```

Claude will automatically use Iris MCP to coordinate!

**Note**: First request to each team pair takes ~8-14 seconds (cold start). Subsequent requests are much faster (~2-3 seconds) thanks to process pooling.

---

## 🛠️ MCP Tools

### `teams_ask`

**Ask a team a question and wait for response.**

```javascript
{
  team: "backend",
  question: "What database migration system do you use?",
  timeout: 30000  // optional, default 30s
}
```

**Response:**
```json
{
  "team": "backend",
  "question": "What database migration system do you use?",
  "response": "We use Prisma for database migrations...",
  "duration": 2847,
  "timestamp": 1704067200000
}
```

**Example prompts:**
- "Ask the backend team about their authentication strategy"
- "Using Iris, find out from mobile team if they support push notifications"
- "Check with frontend team what state management library they use"

---

### `teams_send_message`

**Send a message to another team, optionally wait for response.**

```javascript
{
  fromTeam: "frontend",      // optional
  toTeam: "backend",
  message: "Breaking change: User model now requires email field",
  waitForResponse: true,     // optional, default true
  timeout: 30000            // optional
}
```

**Response (if waitForResponse = true):**
```json
{
  "from": "frontend",
  "to": "backend",
  "message": "Breaking change: User model now requires email field",
  "response": "Acknowledged. Updating user schema and creating migration.",
  "duration": 3200,
  "timestamp": 1704067200000,
  "async": false
}
```

**Example prompts:**
- "Tell the backend team we're deprecating the old API endpoint"
- "Send a message to mobile team about the new authentication flow"
- "Coordinate with all teams to update the User model"

---

### `teams_notify`

**Fire-and-forget notification (queued for later).**

```javascript
{
  fromTeam: "backend",    // optional
  toTeam: "frontend",
  message: "New API endpoint available: GET /api/v2/users",
  ttlDays: 30            // optional, default 30
}
```

**Response:**
```json
{
  "notificationId": "abc-123-def-456",
  "from": "backend",
  "to": "frontend",
  "message": "New API endpoint available: GET /api/v2/users",
  "expiresAt": 1706745600000,
  "timestamp": 1704067200000
}
```

**Example prompts:**
- "Notify all teams about the scheduled maintenance window"
- "Send a notification to mobile team about the API changes"

---

### `teams_get_status`

**Get status of teams, processes, and notifications.**

```javascript
{
  team: "backend",              // optional, omit for all teams
  includeNotifications: true    // optional, default true
}
```

**Response:**
```json
{
  "teams": [
    {
      "name": "backend",
      "description": "Node.js Express REST API",
      "path": "/Users/you/projects/acme-backend",
      "active": true,
      "processMetrics": {
        "pid": 12345,
        "status": "idle",
        "messagesProcessed": 47,
        "lastUsed": 1704067200000,
        "uptime": 180000,
        "queueLength": 0
      },
      "notifications": {
        "pending": 2,
        "total": 15
      }
    }
  ],
  "pool": {
    "totalProcesses": 3,
    "maxProcesses": 10
  },
  "queue": {
    "total": 25,
    "pending": 2,
    "read": 20,
    "expired": 3
  },
  "timestamp": 1704067200000
}
```

**Example prompts:**
- "Show me the status of all teams"
- "Check if the backend team is currently active"
- "How many pending notifications does frontend have?"

---

## 📁 Project Structure

```
iris-mcp/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── iris.ts                  # Business Logic Layer (orchestrator)
│   ├── config/
│   │   ├── teams-config.ts      # Configuration loader with Zod validation
│   │   └── teams.example.json   # Example configuration
│   ├── session/
│   │   ├── session-manager.ts   # Session database and file management
│   │   ├── session-store.ts     # SQLite session store
│   │   ├── path-utils.ts        # Session file path utilities
│   │   ├── validation.ts        # Session validation
│   │   └── types.ts             # Session interfaces
│   ├── process-pool/
│   │   ├── pool-manager.ts      # Process pool with LRU eviction
│   │   ├── claude-process.ts    # Claude process wrapper (dual-role)
│   │   └── types.ts             # TypeScript interfaces
│   ├── tools/
│   │   ├── teams-ask.ts         # teams_ask tool
│   │   ├── teams-send-message.ts
│   │   ├── teams-notify.ts
│   │   ├── teams-get-status.ts
│   │   └── index.ts
│   ├── notifications/
│   │   ├── queue.ts             # SQLite notification queue
│   │   └── schema.sql
│   └── utils/
│       ├── logger.ts            # Structured logging to stderr
│       ├── errors.ts            # Custom error types
│       └── validation.ts        # Input validation
├── docs/
│   ├── ARCHITECTURE.md          # Overall architecture overview
│   ├── SESSION.md               # SessionManager deep dive
│   ├── CLAUDE.md                # ClaudeProcess deep dive
│   ├── POOL.md                  # ClaudeProcessPool deep dive
│   └── BREAKING.md              # Breaking changes documentation
├── data/
│   ├── team-sessions.db         # Session database (auto-created)
│   └── notifications.db         # Notification queue (auto-created)
├── teams.json                   # Your team configuration
├── package.json
└── README.md
```

---

## 🏗️ Architecture

### Three-Layer Design (Phase 1)

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
│SQLite        │  │Static: init files   │
│              │  │Instance: resume     │
└──────────────┘  └─────────────────────┘
```

**Layer 1: SessionManager**
- Session database management (SQLite)
- Session file validation
- Eager initialization at startup
- 60-second caching layer
- **Does NOT** spawn processes

**Layer 2: ClaudeProcessPool**
- Process lifecycle management
- LRU eviction when pool is full
- Health monitoring (every 30s)
- Process reuse for 10-20x speedup
- **Does NOT** manage session database

**Layer 3: IrisOrchestrator**
- Business Logic Layer
- Coordinates SessionManager + PoolManager
- Implements complete message flow
- Provides API for MCP tools

### Session Persistence

**Persistent team-to-team sessions** maintain conversation continuity:

- Each `(fromTeam, toTeam)` pair has exactly one session
- Sessions stored at `~/.claude/projects/{escaped-path}/{sessionId}.jsonl`
- Database tracks metadata (message count, last used, status)
- Sessions resume across process restarts

### Process Pool Management

Iris maintains a pool of Claude Code processes with:

- **LRU Eviction**: When pool is full, least recently used process is terminated
- **Idle Timeout**: Processes automatically terminate after 5 minutes of inactivity
- **Health Checks**: Regular monitoring ensures processes stay healthy
- **Warm Starts**: Reuses existing processes for 10-20x faster responses
- **Session Resumption**: Each process resumes its specific session via `--resume <sessionId>`

### Dual-Role ClaudeProcess

ClaudeProcess serves two roles:

1. **Static Session Initializer**: `ClaudeProcess.initializeSessionFile()` creates `.jsonl` files
2. **Instance Process Manager**: Wraps running Claude processes with stdio communication

### Notification Queue

Persistent SQLite database stores notifications with:

- **30-day retention**: Automatic cleanup of old notifications
- **Status tracking**: pending, read, expired
- **Team filtering**: Get notifications for specific teams
- **TTL support**: Configurable expiration per notification

### Event System

All process events are emitted for future Intelligence Layer integration:

- `process-spawned`
- `process-terminated`
- `process-exited`
- `process-error`
- `message-sent`
- `message-response`
- `health-check`

---

## 🎯 Configuration Options

### Settings

```json
{
  "settings": {
    "idleTimeout": 300000,          // 5 minutes in milliseconds
    "maxProcesses": 10,             // Max concurrent processes
    "healthCheckInterval": 30000,   // 30 seconds
    "sessionInitTimeout": 30000     // Session initialization timeout (30s)
  }
}
```

### Team Configuration

```json
{
  "teams": {
    "teamName": {
      "path": "/absolute/path",        // Required: project directory
      "description": "Team description",
      "idleTimeout": 600000,           // Optional: override global idle timeout
      "sessionInitTimeout": 45000,     // Optional: override session init timeout
      "skipPermissions": true,         // Optional: auto-approve Claude actions
      "color": "#ff6b6b"              // Optional: hex color for UI (future)
    }
  }
}
```

### Configuration Details

**Global Settings**:
- `idleTimeout`: How long a process can be idle before termination (default: 5 minutes)
- `maxProcesses`: Maximum number of concurrent Claude processes (default: 10)
- `healthCheckInterval`: How often to check process health (default: 30 seconds)
- `sessionInitTimeout`: Timeout for session file creation (default: 30 seconds)

**Per-Team Overrides**:
- `idleTimeout`: Override for teams with slower/faster requirements
- `sessionInitTimeout`: Override for teams with large dependencies (slow startup)
- `skipPermissions`: Set `true` to auto-approve file operations (use with caution!)

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

# Watch mode
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
{"level":"info","context":"server","message":"Iris MCP Server initialized","teams":["frontend","backend","mobile"],"timestamp":"2025-01-15T10:30:00.000Z"}
{"level":"info","context":"session-manager","message":"Pre-initializing team sessions","timestamp":"2025-01-15T10:30:01.000Z"}
{"level":"info","context":"pool","message":"Creating new process","poolKey":"frontend->backend","sessionId":"abc-123","timestamp":"2025-01-15T10:30:15.000Z"}
```

**Log Contexts**:
- `server`: MCP server lifecycle
- `config`: Configuration loading
- `session-manager`: Session operations
- `session-store`: Database operations
- `pool`: Process pool management
- `process:teamName`: Individual process logs
- `session-init:path`: Session file initialization

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
- Idle timeout (5 minutes) terminates unused processes
- Health checks (30s) detect and clean unhealthy processes
- Max 10 concurrent processes (configurable)

**Memory Usage** (typical):
- 10 processes: ~600 MB - 1.25 GB
- Session database: ~2 MB per 10,000 sessions
- Notification queue: ~5 MB per 10,000 notifications

### Test Suite Performance

**Phase 1 Refactor Improvements**:
- Unit tests: 203 passing in <2 seconds
- Integration tests: 85% faster (7min → 1min) with `beforeAll` optimization
- Timeout handling: Fixed spurious errors 20s after completion

---

## 🚨 Troubleshooting

### "Team not found" error

**Symptom**: `TeamNotFoundError` when using tools

**Solutions**:
- Check that team name in `teams.json` matches exactly (case-sensitive)
- Verify the path exists and is absolute
- Restart Iris after modifying `teams.json`

### "Process failed to spawn"

**Symptom**: Error during process creation

**Solutions**:
- Ensure Claude CLI is installed: `which claude` or check `/Users/you/.asdf/installs/nodejs/*/bin/claude`
- Check that the team's project directory exists and is accessible
- Try running `claude --session-id test-$(uuidgen) --print ping` manually in the team directory
- Check logs for detailed error: `context:"process:teamName"`

### "Timeout exceeded"

**Symptom**: Message takes longer than 30 seconds

**Solutions**:
- Increase timeout parameter: `{ timeout: 60000 }` (60 seconds)
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

### "Session starting... Please retry your request in a moment"

**Symptom**: Async response during process spawn

**Explanation**: This is normal! The process is spawning (takes 7-12 seconds for first request).

**Solutions**:
- Wait a few seconds and retry the request
- Subsequent requests will be instant (warm start)

### Database locked

**Symptom**: SQLite errors about locked database

**Solutions**:
- Close other Iris MCP instances
- Delete WAL files: `rm data/*.db-wal data/*.db-shm`
- Check for zombie processes: `ps aux | grep iris`

### Process pool full

**Symptom**: All 10 process slots occupied

**Solutions**:
- Increase `maxProcesses` in `teams.json` settings
- Reduce `idleTimeout` to free processes faster
- Check health check logs to see which processes are active

### Memory issues

**Symptom**: High memory usage or OOM errors

**Solutions**:
- Reduce `maxProcesses` (fewer concurrent processes)
- Reduce `idleTimeout` (terminate idle processes faster)
- Monitor process memory: check health-check events
- For 16GB RAM: `maxProcesses: 5-10` recommended

---

## 🗺️ Roadmap

### ✅ Phase 1: Core MCP Server (CURRENT)

- MCP tools for team coordination
- Process pool management
- Notification queue
- Configuration system

### 🚧 Phase 2: Web Dashboard

- React SPA for monitoring
- Real-time WebSocket updates
- Team management UI
- Analytics dashboard

See `src/dashboard/README.md`

### 🔮 Phase 3: Programmatic API

- RESTful HTTP endpoints
- WebSocket streaming
- API key authentication
- Official SDKs (TypeScript, Python)

See `src/api/README.md`

### 🔮 Phase 4: CLI

- `iris ask` command
- `iris status` monitoring
- Interactive shell mode
- Built with Ink (React for terminals)

See `src/cli/README.md`

### 🔮 Phase 5: Intelligence Layer

- Loop detection
- Destructive action prevention
- Pattern recognition
- Self-aware coordination

See `src/intelligence/README.md`

---

## 📚 Documentation

### Phase 1 Architecture (Current)

- **[Architecture Overview](docs/ARCHITECTURE.md)** - System design and component interaction
- **[SessionManager Deep Dive](docs/SESSION.md)** - Session database and file management
- **[ClaudeProcess Deep Dive](docs/CLAUDE.md)** - Process wrapper and stdio communication
- **[ProcessPool Deep Dive](docs/POOL.md)** - Pool management and LRU eviction
- **[Breaking Changes](docs/BREAKING.md)** - Migration guide for Phase 1 refactor

### Future Phases (Planned)

- [Dashboard Spec](docs/DASHBOARD.md) - React web UI (Phase 2)
- [API Spec](docs/API.md) - RESTful + WebSocket API (Phase 3)
- [CLI Spec](docs/CLI.md) - Ink terminal interface (Phase 4)
- [Intelligence Layer](docs/AGENT.md) - Autonomous coordination (Phase 5)

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
