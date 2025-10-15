<div align="center">
  <img src="resources/iris-mcp.png" alt="Iris MCP Logo" width="200" height="200">

  <svg width="400" height="60" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="rainbow" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#ff0000;stop-opacity:1" />
        <stop offset="16%" style="stop-color:#ff7f00;stop-opacity:1" />
        <stop offset="33%" style="stop-color:#ffff00;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#00ff00;stop-opacity:1" />
        <stop offset="66%" style="stop-color:#0000ff;stop-opacity:1" />
        <stop offset="83%" style="stop-color:#4b0082;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#9400d3;stop-opacity:1" />
      </linearGradient>
    </defs>
    <text x="50%" y="50%" font-family="monospace" font-size="48" font-weight="bold" fill="url(#rainbow)" text-anchor="middle" dominant-baseline="middle">Iris MCP</text>
  </svg>

  # Iris MCP

  **Model Context Protocol server for cross-project Claude Code coordination**

  [![Build Status](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jenova-marie/iris-mcp/actions/workflows/ci.yml)
  [![codecov](https://codecov.io/gh/jenova-marie/iris-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/jenova-marie/iris-mcp)
  [![npm version](https://badge.fury.io/js/@iris-mcp%2Fserver.svg)](https://badge.fury.io/js/@iris-mcp%2Fserver)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

  Iris MCP enables Claude Code instances across different project directories to communicate and coordinate. Stay in one project while asking questions to teams in other codebases.
</div>

---

## 🎯 What is Iris MCP?

Iris MCP is a **groundbreaking Model Context Protocol server** that enables direct communication between Claude Code instances across different project directories. It creates the **first true cross-codebase AI collaboration system**.

### My Personal Use Case

On the larger sysem I'm building I have 29 current projects - meaning 29 different CLAUDE.md files and 29 different claude code sessions.  Often while I'm working in the common project, for example, I might make a change that needs to be propagated and verified through a significant number of projects that depend on common.  This means opening a terminal for each project starting claude code and then manually instructing in the adoption of this latest change.  Ugh, that stinks.

Wouldn't it be amazing if I could tell my current claude code session to review with all 28 other projects these common changes that may affect them?  Yes, it would be amazing.

Another situation is I'm debugging a project and claude says "The issue appears to be in the api and this is what needs to be fixed there ......".  So I open a api terminal and copy paste the previous session's output to be discussed and resolved in the api claude code.  Why does copy/paste from one claude to another feel so wrong?

Wouldn't it be great if I could just stay in the original project session and tell claude to relay his instructions to team-api, discuss the proposed fix, coming to a resolution, and then implementing it?  Yes, that would be great.

Those cross session communications can get complicated quickly.  No big deal, I open a terminal to the other project and execute

```bash
claude --continue
```

...and the conversation is there exactly as claude had been talking to the original session - ready for me to continue the conversation - fully loaded with the verbal context passed from original to current session.  Once the issue has been resolved, I simply ask iris to tell the original team the bug is fixed and to run their tests to verify the fix.

With Iris MCP I'm now working in all my projects - from any project.

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
"Iris, ask the backend team what their API versioning strategy is"

Claude (in frontend) → Iris MCP → Claude (in backend) → analyzes backend code → responds
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
  fromTeam: "frontend",      // required: calling team name
  toTeam: "backend",
  message: "Breaking change: User model now requires email field",
  timeout: 30000            // optional
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
  fromTeam: "backend",    // required: calling team name
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

- Each `(fromTeam, toTeam)` pair has exactly one session (e.g., `iris→alpha`, `alpha→beta`)
- ALL sessions require both fromTeam and toTeam (no "team-beta" or null sessions)
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

**Test Optimizations**:
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

### ✅ Core MCP Server

- 10 MCP tools for team coordination
- Process pool with LRU eviction
- SQLite notification queue
- Hot-reloadable configuration system
- Session persistence and resumption
- Event-driven architecture

### 🚧 Web Dashboard

- React SPA for monitoring
- Real-time WebSocket updates
- Team management UI
- Analytics dashboard

See `src/dashboard/README.md`

### 🔮 Programmatic API

- RESTful HTTP endpoints
- WebSocket streaming
- API key authentication
- Official SDKs (TypeScript, Python)

See `src/api/README.md`

### 🔮 CLI Interface

- `iris ask` command
- `iris status` monitoring
- Interactive shell mode
- Built with Ink (React for terminals)

See `src/cli/README.md`

### 🔮 Intelligence Layer

- Loop detection
- Destructive action prevention
- Pattern recognition
- Self-aware coordination

See `src/intelligence/README.md`

---

## 📚 Documentation

### Architecture Documentation

- **[Architecture Overview](docs/new/ARCHITECTURE.md)** - System design and component interaction
- **[Session Management](docs/new/SESSION.md)** - Session database and file management
- **[Process Pool](docs/new/PROCESS_POOL.md)** - Pool management and LRU eviction
- **[Cache System](docs/new/CACHE.md)** - Hierarchical cache with RxJS
- **[MCP Actions](docs/new/ACTIONS.md)** - All 10 MCP tools documentation
- **[Breaking Changes](docs/BREAKING.md)** - Migration guide for refactorings

### Future Phases (Planned)

- [Dashboard Spec](docs/DASHBOARD.md) - React web UI for monitoring
- [API Spec](docs/API.md) - RESTful + WebSocket API
- [CLI Spec](docs/CLI.md) - Ink terminal interface
- [Intelligence Layer](docs/AGENT.md) - Autonomous coordination

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
