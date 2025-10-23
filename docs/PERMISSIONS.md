# Permission System Documentation

## Overview

The Iris MCP permission system provides granular control over tool access for remote Claude instances connecting via reverse MCP tunneling. Each team can be configured with a permission approval mode that determines how tool usage requests are handled.

## Architecture

### The SessionId-Based Solution

The permission system leverages a key insight: **only autonomous spawned agents (toTeam) ever call the `permissions__approve` tool**. Console users have keyboards for interactive approval and will never call this tool.

This enables a simple, elegant architecture:

```
Session Creation:
  fromTeam -> toTeam (sessionId: X)
  └─> toTeam gets MCP config with /mcp/X

Permission Request:
  Request arrives at /mcp/X
  └─> ALWAYS from toTeam (the spawned agent)
  └─> NEVER from fromTeam (they have interactive approval)
```

### Request Flow

```
Remote Claude (via reverse MCP tunnel)
  → HTTP Request to localhost:1615/mcp/:sessionId
  → Express route wraps request in AsyncLocalStorage context
  → StreamableHTTPServerTransport
  → MCP Server CallToolRequest
  → permissions__approve(tool_name, input, reason)
  → Extract sessionId from AsyncLocalStorage
  → Lookup process in ProcessPool using sessionId
  → Get teamName from process
  → Load team config and check grantPermission mode
  → Return allow/deny decision
```

## Permission Modes

Configure permission behavior using the `grantPermission` field in team config:

### Mode: `yes`

**Auto-approve all tool requests**

```yaml
teams:
  backend:
    path: /path/to/backend
    remote: "ssh backend-server"
    enableReverseMcp: true
    grantPermission: yes  # Auto-approve
```

**Behavior:**
- All tool requests are automatically approved
- No user intervention required
- Fastest response time
- Suitable for trusted, fully autonomous teams

**Use cases:**
- Development/staging environments
- Trusted autonomous agents
- Internal team coordination

---

### Mode: `no`

**Auto-deny all tool requests (read-only mode)**

```yaml
teams:
  production:
    path: /path/to/production
    remote: "ssh prod-server"
    enableReverseMcp: true
    grantPermission: no  # Read-only mode
```

**Behavior:**
- All tool requests are automatically denied
- Agent can only read data, not execute actions
- Maximum safety for sensitive environments

**Use cases:**
- Production monitoring
- Security-sensitive environments
- Observation-only agents
- Testing permission system without risk

---

### Mode: `ask` (Default) ✅

**Prompt user via dashboard for manual approval**

```yaml
teams:
  qa:
    path: /path/to/qa
    remote: "ssh qa-server"
    enableReverseMcp: true
    grantPermission: ask  # Manual approval required (default)
```

**Status:** ✅ **Fully Implemented** (as of v0.0.1)

**Behavior:**
- Tool requests create pending permission entries via `PendingPermissionsManager`
- Dashboard displays real-time approval modal with full context
- User manually approves or denies each request with one click
- Configurable timeout (default: 30 seconds, see `permissionTimeout` in settings)
- Auto-denies on timeout with cleanup

**Dashboard Integration:** ✅ **Live**
- WebSocket broadcast of permission requests (`permission:request` event)
- Real-time modal popup with tool name, input parameters, reason, session context
- One-click approve/deny buttons
- Countdown timer display (60 seconds default in UI)
- Auto-dismisses on timeout with `permission:timeout` event

**Use cases:**
- QA/testing environments
- Semi-autonomous agents requiring oversight
- Learning/training agents
- Auditing tool usage

**Configuration:**

```yaml
settings:
  permissionTimeout: 30000  # Timeout in milliseconds (default: 30s)

teams:
  qa:
    grantPermission: ask
```

---

### Mode: `forward`

**Forward permission request to parent team** *(Not yet implemented)*

```yaml
teams:
  child:
    path: /path/to/child
    remote: "ssh child-server"
    enableReverseMcp: true
    grantPermission: forward  # Forward to parent (future)
```

**Planned Behavior:**
- Permission request forwarded to the team that spawned this agent (fromTeam)
- Parent team decides approval based on their own `grantPermission` mode
- Creates permission chain up to console user or dashboard
- Enables hierarchical delegation of trust

**Use cases:** *(Future)*
- Multi-tier agent architectures
- Delegation chains
- Distributed permission management

**Current Status:** Returns denial with message explaining feature not implemented.

---

## Configuration

### Team Configuration

```yaml
teams:
  team-name:
    path: /path/to/project
    remote: "ssh user@host"          # Required for permission system
    enableReverseMcp: true            # Required for permission system
    grantPermission: yes              # Permission mode (yes/no/ask/forward)
    claudePath: /usr/local/bin/claude # Custom Claude CLI path
```

### Global Settings

```yaml
settings:
  permissionTimeout: 30000  # Timeout for "ask" mode approval (default: 30s)
  httpPort: 1615            # MCP HTTP server port
```

## Implementation Details

### 1. AsyncLocalStorage Context

The MCP SDK doesn't provide a way to pass custom context through tool calls. Iris uses Node.js `AsyncLocalStorage` to maintain request-scoped context:

**File:** `src/utils/request-context.ts`

```typescript
// Express route sets context
await runWithContext({ sessionId }, async () => {
  await httpTransport.handleRequest(req, res, req.body);
});

// Tool handler retrieves context
const sessionId = getSessionId(); // From AsyncLocalStorage
```

This allows:
1. Extract `sessionId` from URL params (`/mcp/:sessionId`)
2. Store in AsyncLocalStorage
3. Retrieve in `permissions__approve` handler
4. Pass to Iris for team detection

### 2. MCP Config Injection

**CRITICAL UPDATE (2025-10-23): Session-Specific Server Naming**

Each spawned Claude process receives a unique MCP config with **session-specific server name** to avoid conflicts with global configurations:

**ClaudeCommandBuilder** (`src/utils/command-builder.ts:199-224`):
```typescript
static buildMcpConfig(irisConfig: IrisConfig, sessionId: string): McpConfig {
  const mcpUrl = `${protocol}://localhost:${mcpPort}/mcp/${sessionId}`;

  // Use session-specific server name to prevent conflicts with global ~/.claude.json
  const serverName = `iris-${sessionId}`;

  return {
    mcpServers: {
      [serverName]: {  // e.g., "iris-97b5b2c9-1b34-4c83-86b8-2f4e711aac89"
        type: "http",
        url: mcpUrl,
      },
    },
  };
}
```

**Why Session-Specific Naming Matters:**

Without unique server names, local teams connected to iris-mcp through **two simultaneous channels**:
1. **Global connection** via `~/.claude.json` (server name: `"iris"`) - NO session context in URL
2. **Session-specific connection** via `--mcp-config` (server name: `"iris"`) - HAS session context

When Claude invoked tools, it defaulted to the global connection, causing `permissions__approve` to fail with "No session context (server configuration error)" because the request arrived at `/mcp/:sessionId` but through a connection that wasn't bound to that sessionId.

**The Solution:**

By naming the session-specific MCP server `iris-${sessionId}`, we create **distinct namespaces**:
- Regular iris tools use global `mcp__iris__*` connection (efficient, no session needed)
- Permission tool uses session-specific `mcp__iris-${sessionId}__permissions__approve` connection (has session context)

**Permission Tool Flag** (`src/utils/command-builder.ts:128-154`):
```typescript
// Match the session-specific server name
const permissionTool = `mcp__iris-${sessionId}__permissions__approve`;

if (grantPermission === "yes" || grantPermission === "ask") {
  args.push("--permission-prompt-tool", permissionTool);
}
```

**Result:**
- ✅ `permissions__approve` always gets session context via dedicated connection
- ✅ Other iris tools work efficiently through global connection
- ✅ No naming conflicts, no "No session context" errors
- ✅ Works for both local and remote teams

The `sessionId` in the URL naturally routes permission requests to the correct team context.

### 3. Session-Based Team Detection

**File:** `src/iris.ts:617-658`

```typescript
async handlePermissionRequest(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  reason?: string,
): Promise<PermissionDecision> {
  // Lookup process from session
  const process = this.processPool.getProcessBySessionId(sessionId);

  const teamName = process.teamName;
  const teamConfig = this.config.teams[teamName];
  const mode = teamConfig.grantPermission || "yes";

  // Apply permission rules based on mode...
}
```

### 4. Thin Adapter Pattern

The `permissions__approve` action is a thin adapter that delegates business logic to Iris:

**File:** `src/actions/permissions.ts`

```typescript
export async function permissionsApprove(
  request: PermissionApprovalRequest,
  iris: IrisOrchestrator,
): Promise<PermissionApprovalResponse> {
  // Get sessionId from AsyncLocalStorage context
  const sessionId = getSessionId();

  // Delegate to Iris for business logic
  const decision = await iris.handlePermissionRequest(
    sessionId,
    request.tool_name,
    request.input,
    request.reason,
  );

  // Format MCP response
  return {
    behavior: decision.allow ? "allow" : "deny",
    message: decision.message,
  };
}
```

### 5. Pending Permissions Manager ✅

**File:** `src/permissions/pending-manager.ts` (Implemented)

Manages "ask" mode permission requests with:
- **Promise-based resolution**: Blocks Claude process until user approves/denies or timeout occurs
- **Automatic timeout handling**: Configurable timeout (default 5 minutes via `permissionTimeout` setting)
- **EventEmitter integration**: Broadcasts events to dashboard via WebSocket
- **Unique permission IDs**: UUID-based tracking for each request
- **Auto-cleanup**: Resolves pending promises on timeout and removes stale entries

**Events:**
- `permission:created` - New permission request created (broadcast to dashboard clients)
- `permission:resolved` - Permission approved/denied by user via dashboard
- `permission:timeout` - Permission request timed out (auto-denied)

**API:**
```typescript
// Create pending permission (async - blocks until resolved or timeout)
const response = await pendingPermissions.createPendingPermission(
  sessionId,
  teamName,
  toolName,
  toolInput,
  reason
);
// Returns: { approved: boolean, reason?: string }

// Dashboard approves/denies (called via WebSocket handler)
const success = pendingPermissions.resolvePendingPermission(
  permissionId,
  approved,
  reason
);

// Get all pending requests (for dashboard UI)
const pending = pendingPermissions.getPendingRequests();
```

**Integration Points:**
- **IrisOrchestrator** (`src/iris.ts:1846-1903`): Calls `createPendingPermission()` for "ask" mode
- **DashboardStateBridge** (`src/dashboard/server/state-bridge.ts`): Forwards events to WebSocket clients
- **Dashboard Server** (`src/dashboard/server/index.ts`): WebSocket handlers for `permission:response` events
- **MCP Server** (`src/mcp_server.ts:932-934`): Initializes manager with configurable timeout

### 6. HTTP Route Handler

**File:** `src/mcp_server.ts:913-991`

```typescript
app.all("/mcp/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;

  // Lookup process from pool
  const process = this.processPool.getProcessBySessionId(sessionId);

  // Run with AsyncLocalStorage context
  await runWithContext({ sessionId }, async () => {
    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true,
    });

    await this.server.connect(httpTransport);
    await httpTransport.handleRequest(req, res, req.body);
  });
});
```

## Security Considerations

### SessionId Uniqueness

- SessionId is a UUID (crypto.randomUUID() in future)
- Currently format: `{fromTeam}-{toTeam}` (predictable, but requires config knowledge)
- Unguessable sessionIds prevent cross-team permission request forgery
- Each spawn gets unique sessionId → no collision risk

### Read-Only Mode

`grantPermission: no` provides a safety layer for:
- Production environments
- Untrusted agents
- Security audits
- Testing without risk

Agents in read-only mode can:
- Read data via MCP tools that don't require permissions
- Query status
- View configuration

Agents in read-only mode CANNOT:
- Execute actions (all tool requests denied)
- Modify state
- Spawn other teams
- Access external resources

### Permission Boundaries

Each team has isolated permission scope:
- Permissions apply only to that team's Claude instance
- No cross-team permission inheritance (except future "forward" mode)
- Dashboard approval shows full tool context for informed decisions

## Dashboard Integration ✅

### WebSocket Events (Implemented)

The dashboard receives real-time permission events via WebSocket (Socket.io):

**Server → Client Events** (`src/dashboard/server/index.ts:1305-1324`):
```typescript
socket.emit('permission:request', {
  permissionId: string,
  sessionId: string,
  teamName: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  reason?: string,
  createdAt: string
});

socket.emit('permission:resolved', {
  permissionId: string,
  approved: boolean,
  reason?: string
});

socket.emit('permission:timeout', {
  permissionId: string,
  request: PendingPermissionRequest
});
```

**Client → Server Events** (`src/dashboard/server/index.ts:1333-1361`):
```typescript
socket.on('permission:response', {
  permissionId: string,
  approved: boolean,
  reason?: string
});
```

**Event Flow:**
1. Remote Claude requests permission → `PendingPermissionsManager` creates pending entry
2. Manager emits `permission:created` → `DashboardStateBridge` forwards as `ws:permission:request`
3. Dashboard server broadcasts `permission:request` to all connected WebSocket clients
4. User responds via modal → Client sends `permission:response`
5. Server calls `bridge.resolvePermission()` → Unblocks Claude process
6. Manager emits `permission:resolved` → Dashboard server broadcasts to all clients

### State Bridge API (Implemented)

**File:** `src/dashboard/server/state-bridge.ts:1690-1714`

```typescript
// Get all pending permission requests
const pending = bridge.getPendingPermissions();

// Resolve a permission request
const success = bridge.resolvePermission(permissionId, approved, reason);
```

### UI Components ✅

**Permission Approval Modal** (`src/dashboard/client/src/components/PermissionApprovalModal.tsx`)

**Features:**
- Real-time popup on new permission request (via WebSocket)
- Displays tool name, input parameters (JSON formatted), reason, team name, session ID
- One-click approve/deny buttons with color-coded actions (green/red)
- Countdown timer (60 seconds default) with auto-dismiss on timeout
- Clean modal design with backdrop blur
- Full parameter inspection with scrollable JSON view

**Implementation Details:**
- Integrated in `App.tsx` as global modal
- Uses `useWebSocket` hook for permission event subscription
- Automatically shows/hides based on pending permission state
- Timeout handled gracefully with `onTimeout` callback

See [DASHBOARD.md](./DASHBOARD.md#permission-approval-system) for complete dashboard documentation.

## Troubleshooting

### Permission Request Always Denied

**Symptom:** All tool requests return "Permission denied" even with `grantPermission: yes`

**Check:**
1. Verify `enableReverseMcp: true` in team config
2. Confirm reverse MCP tunnel is active
3. Check logs for "Session not found" errors (sessionId mismatch)
4. Verify MCP config injection in Claude spawn args

**Debug:**
```bash
# Check if session exists in pool
curl http://localhost:1615/health

# Enable debug logging
DEBUG=* pnpm start

# Check MCP config in Claude process args
ps aux | grep claude
```

### "No session context" Error

**Symptom:** Permission requests return "No session context (server configuration error)"

**Root Cause (Fixed in v0.1.0):** MCP server name collision between global and session-specific configs

**Historical Issue:**
Before v0.1.0, both global (`~/.claude.json`) and session-specific (`--mcp-config`) MCP configurations used the same server name: `"iris"`. This caused Claude to connect through the global configuration (which lacked session context in the URL) instead of the session-specific one.

**The Fix (2025-10-23):**
Session-specific MCP configs now use unique server names: `iris-${sessionId}`

Example:
- Global config: `mcp__iris__*` (server name: `"iris"`)
- Session config: `mcp__iris-97b5b2c9-1b34-4c83-86b8-2f4e711aac89__*` (server name: `"iris-97b5b2c9-..."`)

This ensures the permission tool (`mcp__iris-${sessionId}__permissions__approve`) always uses the session-specific connection with proper context.

**If you still see this error:**
- Ensure you're running Iris MCP v0.1.0 or later
- Verify the `--permission-prompt-tool` flag includes the sessionId: `mcp__iris-${sessionId}__permissions__approve`
- Check that session-specific MCP config file uses unique server name
- Verify Express route handler wraps request in `runWithContext()`

**Debug:**
```bash
# Check spawned Claude process args
ps aux | grep claude | grep permission-prompt-tool

# Should show: --permission-prompt-tool mcp__iris-<uuid>__permissions__approve
# NOT: --permission-prompt-tool mcp__iris__permissions__approve
```

### Permission Timeout

**Symptom:** "Permission request timed out" in ask mode

**Cause:** Dashboard didn't respond within `permissionTimeout` window

**Fix:**
1. Increase timeout in config: `settings.permissionTimeout: 60000` (60 seconds)
2. Check dashboard WebSocket connection
3. Verify pending permissions manager events are emitted
4. Check dashboard UI for approval modal display issues

### Session Not Found

**Symptom:** "Session not found: {sessionId}" error

**Cause:** Process not registered in pool or already terminated

**Fix:**
1. Check if process is still alive: `team_status`
2. Verify sessionId matches active session
3. Check for process crash/termination in logs
4. Ensure process spawned successfully before permission request

## Related Documentation

- **Architecture Plan:** `docs/future/PERMISSION_APPROVAL_PLAN.md` - Original implementation plan
- **Team Identification:** `docs/TEAM_IDENTIFICATION.md` - SessionId-based team detection approach
- **Remote Teams:** `docs/REMOTE.md` - SSH transport and reverse MCP tunneling
- **Configuration:** `docs/ARCHITECTURE.md` - Full config.yaml reference

## Examples

### Development Team (Full Access)

```yaml
teams:
  dev-backend:
    path: /home/user/backend
    remote: "ssh dev-server"
    enableReverseMcp: true
    grantPermission: yes
```

### Production Team (Read-Only)

```yaml
teams:
  prod-api:
    path: /var/www/api
    remote: "ssh prod-server"
    enableReverseMcp: true
    grantPermission: no
```

### QA Team (Manual Approval)

```yaml
settings:
  permissionTimeout: 45000  # 45 seconds for QA review

teams:
  qa-frontend:
    path: /home/qa/frontend
    remote: "ssh qa-server"
    enableReverseMcp: true
    grantPermission: ask
```

### Multi-Tier Architecture (Future)

```yaml
teams:
  orchestrator:
    path: /home/user/orchestrator
    grantPermission: yes

  worker-1:
    path: /home/user/worker-1
    remote: "ssh worker1"
    enableReverseMcp: true
    grantPermission: forward  # Delegate to orchestrator
```

## API Reference

### PermissionApprovalRequest

```typescript
interface PermissionApprovalRequest {
  tool_name: string;        // Tool requesting permission
  input: Record<string, unknown>;  // Tool input parameters
  reason?: string;          // Optional reason from Claude
}
```

### PermissionApprovalResponse

```typescript
interface PermissionApprovalResponse {
  behavior: "allow" | "deny";
  message?: string;         // Optional message to Claude
  updatedInput?: Record<string, unknown>; // Modified input (unused)
}
```

### PermissionDecision

```typescript
interface PermissionDecision {
  allow: boolean;           // Approval decision
  message?: string;         // Optional message/reason
  teamName: string;         // Team that made request
  mode: "yes" | "no" | "ask" | "forward"; // Mode used
}
```

### PendingPermissionRequest

```typescript
interface PendingPermissionRequest {
  permissionId: string;     // Unique ID
  sessionId: string;        // Session making request
  teamName: string;         // Team name
  toolName: string;         // Tool requesting permission
  toolInput: Record<string, unknown>; // Tool parameters
  reason?: string;          // Claude's reason
  createdAt: Date;          // Request timestamp
}
```

## Implemented Features ✅

1. **Ask Mode** - Real-time dashboard approval with WebSocket integration
2. **Pending Permissions Manager** - Promise-based blocking with timeout handling
3. **Dashboard UI** - Permission approval modal with full context display
4. **Event System** - EventEmitter integration for reactive permission flow
5. **Session-Based Detection** - AsyncLocalStorage context for team identification

## Future Enhancements

1. **Forward Mode Implementation** - Hierarchical permission delegation to parent teams
2. **Permission History** - SQLite storage of approval decisions for audit trail
3. **Permission Policies** - Fine-grained rules per tool/action (allowlist/denylist)
4. **Notification Integration** - Slack/webhook forwarding for remote approval
5. **Permission Templates** - Reusable permission profiles across teams
6. **Time-Based Restrictions** - Approval windows (e.g., business hours only)
7. **Multi-Factor Approval** - Require multiple approvers for sensitive operations
8. **Bulk Approval** - Approve multiple pending requests at once
9. **Permission Analytics** - Track approval rates, common denials, tool usage patterns

## Testing

### Unit Tests

*Planned test coverage:*

- `tests/unit/permissions/pending-manager.test.ts` - Pending permissions lifecycle
- `tests/unit/actions/permissions.test.ts` - Permission approval logic
- `tests/unit/utils/request-context.test.ts` - AsyncLocalStorage context

### Integration Tests

*Planned test scenarios:*

- Remote team permission approval flow end-to-end
- Timeout handling for ask mode
- SessionId-based team detection
- Permission mode switching
- Dashboard approval simulation

### Manual Testing

```bash
# 1. Start Iris with dashboard
pnpm start

# 2. Configure test team with ask mode
# Edit ~/.iris/config.yaml

# 3. Wake remote team
# Use MCP tool: team_wake

# 4. Trigger permission request
# Remote Claude attempts to use restricted tool

# 5. Approve/deny via dashboard
# Check dashboard UI for approval modal
```

---

## Tech Writer Notes

**Coverage Areas:**
- Permission approval system architecture and modes (yes/no/ask/forward)
- SessionId-based team detection using AsyncLocalStorage
- PendingPermissionsManager implementation and API
- Dashboard integration with WebSocket events (permission:request, permission:resolved, permission:timeout)
- Permission Approval Modal UI component
- MCP config injection for session-specific URLs
- Security considerations (read-only mode, permission boundaries)
- Configuration options (grantPermission field, permissionTimeout setting)
- Implementation details for all permission system components
- Troubleshooting permission-related issues

**Keywords:** permissions, grantPermission, ask mode, PendingPermissionsManager, permission approval, dashboard modal, WebSocket events, AsyncLocalStorage, sessionId, team detection, reverse MCP, remote teams, security, timeout handling, permission:request, permission:resolved

**Last Updated:** 2025-10-23
**Change Context:** **CRITICAL FIX** - Documented session-specific MCP server naming solution (iris-${sessionId}) that resolves "No session context" errors for local teams. Root cause: naming collision between global ~/.claude.json config (server name "iris") and session-specific --mcp-config (also "iris") caused Claude to use global connection without session context. Fix: unique server names per session enables dual connections - global for regular tools, session-specific for permissions__approve. Updated MCP Config Injection section with detailed explanation and code references. Updated troubleshooting section with historical context and debug commands.

Previous update (2025-10-18): Updated MCP tool name in troubleshooting section. Changed: team_isAwake → team_status. Previous update (2025-10-17): Updated "ask" mode from planned to fully implemented (✅). Added details on PendingPermissionsManager implementation, dashboard WebSocket integration, and Permission Approval Modal UI. Changed default permission mode from "yes" to "ask" for safer defaults.

**Related Files:** SESSION_IDENTIFICATION.md (detailed explanation of session-specific naming), ACTIONS.md (complete tool API reference), DASHBOARD.md (permission modal UI), CONFIG.md (grantPermission configuration), REMOTE.md (reverse MCP integration), REVERSE_MCP.md (bidirectional tunneling)
