# Iris MCP 🌈

**Model Context Protocol server for cross-project Claude Code coordination**

Iris MCP enables Claude Code instances across different project directories to communicate and coordinate. Stay in one project while asking questions to teams in other codebases.

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

## 🚀 Quick Start

### Installation

```bash
# Install globally
npm install -g @iris-mcp/server

# Or use locally
git clone https://github.com/your-org/iris-mcp
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

Restart Claude Desktop and start a conversation:

```
> "Ask the backend team what database they use"
```

Claude will automatically use Iris MCP to coordinate!

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
│   ├── config/
│   │   ├── teams-config.ts      # Configuration loader with Zod validation
│   │   └── teams.example.json   # Example configuration
│   ├── process-pool/
│   │   ├── pool-manager.ts      # Process pool with LRU eviction
│   │   ├── claude-process.ts    # Individual Claude process wrapper
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
├── teams.json                    # Your team configuration
├── package.json
└── README.md
```

---

## 🏗️ Architecture

### Process Pool Management

Iris maintains a pool of Claude Code processes with:

- **LRU Eviction**: When pool is full, least recently used process is terminated
- **Idle Timeout**: Processes automatically terminate after 5 minutes of inactivity
- **Health Checks**: Regular monitoring ensures processes stay healthy
- **Connection Pooling**: Reuses existing processes for 52%+ faster responses

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

---

## 🎯 Configuration Options

### Settings

```json
{
  "settings": {
    "idleTimeout": 300000,         // 5 minutes in milliseconds
    "maxProcesses": 10,            // Max concurrent processes
    "healthCheckInterval": 30000   // 30 seconds
  }
}
```

### Team Configuration

```json
{
  "teams": {
    "teamName": {
      "path": "/absolute/path",      // Required: project directory
      "description": "Team description",
      "idleTimeout": 600000,         // Optional: override global timeout
      "skipPermissions": true,       // Optional: auto-approve Claude actions
      "color": "#ff6b6b"            // Optional: hex color for UI (future)
    }
  }
}
```

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

### Run MCP Inspector

```bash
pnpm inspector
```

This opens the MCP inspector at `http://localhost:5173` to test tools interactively.

### Logs

All logs go to stderr in JSON format:

```json
{"level":"info","context":"server","message":"Iris MCP Server initialized","teams":["frontend","backend","mobile"],"timestamp":"2025-01-15T10:30:00.000Z"}
```

---

## 🚨 Troubleshooting

### "Team not found" error

- Check that team name in `teams.json` matches exactly (case-sensitive)
- Verify the path exists and is absolute

### "Process failed to spawn"

- Ensure `claude-code` CLI is installed and in PATH
- Check that the team's project directory is valid
- Try running `claude-code --headless` manually in the team directory

### "Timeout exceeded"

- Increase timeout parameter in tool call
- Check if the target team's Claude process is stuck
- View logs for error details

### Database locked

- Close other Iris MCP instances
- Delete `data/notifications.db-wal` and `data/notifications.db-shm`

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

- [Architecture Details](docs/ARCHITECTURE.md)
- [Dashboard Spec](docs/DASHBOARD.md)
- [API Spec](docs/API.md)
- [CLI Spec](docs/CLI.md)
- [Intelligence Layer](docs/AGENT.md)

---

## 🤝 Contributing

Contributions welcome! This is Phase 1 - there's lots of exciting work ahead.

---

## 📄 License

MIT License - see LICENSE file for details

---

## 🌟 Why "Iris"?

Iris was the Greek goddess of the rainbow and messenger of the gods, bridging heaven and earth. Similarly, Iris MCP bridges your AI agents across project boundaries.

**One messenger. Many teams. Infinite coordination.**

---

Built with ❤️ by Jenova Marie
