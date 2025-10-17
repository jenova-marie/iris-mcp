# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Iris Dashboard - Phase 2 Web Monitoring Interface

This is the **Phase 2** web dashboard for Iris MCP, providing real-time monitoring and control of Claude process pools through a React SPA with WebSocket updates.

## Project Context

**Parent Project**: This is a child project within the larger `iris-mcp` system (`/Users/jenova/projects/jenova-marie/iris-mcp`).

**Location**: `/Users/jenova/projects/jenova-marie/iris-mcp/src/dashboard`

**Relationship to Parent**: The dashboard integrates with Phase 1's process pooling infrastructure via `DashboardStateBridge`, which provides read-only access to:
- `ClaudeProcessPool` (runtime process status)
- `SessionManager` (persistent session data in SQLite)
- `TeamsConfigManager` (hot-reloadable YAML configuration)
- `PendingPermissionsManager` (permission approval system)

## Build Commands

All commands run from the **parent directory** (`/Users/jenova/projects/jenova-marie/iris-mcp`):

```bash
# Build everything (server + dashboard client)
pnpm build

# Build only dashboard client
pnpm build:client

# Development mode - Vite dev server with hot reload (port 5173)
pnpm dev:client

# Development mode - Watch parent server (port 3100)
pnpm dev

# Run tests
pnpm test
```

**Important**: The dashboard has no package.json in `src/dashboard/` - it's managed by the parent's pnpm workspace. Client dependencies are in `src/dashboard/client/package.json`.

## Architecture Overview

### Three-Layer Architecture

1. **Express Server** (`server/index.ts`) - Serves React SPA, REST API, WebSocket
2. **State Bridge** (`server/state-bridge.ts`) - Read-only facade over MCP internals
3. **React Client** (`client/src/`) - SPA with TanStack Query, Socket.io, React Router

### Session-Based Data Model

**Critical Design**: Everything is organized around **session pairs** (`fromTeam->toTeam`), not individual teams.

- **poolKey**: `"team-iris->team-alpha"` - Unique identifier for a session
- **SessionProcessInfo**: Combines persistent session data (SQLite) with runtime process status (in-memory pool)
- Sessions can exist without active processes (stopped state)
- Active processes are always tied to a specific session

### HTTP + HTTPS Dual Server Support

The Express server supports simultaneous HTTP and HTTPS on different ports:

```yaml
dashboard:
  http: 3100        # HTTP server (0 to disable)
  https: 3443       # HTTPS server (0 to disable)
  selfsigned: true  # Auto-generate self-signed cert
  certPath: /path/to/cert.pem  # Or use custom cert
  keyPath: /path/to/key.pem
```

- Self-signed certificates auto-generated with proper SAN for localhost/127.0.0.1
- At least one protocol (HTTP or HTTPS) must be enabled
- Socket.io attaches to the first available server (HTTP priority)

### State Bridge (`server/state-bridge.ts`)

The bridge is the **only** interface between dashboard and MCP internals. It:

- **Merges two sources of truth**: SessionManager (persistent) + ProcessPool (runtime)
- **Forwards events** via EventEmitter: `ws:process-status`, `ws:permission:request`, etc.
- **Provides read methods**: `getActiveSessions()`, `getSessionMetrics()`, `getSessionReport()`
- **Provides action methods**: `sleepSession()`, `rebootSession()`, `deleteSession()`, `forkSession()`

**Key Methods**:

- `getActiveSessions()` - Returns ALL sessions (active + stopped) with combined data
- `getSessionMetrics(fromTeam, toTeam)` - Detailed metrics for one session
- `getSessionReport(fromTeam, toTeam)` - Message cache with conversation history
- `getPendingPermissions()` - Active permission requests awaiting approval
- `resolvePermission(permissionId, approved, reason)` - Approve/deny from dashboard

### WebSocket Event Flow

**Server → Client Events** (auto-forwarded from bridge):
- `init` - Initial state on connection (sessions, config, poolStatus, pendingPermissions)
- `process-status` - Process lifecycle updates (spawned, terminated, idle, processing)
- `cache-stream` - Real-time message cache streaming (not yet implemented)
- `config-saved` - Configuration file saved
- `permission:request` - New permission request from Claude
- `permission:resolved` - Permission approved/denied
- `permission:timeout` - Permission request timed out

**Client → Server Events**:
- `stream-cache` - Request cache streaming for a sessionId
- `permission:response` - Approve/deny permission request

### REST API Routes

**Health Check**:
- `GET /api/health` - Server health status

**Configuration** (`server/routes/config.ts`):
- `GET /api/config` - Get current teams configuration
- `PUT /api/config` - Update configuration (hot-reload)

**Processes/Sessions** (`server/routes/processes.ts`):
- `GET /api/processes` - All sessions with pool status
- `GET /api/processes/:fromTeam/:toTeam` - Session metrics
- `GET /api/processes/report/:fromTeam/:toTeam` - Message cache report
- `POST /api/processes/sleep/:fromTeam/:toTeam` - Terminate process
- `POST /api/processes/reboot/:fromTeam/:toTeam` - Clear and restart session
- `POST /api/processes/delete/:fromTeam/:toTeam` - Delete session permanently
- `POST /api/processes/terminal/launch` - Fork session to new terminal (via sessionId)

### Client Architecture (`client/src/`)

**Tech Stack**:
- **React 18.2** with TypeScript
- **Vite** for development (port 5173) and production builds
- **TanStack Query** for server state management
- **Socket.io-client** for WebSocket connections
- **React Router** for navigation
- **Axios** for HTTP requests

**Key Files**:
- `App.tsx` - Router setup, QueryClient, permission modal management
- `hooks/useWebSocket.ts` - WebSocket connection with callback refs pattern
- `api/client.ts` - Axios instance with interceptors
- `pages/ProcessMonitor.tsx` - Main dashboard view
- `pages/ConfigEditor.tsx` - YAML config editor
- `components/PermissionApprovalModal.tsx` - Permission approval UI

**WebSocket Hook Pattern**:

The `useWebSocket` hook uses **callback refs** to allow callback updates without reconnecting:

```typescript
const { connected, streamCache, respondToPermission } = useWebSocket(
  onProcessStatus,  // Callback for process updates
  onCacheStream,    // Callback for cache streaming
  onPermissionRequest, // Callback for permission requests
);
```

Callbacks are stored in refs and updated on each render, while the socket connection remains stable.

### Permission Approval System

The dashboard can approve/deny Claude Code permission requests in real-time:

1. Claude requests permission → `PermissionManager` creates pending request
2. Bridge forwards `permission:request` event → Dashboard WebSocket emits to all clients
3. User approves/denies in `PermissionApprovalModal`
4. Dashboard sends `permission:response` via WebSocket
5. Bridge calls `resolvePermission()` → PermissionManager unblocks Claude

**Timeout Handling**: Permissions auto-timeout after 5 minutes (configurable). Modal receives `permission:timeout` event.

### Static File Serving

The Express server serves the built React SPA from `dist/dashboard/public`:

```typescript
app.use(express.static(publicPath));
app.get('*', (req, res) => {
  // SPA fallback - all non-API routes serve index.html
});
```

**Development**: Use `pnpm dev:client` for Vite dev server with proxy to Express backend on port 3100.

**Production**: Run `pnpm build:client` then `pnpm start` - Express serves pre-built static files.

### Vite Configuration (`client/vite.config.ts`)

- **Output**: `../../../dist/dashboard/public` (parent's dist folder)
- **Dev Server**: Port 5173 with proxy to `http://localhost:3100` for `/api` and `/ws`
- **Alias**: `@/` maps to `./src` for cleaner imports
- **Source Maps**: Enabled in production builds

### Environment Variables

**Client** (Vite):
- `VITE_API_URL` - API base URL (default: `/api`)
- `VITE_WS_URL` - WebSocket URL (default: `http://localhost:3100`)

**Server** (via parent config):
- `IRIS_HOME` - Iris configuration directory (default: `~/.iris`)
- `DEBUG` - Enable debug logging

## Development Workflow

### Local Development with Hot Reload

**Terminal 1** - Run parent MCP server with watch mode:
```bash
cd /Users/jenova/projects/jenova-marie/iris-mcp
pnpm dev
```

**Terminal 2** - Run Vite dev server for React client:
```bash
cd /Users/jenova/projects/jenova-marie/iris-mcp
pnpm dev:client
```

Open browser to `http://localhost:5173` - Vite proxies API requests to Express on port 3100.

### Production Build

```bash
cd /Users/jenova/projects/jenova-marie/iris-mcp
pnpm build         # Builds server + client
pnpm start         # Serves production build
```

Dashboard available at `http://localhost:3100` (configured via `config.yaml`).

### Debugging WebSocket Issues

All WebSocket events are logged to browser console with `[WebSocket]` prefix. Check:

1. Connection status in `useWebSocket` hook
2. Event payloads in browser DevTools console
3. Server logs (stderr) with `dashboard:server` context

## Key Design Decisions

### Why Session-Based, Not Team-Based?

- A "team" in config.yaml is just a folder path
- Real conversations happen between **team pairs** (e.g., iris→alpha, iris→beta)
- Each pair has a unique session ID, message cache, and optional running process
- Multiple sessions can use the same team config (different fromTeam)

### Why DashboardStateBridge?

- **Separation of concerns**: Dashboard doesn't directly import MCP action handlers
- **Event forwarding**: Bridge converts internal pool events to WebSocket events
- **Read-only safety**: Dashboard can't accidentally mutate pool state
- **Testing**: Bridge can be mocked for client-side tests

### Why Dual SessionManager + ProcessPool?

- **SessionManager** (SQLite): Persistent data survives restarts, shows all sessions
- **ProcessPool** (in-memory): Runtime status of currently active processes
- **Bridge merges both**: Complete picture of what exists vs what's running

### Why Callback Refs in useWebSocket?

- Avoids reconnecting socket on every callback change
- Allows parent components to update callbacks freely
- Single socket instance per component lifecycle

## Testing Strategy

**Client Tests** (not yet implemented):
- Component tests with Vitest + Testing Library
- Mock WebSocket events via `useWebSocket` hook
- Mock Axios requests via MSW

**Server Tests** (not yet implemented):
- Integration tests with real DashboardStateBridge
- WebSocket event forwarding tests
- API endpoint tests with supertest

## Future Enhancements

From `README.md` planned features:
- Live message stream (cache streaming implementation pending)
- Analytics dashboard (process pool metrics over time)
- Team management UI (add/edit teams without editing YAML)
- Multi-user support (authentication, user sessions)

## Common Debugging Tasks

**Dashboard not loading**:
1. Check Express server is running on configured port (`config.yaml` → `dashboard.http`)
2. Verify React build exists in `dist/dashboard/public` (run `pnpm build:client`)
3. Check browser console for CORS or network errors

**WebSocket not connecting**:
1. Verify Socket.io path is `/ws` (matches server config)
2. Check `VITE_WS_URL` environment variable
3. Review browser DevTools Network tab for WebSocket upgrade request

**Permissions not appearing**:
1. Verify `grantPermission: "forward"` in team config
2. Check `PendingPermissionsManager` is passed to `DashboardStateBridge`
3. Watch for `permission:request` events in browser console

**Sessions not showing**:
1. Check SessionManager database exists (`~/.iris/sessions.db`)
2. Verify teams are configured in `config.yaml`
3. Use `getActiveSessions()` to debug bridge data merging

## Important File Paths

**Relative to this directory** (`src/dashboard/`):
- `server/index.ts` - Express server entry point
- `server/state-bridge.ts` - Bridge between MCP internals and dashboard
- `server/routes/processes.ts` - Session management API routes
- `server/routes/config.ts` - Configuration management API routes
- `client/src/App.tsx` - React app root with routing
- `client/src/hooks/useWebSocket.ts` - WebSocket connection hook
- `client/vite.config.ts` - Vite build configuration

**Relative to parent** (`../`):
- `process-pool/pool-manager.ts` - ClaudeProcessPool (runtime state)
- `session/session-manager.ts` - SessionManager (persistent data)
- `config/iris-config.ts` - TeamsConfigManager (config hot-reload)
- `permissions/pending-manager.ts` - PendingPermissionsManager
- `iris.ts` - IrisOrchestrator (message cache access)
