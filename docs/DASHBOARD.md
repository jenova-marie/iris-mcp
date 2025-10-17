# Dashboard Documentation

> **Phase 2: Web Dashboard for Real-Time Monitoring**

The Iris MCP Dashboard is a React-based web application that provides real-time monitoring and management of Claude Code team sessions. It features a modern, responsive UI with WebSocket-powered live updates.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Technology Stack](#technology-stack)
5. [Configuration](#configuration)
6. [API Reference](#api-reference)
7. [WebSocket Events](#websocket-events)
8. [Components](#components)
9. [Development](#development)
10. [Deployment](#deployment)

---

## Overview

The dashboard consists of two main components:

- **Server** (`src/dashboard/server/`): Express-based HTTP/HTTPS server with Socket.IO
- **Client** (`src/dashboard/client/`): React SPA with real-time updates

### Key Capabilities

- Monitor all active team sessions (fromTeam→toTeam pairs)
- View session metrics and process status
- Inspect conversation cache/message history
- Fork sessions into new terminals
- Manage sessions (sleep, reboot, delete)
- Edit configuration with live validation
- Real-time updates via WebSocket

---

## Architecture

### Session-Based Model

The dashboard operates on a **session-based architecture** where each session represents a communication channel between two teams:

```
Session = fromTeam → toTeam
Example: "iris->backend" or "frontend->database"
```

Each session has:
- **Persistent Data** (SessionManager/SQLite): Session ID, message count, timestamps
- **Runtime Data** (ProcessPool): Process state, PID, uptime, queue length

### State Bridge Pattern

The `DashboardStateBridge` (`src/dashboard/server/state-bridge.ts`) provides:
- Read-only access to MCP server internals
- Event forwarding from process pool to WebSocket clients
- Unified view combining SessionManager + ProcessPool data

```typescript
// Bridge combines persistent + runtime state
SessionProcessInfo = {
  // From SessionManager (persistent)
  messageCount, createdAt, lastUsedAt, sessionStatus,

  // From ProcessPool (runtime)
  processState, pid, messagesProcessed, uptime, queueLength
}
```

### Real-Time Communication

```
Client (React) ←→ WebSocket (Socket.IO) ←→ Bridge ←→ Process Pool
                                               ↓
                                          Session Manager
```

Events flow:
1. Process pool emits lifecycle events
2. Bridge forwards to WebSocket layer
3. Socket.IO broadcasts to connected clients
4. React components update via hooks

---

## Features

### 1. Process Monitor (Main Page)

**Location**: `/` (src/dashboard/client/src/pages/ProcessMonitor.tsx)

#### Session Grid View

Displays all active sessions as cards with:
- **Pool key** (fromTeam→toTeam)
- **Session ID** (truncated, click to copy full ID)
- **Process state** (idle/processing/spawning/stopped)
- **PID** (if process is running)
- **Message counts** (total vs. current process)
- **Uptime** (formatted as hours/minutes/seconds)
- **Queue length** (pending messages)

#### Status Indicators

Color-coded status badges:
- **Green** (idle): Process active, waiting for messages
- **Yellow** (processing): Currently handling a message
- **Red** (offline/stopped): Process terminated
- **Blue** (spawning/terminating): Transitional states

#### Actions Per Session

**View Messages** (Eye icon):
- Opens modal with conversation cache
- Shows all cache entries (spawn + tell operations)
- Displays message timestamps, types, and content
- Formats protocol messages (user/assistant/tool_use/tool_result)

**Fork Terminal** (Terminal icon):
- Launches new terminal window with `claude --resume --fork-session`
- Requires fork script configured at `~/.iris/fork.sh` (or `.bat`/`.ps1` on Windows)
- Uses MCP fork action for consistency
- Shows loading state → success → resets to idle
- Only visible if `dashboard.forkScriptPath` is configured

**Dropdown Menu** (MoreVertical icon):
- **Sleep**: Terminates the process (preserves session)
- **Reboot**: Terminates, deletes old session, creates fresh one
- **Delete**: Permanently removes session (cannot be undone)

All actions show confirmation dialogs and loading states.

#### Header Stats

Top-right summary:
- **Active Processes**: X / Y (current vs. max from pool settings)
- **Status**: Connected/Disconnected (WebSocket connection)

#### Empty State

When no sessions exist, displays centered card:
- Activity icon
- "No Active Sessions" message
- Helpful text explaining sessions appear when teams communicate

### 2. Configuration Editor

**Location**: `/config` (src/dashboard/client/src/pages/ConfigEditor.tsx)

#### JSON Editor

- Large textarea with syntax highlighting (via CSS)
- Edit `config.yaml` directly in browser
- Real-time validation on save
- Displays config file path (from `$IRIS_HOME/config.yaml`)

#### Validation

When you click **Save Configuration**:
1. Parses JSON for syntax errors
2. Validates against Zod schema on server
3. Shows detailed error messages with field paths if validation fails
4. Example error format:
   ```
   Validation Error

   Invalid configuration

     - teams.backend.path: Required
     - settings.maxProcesses: Expected number, received string
   ```

#### Restart Banner

After successful save, shows purple banner:
- "Configuration saved successfully"
- Reminder to restart Iris MCP to apply changes

**Note**: Changes are written to disk immediately but require server restart to take effect (config hot-reload planned for future).

### 3. Layout & Navigation

**Location**: src/dashboard/client/src/components/Layout.tsx

#### Sidebar

- **Header**: "Iris MCP" gradient logo + "Dashboard" subtitle
- **Navigation**: Two menu items
  - Processes (Activity icon)
  - Configuration (Settings icon)
- **Status Footer**: WebSocket connection indicator

Active route highlighted with purple accent.

#### Responsive Design

- Tailwind CSS for styling
- Mobile-friendly (grid collapses on small screens)
- Dark theme with custom color palette

---

## Technology Stack

### Server (Backend)

- **Express** (^4.21.2): HTTP server framework
- **Socket.IO** (^5.0.2): WebSocket server
- **selfsigned** (^2.4.1): Self-signed SSL certificate generation
- **cors** (^2.8.5): Cross-origin resource sharing

### Client (Frontend)

- **React** (^18.2.0): UI framework
- **React Router DOM** (^7.1.3): Client-side routing
- **TanStack Query** (^5.64.2): Data fetching/caching
- **Socket.IO Client** (^4.8.1): WebSocket client
- **Axios** (^1.7.9): HTTP client
- **Zustand** (^5.0.2): State management (for future features)
- **Tailwind CSS** (^4.0.0): Utility-first CSS
- **Lucide React** (^0.469.0): Icon library

### Build Tools

- **Vite** (^6.0.5): Frontend build tool
- **TypeScript** (^5.7.3): Type safety
- **PostCSS** + **Autoprefixer**: CSS processing

---

## Configuration

Dashboard configuration is part of the main `config.yaml`:

```yaml
settings:
  maxProcesses: 10
  idleTimeout: 300000
  healthCheckInterval: 30000
dashboard:
  enabled: true
  host: localhost
  http: 3100
  https: 3101
  selfsigned: true
  certPath: /path/to/cert.pem
  keyPath: /path/to/key.pem
  forkScriptPath: ~/.iris/fork.sh
teams:
  backend:
    path: /absolute/path/to/backend
    description: Backend API team
    color: "#8B5CF6"
```

### Dashboard Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable dashboard server |
| `host` | string | `"localhost"` | Bind address (use "0.0.0.0" for network access) |
| `http` | number | `3100` | HTTP port (0 to disable) |
| `https` | number | `3101` | HTTPS port (0 to disable) |
| `selfsigned` | boolean | `true` | Generate self-signed cert (for HTTPS) |
| `certPath` | string | - | Path to SSL certificate (if not self-signed) |
| `keyPath` | string | - | Path to SSL private key (if not self-signed) |
| `forkScriptPath` | string | - | Path to terminal fork script (enables Fork button) |

### SSL/TLS

The dashboard supports three HTTPS modes:

1. **Self-Signed Certificate** (default):
   ```yaml
   https: 3101
   selfsigned: true
   ```
   - Auto-generates certificate on startup
   - Valid for 365 days
   - Includes localhost + 127.0.0.1 in SAN

2. **Custom Certificate**:
   ```yaml
   https: 3101
   selfsigned: false
   certPath: /path/to/cert.pem
   keyPath: /path/to/key.pem
   ```

3. **HTTP Only**:
   ```yaml
   http: 3100
   https: 0
   ```

### Fork Script

To enable the **Fork Terminal** button, create `~/.iris/fork.sh`:

```bash
#!/bin/bash
# Receives: sessionId, teamPath, claudePath, [sshHost, sshOptions]

sessionId="$1"
teamPath="$2"
claudePath="${3:-claude}"
sshHost="$4"
sshOptions="$5"

if [ -n "$sshHost" ]; then
  # Remote team
  osascript -e "tell application \"Terminal\" to do script \"ssh $sshOptions $sshHost 'cd $teamPath && $claudePath --resume $sessionId --fork-session'\""
else
  # Local team
  osascript -e "tell application \"Terminal\" to do script \"cd $teamPath && $claudePath --resume $sessionId --fork-session\""
fi
```

Make it executable:
```bash
chmod +x ~/.iris/fork.sh
```

For Windows, create `fork.bat` or `fork.ps1`.

---

## API Reference

Base URL: `http://localhost:3100/api` (or configured port)

### Health

#### GET /api/health

Check server health.

**Response**:
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": 1234567890
}
```

### Configuration

#### GET /api/config

Get current configuration.

**Response**:
```json
{
  "success": true,
  "config": { /* full config object */ },
  "configPath": "/Users/user/.iris/config.yaml"
}
```

#### PUT /api/config

Save configuration (with validation).

**Request Body**:
```json
{
  "settings": { /* ... */ },
  "teams": { /* ... */ }
}
```

**Success Response**:
```json
{
  "success": true,
  "message": "Configuration saved successfully",
  "configPath": "/Users/user/.iris/config.yaml"
}
```

**Error Response** (400):
```json
{
  "success": false,
  "error": "Invalid configuration",
  "details": [
    { "path": "teams.backend.path", "message": "Required" }
  ]
}
```

### Sessions (Processes)

#### GET /api/processes

List all sessions.

**Response**:
```json
{
  "success": true,
  "sessions": [
    {
      "poolKey": "iris->backend",
      "fromTeam": "iris",
      "toTeam": "backend",
      "sessionId": "abc123...",
      "messageCount": 42,
      "createdAt": 1234567890,
      "lastUsedAt": 1234567890,
      "sessionStatus": "active",
      "processState": "idle",
      "pid": 12345,
      "messagesProcessed": 10,
      "uptime": 120000,
      "queueLength": 0,
      "lastResponseAt": 1234567890
    }
  ],
  "poolStatus": {
    "totalSessions": 5,
    "activeProcesses": 3,
    "maxProcesses": 10,
    "configuredTeams": 8
  }
}
```

#### GET /api/processes/:fromTeam/:toTeam

Get metrics for specific session.

**Response**:
```json
{
  "success": true,
  "metrics": { /* SessionProcessInfo */ }
}
```

#### GET /api/processes/report/:fromTeam/:toTeam

Get conversation cache/message history.

**Response**:
```json
{
  "team": "backend",
  "fromTeam": "iris",
  "hasSession": true,
  "hasProcess": true,
  "processState": "idle",
  "sessionId": "abc123...",
  "allComplete": true,
  "entries": [
    {
      "type": "spawn",
      "tellString": "Initial greeting",
      "status": "completed",
      "isComplete": true,
      "messageCount": 4,
      "createdAt": 1234567890,
      "completedAt": 1234567891,
      "messages": [
        {
          "timestamp": 1234567890,
          "type": "user",
          "content": "Hello"
        },
        {
          "timestamp": 1234567891,
          "type": "assistant",
          "content": "Hi there!"
        }
      ]
    }
  ],
  "stats": {
    "totalEntries": 3,
    "spawnEntries": 1,
    "tellEntries": 2,
    "activeEntries": 0,
    "completedEntries": 3
  },
  "timestamp": 1234567890
}
```

#### POST /api/processes/sleep/:fromTeam/:toTeam

Terminate process (preserves session).

**Request Body**:
```json
{ "force": false }
```

**Response**:
```json
{
  "success": true,
  "message": "Session put to sleep successfully",
  "wasAwake": true
}
```

#### POST /api/processes/reboot/:fromTeam/:toTeam

Terminate, delete old session, create new one.

**Response**:
```json
{
  "success": true,
  "message": "Session rebooted successfully",
  "oldSessionId": "abc123...",
  "newSessionId": "def456..."
}
```

#### POST /api/processes/delete/:fromTeam/:toTeam

Permanently delete session.

**Response**:
```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

#### POST /api/processes/terminal/launch

Launch terminal with forked session.

**Request Body**:
```json
{
  "sessionId": "abc123...",
  "toTeam": "backend",
  "fromTeam": "dashboard"
}
```

**Success Response**:
```json
{
  "success": true,
  "message": "Terminal launched successfully",
  "sessionId": "abc123...",
  "remote": false
}
```

**Error Response** (404):
```json
{
  "success": false,
  "error": "Fork script not found at ~/.iris/fork.sh"
}
```

---

## WebSocket Events

Connect to: `ws://localhost:3100/ws` (or configured port)

### Client → Server

#### `stream-cache`

Request cache stream for a session.

**Payload**: `sessionId` (string)

*Note: Not yet fully implemented.*

### Server → Client

#### `init`

Sent on connection with initial state.

**Payload**:
```json
{
  "sessions": [ /* SessionProcessInfo[] */ ],
  "poolStatus": { /* pool stats */ },
  "config": { /* TeamsConfig */ }
}
```

#### `process-status`

Process state changed.

**Payload**:
```json
{
  "poolKey": "iris->backend",
  "fromTeam": "iris",
  "toTeam": "backend",
  "sessionId": "abc123...",
  "status": "idle",
  "pid": 12345,
  "messagesProcessed": 10,
  "lastUsed": 1234567890,
  "uptime": 120000,
  "queueLength": 0,
  "messageCount": 42
}
```

#### `config-saved`

Configuration was saved.

**Payload**:
```json
{
  "configPath": "/Users/user/.iris/config.yaml",
  "timestamp": 1234567890
}
```

#### `cache-stream`

Real-time cache entry (for future use).

**Payload**:
```json
{
  "sessionId": "abc123...",
  "type": "assistant",
  "content": { /* message data */ },
  "timestamp": 1234567890
}
```

#### `error`

Error occurred.

**Payload**:
```json
{
  "message": "Error description"
}
```

---

## Components

### Core Components

#### App.tsx

Root component with routing and React Query setup.

- Configures `QueryClient` with:
  - `refetchOnWindowFocus: false`
  - `retry: 1`
- Wraps app in `QueryClientProvider` and `BrowserRouter`
- Defines routes: `/` (ProcessMonitor), `/config` (ConfigEditor)

#### Layout.tsx

Main layout with sidebar navigation.

- Sidebar with:
  - Iris MCP branding (gradient logo)
  - Navigation menu
  - WebSocket status indicator
- Main content area with `<Outlet />`
- Active route highlighting

#### ProcessMonitor.tsx

Session monitoring page.

**State Management**:
- `selectedSession`: Currently viewed cache modal
- `cacheData`: Message cache data by session ID
- `copiedSessionId`: Recently copied session ID
- `terminalStatus`: Fork button states
- `openDropdown`: Active dropdown menu
- `actionStatus`: Action button states (sleep/reboot/delete)

**Hooks**:
- `useQuery` for sessions (5s polling)
- `useQuery` for config (1m cache)
- `useWebSocket` for real-time updates
- `useQueryClient` for cache invalidation

**Key Functions**:
- `handleViewCache`: Fetch and display conversation cache
- `handleCopySessionId`: Copy session ID to clipboard
- `handleLaunchTerminal`: Fork session to new terminal
- `handleSleep/Reboot/Delete`: Session lifecycle management

#### ConfigEditor.tsx

Configuration editing page.

**State Management**:
- `showRestartBanner`: Display save success banner
- `configText`: JSON string being edited
- `error`: Validation error message

**Hooks**:
- `useQuery` for config loading
- `useMutation` for save operation
- `useQueryClient` for cache invalidation

**Validation**:
- Client-side JSON parsing
- Server-side Zod schema validation
- Detailed error display with field paths

### Hooks

#### useWebSocket.ts

WebSocket connection hook.

**Parameters**:
- `onProcessStatus`: Callback for process updates
- `onCacheStream`: Callback for cache stream data

**Returns**:
- `connected`: Boolean connection state
- `socket`: Socket.IO client instance
- `streamCache`: Function to request cache stream

**Events Listened**:
- `connect`, `disconnect`
- `init`, `process-status`, `cache-stream`, `config-saved`, `error`

### API Client

#### api/client.ts

Axios-based API client.

**Configuration**:
- Base URL: `VITE_API_URL` env var or `/api`
- JSON content type
- Request/response interceptors for logging

**Endpoints**: See [API Reference](#api-reference)

---

## Development

### Project Structure

```
src/dashboard/
├── server/               # Express backend
│   ├── index.ts          # Server entry point
│   ├── state-bridge.ts   # State access layer
│   └── routes/
│       ├── config.ts     # Config API routes
│       └── processes.ts  # Session API routes
└── client/               # React frontend
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx      # Entry point
    │   ├── components/
    │   │   └── Layout.tsx
    │   ├── pages/
    │   │   ├── ProcessMonitor.tsx
    │   │   └── ConfigEditor.tsx
    │   ├── hooks/
    │   │   └── useWebSocket.ts
    │   ├── api/
    │   │   └── client.ts
    │   └── styles/
    │       └── globals.css
    ├── public/           # Build output (after build)
    ├── index.html        # HTML template
    ├── vite.config.ts    # Vite configuration
    ├── tailwind.config.js
    └── package.json      # Client dependencies
```

### Build Commands

From project root (`/Users/jenova/projects/jenova-marie/iris-mcp`):

```bash
# Build everything (TypeScript + React)
pnpm build

# Watch mode (auto-rebuild)
pnpm dev

# Run built server
pnpm start

# Client-only development (with Vite hot reload)
cd src/dashboard/client
pnpm dev

# Build client only
cd src/dashboard/client
pnpm build
```

### Environment Variables

Client (`.env` in `src/dashboard/client/`):

```bash
VITE_API_URL=http://localhost:3100/api
VITE_WS_URL=http://localhost:3100
```

Server uses main config.yaml, no env vars needed.

### Hot Reload Development

**Option 1: Separate Servers** (recommended for UI development)

1. Start main server:
   ```bash
   pnpm start
   ```

2. Start Vite dev server:
   ```bash
   cd src/dashboard/client
   pnpm dev
   ```

3. Open Vite URL (usually http://localhost:5173)

**Option 2: Integrated** (production-like)

1. Build client:
   ```bash
   cd src/dashboard/client
   pnpm build
   ```

2. Start server:
   ```bash
   pnpm start
   ```

3. Open server URL (http://localhost:3100)

---

## Deployment

### Production Build

1. Build client:
   ```bash
   cd src/dashboard/client
   pnpm build
   ```
   Output: `src/dashboard/client/dist/` → copied to `dist/dashboard/public/` by root build

2. Build server:
   ```bash
   pnpm build
   ```
   Output: `dist/dashboard/server/`

3. Run:
   ```bash
   pnpm start
   ```

### Static Files

The server serves the React build from `dist/dashboard/public/`:

```typescript
// src/dashboard/server/index.ts
app.use(express.static(publicPath));

// SPA fallback (for client-side routing)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
    res.sendFile(path.join(publicPath, 'index.html'));
  }
});
```

### Reverse Proxy (Optional)

For production, use Nginx/Caddy to:
- Serve static files directly
- Proxy API/WebSocket to Express
- Handle SSL termination

Example Nginx config:

```nginx
server {
  listen 80;
  server_name iris.example.com;

  location / {
    root /path/to/dist/dashboard/public;
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://localhost:3100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  location /ws/ {
    proxy_pass http://localhost:3100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
  }
}
```

---

## Future Enhancements

### Planned Features

1. **Real-Time Cache Streaming**
   - Live message updates as teams communicate
   - WebSocket-based push (currently polling)
   - `streamSessionCache` implementation

2. **Advanced Analytics**
   - Message throughput graphs
   - Process health metrics
   - Team activity heatmaps

3. **Configuration Hot-Reload**
   - Apply config changes without restart
   - Live validation feedback

4. **Team Management UI**
   - Add/edit/delete teams in dashboard
   - Test team connections
   - View team logs

5. **Authentication & Authorization**
   - User accounts
   - Role-based access control
   - API token management

6. **Notification System**
   - Browser notifications for events
   - Email/Slack integrations
   - Custom alerting rules

7. **Multi-Server Support**
   - Manage multiple Iris instances
   - Cross-server coordination
   - Federated dashboard

### Known Limitations

- **No Authentication**: Dashboard is open to anyone with network access (use firewall or SSH tunnel for remote access)
- **No Pagination**: All sessions loaded at once (may be slow with 100+ sessions)
- **No Search/Filter**: Must scroll to find sessions
- **Cache Polling**: Report endpoint called on demand, not live-streamed
- **No Process Logs**: Can't view stdout/stderr from dashboard (use CLI tools)

---

## Troubleshooting

### Dashboard won't start

**Error**: `Address already in use`

- Check if another process is using the port:
  ```bash
  lsof -i :3100
  ```
- Change port in `config.yaml` or kill the process

**Error**: `SSL certificate not found`

- Ensure `certPath` and `keyPath` exist
- Or enable `selfsigned: true`
- Or use HTTP only (`https: 0`)

### Can't connect to WebSocket

**Symptom**: "Disconnected" status in sidebar

- Check browser console for errors
- Ensure server is running (`pnpm start`)
- Verify WebSocket URL in `VITE_WS_URL` env var
- Check firewall rules (allow port 3100)

### Fork button doesn't appear

**Cause**: `dashboard.forkScriptPath` not configured

- Add to `config.yaml`:
  ```yaml
  dashboard:
    forkScriptPath: ~/.iris/fork.sh
  ```
- Create fork script (see [Fork Script](#fork-script))

### Fork button fails

**Error**: "Fork script not found"

- Ensure script exists at configured path
- Make it executable: `chmod +x ~/.iris/fork.sh`
- Check script syntax (test manually)

**Error**: "Failed to launch terminal"

- Check script output in server logs
- Ensure terminal application is installed
- Verify team path exists

### Sessions don't update

**Cause**: WebSocket disconnected

- Check connection status in sidebar
- Reload page to reconnect
- Check server logs for errors

**Cause**: Polling disabled

- Sessions update every 5 seconds via React Query
- Check browser network tab for API calls

### Configuration won't save

**Error**: "Invalid configuration"

- Check JSON syntax (trailing commas, quotes)
- Ensure required fields present (teams.*.path)
- View detailed errors in error banner

**Error**: "Permission denied"

- Ensure server has write access to config file
- Check file permissions: `ls -l ~/.iris/config.yaml`

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
- [API.md](./API.md) - Phase 3 HTTP/WebSocket API (future)
- [ACTIONS.md](./ACTIONS.md) - MCP tool implementations
- [PROCESS_POOL.md](./PROCESS_POOL.md) - Process pooling details
- [SESSION.md](./SESSION.md) - Session management
- [CONFIG.md](./CONFIG.md) - Configuration schema

---

## Summary

The Iris MCP Dashboard provides a powerful, real-time interface for monitoring and managing team sessions. With its React-based UI, WebSocket integration, and comprehensive API, it makes complex inter-team coordination visible and controllable.

Key highlights:
- **Session-based architecture** (fromTeam→toTeam)
- **Real-time updates** via WebSocket
- **Unified state** combining SessionManager + ProcessPool
- **Full session lifecycle** management (fork/sleep/reboot/delete)
- **Live configuration editing** with validation
- **Modern UI** with Tailwind + Lucide icons

For development help, see [Development](#development).
For production deployment, see [Deployment](#deployment).
