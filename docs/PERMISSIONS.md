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

### Mode: `yes` (Default)

**Auto-approve all tool requests**

```yaml
teams:
  backend:
    path: /path/to/backend
    remote: "ssh backend-server"
    enableReverseMcp: true
    grantPermission: yes  # Auto-approve (default)
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

### Mode: `ask`

**Prompt user via dashboard for manual approval**

```yaml
teams:
  qa:
    path: /path/to/qa
    remote: "ssh qa-server"
    enableReverseMcp: true
    grantPermission: ask  # Manual approval required
```

**Behavior:**
- Tool requests create pending permission entries
- Dashboard displays real-time approval popup with context
- User manually approves or denies each request
- Configurable timeout (default: 30 seconds, see `permissionTimeout` in settings)
- Auto-denies on timeout

**Dashboard Integration:**
- WebSocket broadcast of permission requests
- Shows tool name, input parameters, reason, and recent conversation context
- One-click approve/deny buttons
- Timeout countdown display

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

Each spawned Claude process receives a unique MCP config with session-specific URL:

**LocalTransport** (`src/transport/local-transport.ts:157-171`):
```typescript
const mcpConfig = {
  mcpServers: {
    iris: {
      type: "http",
      url: `http://localhost:1615/mcp/${this.sessionId}`
    }
  }
};

args.push('--mcp-config', JSON.stringify(mcpConfig));
```

**SSH2Transport** (`src/transport/ssh2-transport.ts`):
```typescript
const mcpConfig = {
  mcpServers: {
    iris: {
      type: "http",
      url: `${protocol}://localhost:${mcpPort}/mcp/${this.sessionId}`
    }
  }
};

args.push('--mcp-config', `'${JSON.stringify(mcpConfig)}'`);
```

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

### 5. Pending Permissions Manager

**File:** `src/permissions/pending-manager.ts`

Manages "ask" mode permission requests with:
- Promise-based resolution (blocks Claude until approved/denied/timeout)
- Automatic timeout handling (default 30s)
- EventEmitter for WebSocket broadcast to dashboard
- Unique permission IDs for tracking

**Events:**
- `permission:created` - New permission request (broadcast to dashboard)
- `permission:resolved` - Permission approved/denied by user
- `permission:timeout` - Permission timed out (auto-denied)

**API:**
```typescript
// Create pending permission (blocks until resolved)
const response = await pendingPermissions.createPendingPermission(
  sessionId,
  teamName,
  toolName,
  toolInput,
  reason,
  timeoutMs
);

// Dashboard approves/denies
pendingPermissions.resolvePendingPermission(permissionId, approved, reason);
```

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

## Dashboard Integration

### WebSocket Events

The dashboard listens for permission events via WebSocket:

```typescript
// Server-side (future dashboard implementation)
pendingPermissions.on('permission:created', (request) => {
  io.emit('permission-request', request);
});

pendingPermissions.on('permission:resolved', (result) => {
  io.emit('permission-resolved', result);
});
```

### REST API Endpoints

*Planned for dashboard implementation:*

- `GET /api/permissions` - List pending permissions
- `POST /api/permissions/:id/approve` - Approve permission
- `POST /api/permissions/:id/deny` - Deny permission

### UI Components

*Planned for dashboard implementation:*

**Permission Approval Modal:**
- Real-time popup on new permission request
- Shows tool name, input parameters, reason
- Recent conversation context (last 5 messages)
- One-click approve/deny buttons
- Timeout countdown display

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

**Cause:** AsyncLocalStorage context not set (request not going through `/mcp/:sessionId` route)

**Fix:**
- Ensure reverse MCP tunnel uses session-specific URL: `http://localhost:1615/mcp/{sessionId}`
- Check MCP config in LocalTransport/SSH2Transport spawn args
- Verify Express route handler wraps request in `runWithContext()`

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
1. Check if process is still alive: `team_isAwake`
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

## Future Enhancements

1. **Forward Mode Implementation** - Hierarchical permission delegation
2. **Permission History** - SQLite storage of approval decisions for audit trail
3. **Permission Policies** - Fine-grained rules per tool/action
4. **Notification Integration** - Slack/webhook forwarding for remote approval
5. **Permission Templates** - Reusable permission profiles
6. **Time-Based Restrictions** - Approval windows (e.g., business hours only)
7. **Multi-Factor Approval** - Require multiple approvers for sensitive operations

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
