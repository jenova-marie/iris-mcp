# Permission Approval Feature - Implementation Plan

## Overview

Add granular permission approval modes for teams when remote Claude instances request tool access via reverse MCP tunnel.

## Current State

- Remote teams with `enableReverseMcp: true` have `--permission-prompt-tool mcp__iris__permissions__approve` added
- The `permissions__approve` tool currently auto-approves all `mcp__iris__*` tools and denies all others
- No context about which team is making the request is available in the permission handler

## Proposed Modes

Add `grantPermission` field to team config:

```yaml
teams:
  backend:
    path: /path/to/backend
    remote: "ssh backend-server"
    enableReverseMcp: true
    grantPermission: "ask"  # yes | no | ask | forward
```

### Mode Behaviors

1. **yes** (default): Auto-approve all Iris MCP tools (current behavior)
2. **no**: Auto-deny all permission requests
3. **ask**: Show approval popup in dashboard with cache context
4. **forward**: Send Slack/webhook notification for approval (future)

## Architecture Challenge

### The Problem

When remote Claude calls `permissions__approve` via reverse MCP tunnel:
- Request comes through HTTP MCP endpoint (`/mcp`)
- No fromTeam/toTeam context in the permission request
- Can't determine which team config to check

### Current Request Flow

```
Remote Claude (via SSH tunnel)
  → HTTP Request to localhost:1615/mcp
  → StreamableHTTPServerTransport
  → MCP Server CallToolRequest
  → permissions__approve(tool_name, input, reason)
  ❌ No team context available!
```

## Solution Options

### Option 1: Session-Based HTTP Transport (Recommended)

**Concept**: Track which team owns each HTTP MCP session

**Implementation**:

1. **Modify HTTP Transport** to use session IDs instead of stateless mode
   ```typescript
   // src/mcp_server.ts - In run() method for HTTP transport
   const httpTransport = new StreamableHTTPServerTransport({
     sessionIdGenerator: () => crypto.randomUUID(), // Enable sessions
     enableJsonResponse: true,
   });
   ```

2. **Track Session → Team Mapping**
   ```typescript
   // Global map in mcp_server.ts
   private mcpSessionToTeam = new Map<string, { fromTeam: string; toTeam: string }>();
   ```

3. **Inject Team Context on Connection**
   - When SSH transport spawns, it creates the reverse tunnel
   - The first HTTP request from remote Claude establishes the session
   - Store session ID → team mapping
   ```typescript
   // In HTTP /mcp handler
   const sessionId = httpTransport.getSessionId();
   if (!this.mcpSessionToTeam.has(sessionId)) {
     // Detect team from active sessions or use reverse lookup
     const teamInfo = this.detectTeamFromRequest(req);
     this.mcpSessionToTeam.set(sessionId, teamInfo);
   }
   ```

4. **Update permissionsApprove Signature**
   ```typescript
   export async function permissionsApprove(
     request: PermissionApprovalRequest,
     teamContext: { fromTeam: string; toTeam: string }, // New parameter
     configManager: TeamsConfigManager,
     dashboardBridge?: DashboardStateBridge
   ): Promise<PermissionApprovalResponse>
   ```

5. **Pass Context from MCP Server**
   ```typescript
   case "permissions__approve":
     const sessionId = getCurrentSessionId(); // From transport
     const teamContext = this.mcpSessionToTeam.get(sessionId);
     result = {
       content: [{
         type: "text",
         text: JSON.stringify(
           await permissionsApprove(
             args as any,
             teamContext!,
             this.configManager,
             this.dashboardBridge
           ),
           null,
           2
         ),
       }],
     };
     break;
   ```

**Pros**:
- Clean separation of concerns
- Session tracking solves team context problem
- Enables future features (per-session state)

**Cons**:
- Requires refactoring HTTP transport to be stateful
- Need mechanism to detect team from initial HTTP request

---

### Option 2: Custom HTTP Header Injection

**Concept**: Have SSH transport inject custom header with team name

**Implementation**:

1. **Modify Claude CLI invocation** to pass custom headers
   - Problem: Claude CLI doesn't support custom HTTP headers for MCP config
   - Would require upstream changes to Claude CLI

**Status**: ❌ Not feasible without Claude CLI changes

---

### Option 3: Team Detection from Tunnel Port

**Concept**: Each team uses unique tunnel port, map port → team

**Implementation**:

1. **Modify Config** to assign unique reverseMcpPort per team
   ```yaml
   teams:
     backend:
       enableReverseMcp: true
       reverseMcpPort: 1615
     frontend:
       enableReverseMcp: true
       reverseMcpPort: 1616
   ```

2. **Map Port → Team** at server startup
   ```typescript
   private portToTeam = new Map<number, string>();

   constructor() {
     for (const [teamName, config] of Object.entries(this.config.teams)) {
       if (config.enableReverseMcp) {
         const port = config.reverseMcpPort || 1615;
         this.portToTeam.set(port, teamName);
       }
     }
   }
   ```

3. **Detect Team from Request** using local port
   ```typescript
   // In HTTP /mcp handler
   const localPort = req.socket.localPort;
   const teamName = this.portToTeam.get(localPort);
   ```

**Pros**:
- Simple, no session tracking needed
- Uses existing config structure

**Cons**:
- Requires unique port per team (port exhaustion with many teams)
- fromTeam/toTeam ambiguity (we only know toTeam from port)
- SSH tunnel limitations on port ranges

---

## Recommended Approach: Hybrid Solution

Combine **Option 1** (Session-Based) with simplified team detection:

### Phase 1: Team Detection (Simple)

When reverse MCP is enabled, each team's SSH tunnel is associated with a specific process in the pool. Use **pool key** to identify the team:

```typescript
// In ClaudeProcessPool
public getTeamForPid(pid: number): { fromTeam: string; toTeam: string } | null {
  for (const [poolKey, process] of this.processes) {
    if (process.getPid() === pid) {
      const [fromTeam, toTeam] = poolKey.split('->');
      return { fromTeam, toTeam };
    }
  }
  return null;
}
```

Problem: HTTP request doesn't carry PID info either...

### Alternative: Process-Scoped MCP Servers

Instead of one global HTTP MCP server, spawn one per team:

```typescript
// Each team with enableReverseMcp gets its own HTTP server
// Listening on unique port (config.reverseMcpPort or auto-assigned)
// This server KNOWS which team it serves
```

This is closer to Option 3 but more explicit.

---

## Implementation Steps (Option 1 - Recommended)

### 1. Add grantPermission to Config Schema ✅

```typescript
// src/process-pool/types.ts
export interface IrisConfig {
  // ...existing fields
  grantPermission?: "yes" | "no" | "ask" | "forward";
}
```

### 2. Create Permission Queue

```typescript
// src/permissions/permission-queue.ts
export interface PendingPermission {
  id: string; // UUID
  fromTeam: string;
  toTeam: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
  requestedAt: number;
  cacheContext?: string[]; // Recent cache messages for context
  status: "pending" | "approved" | "denied" | "timeout";
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
}

export class PermissionQueue extends EventEmitter {
  private pendingPermissions = new Map<string, PendingPermission>();

  async requestPermission(
    fromTeam: string,
    toTeam: string,
    toolName: string,
    input: Record<string, unknown>,
    reason?: string,
    timeout: number = 60000 // 1 minute default
  ): Promise<boolean> {
    // Create pending permission
    // Emit 'permission-requested' event for dashboard
    // Wait for approval/denial or timeout
    // Return boolean
  }

  approvePermission(id: string): void {
    // Find pending permission
    // Resolve promise with true
    // Remove from queue
  }

  denyPermission(id: string): void {
    // Find pending permission
    // Resolve promise with false
    // Remove from queue
  }

  getPendingPermissions(fromTeam?: string): PendingPermission[] {
    // Return all or filtered by team
  }
}
```

### 3. Modify grant-permission Action

```typescript
// src/actions/grant-permission.ts
export async function permissionsApprove(
  request: PermissionApprovalRequest,
  teamContext: { fromTeam: string; toTeam: string },
  configManager: TeamsConfigManager,
  permissionQueue: PermissionQueue,
  dashboardBridge?: DashboardStateBridge
): Promise<PermissionApprovalResponse> {
  const teamConfig = configManager.getIrisConfig(teamContext.toTeam);

  if (!teamConfig) {
    return { behavior: "deny", message: "Team not found" };
  }

  const mode = teamConfig.grantPermission || "yes";

  switch (mode) {
    case "yes":
      // Auto-approve Iris tools
      if (request.tool_name.startsWith("mcp__iris__")) {
        return { behavior: "allow", updatedInput: request.input };
      }
      return { behavior: "deny", message: "Only Iris tools auto-approved" };

    case "no":
      // Auto-deny all
      return { behavior: "deny", message: "Permission auto-denied by config" };

    case "ask":
      // Request approval from dashboard
      const approved = await permissionQueue.requestPermission(
        teamContext.fromTeam,
        teamContext.toTeam,
        request.tool_name,
        request.input,
        request.reason
      );

      if (approved) {
        return { behavior: "allow", updatedInput: request.input };
      } else {
        return { behavior: "deny", message: "Permission denied by operator" };
      }

    case "forward":
      // Send Slack notification (future)
      // For now, fallback to "ask" or "deny"
      return { behavior: "deny", message: "Forward mode not yet implemented" };
  }
}
```

### 4. Dashboard API Endpoints

```typescript
// src/dashboard/server/routes/permissions.ts
export function createPermissionsRouter(
  bridge: DashboardStateBridge,
  permissionQueue: PermissionQueue
): Router {
  const router = Router();

  // GET /api/permissions - List pending permissions
  router.get("/", (req, res) => {
    const pending = permissionQueue.getPendingPermissions();
    res.json({ success: true, permissions: pending });
  });

  // POST /api/permissions/:id/approve - Approve permission
  router.post("/:id/approve", (req, res) => {
    const { id } = req.params;
    permissionQueue.approvePermission(id);
    res.json({ success: true });
  });

  // POST /api/permissions/:id/deny - Deny permission
  router.post("/:id/deny", (req, res) => {
    const { id } = req.params;
    permissionQueue.denyPermission(id);
    res.json({ success: true });
  });

  return router;
}
```

### 5. Dashboard WebSocket Events

```typescript
// In src/dashboard/server/index.ts
permissionQueue.on('permission-requested', (permission: PendingPermission) => {
  io.emit('permission-request', permission);
});

permissionQueue.on('permission-resolved', (permission: PendingPermission) => {
  io.emit('permission-resolved', permission);
});
```

### 6. Dashboard UI Component

```tsx
// src/dashboard/client/src/components/PermissionApprovalModal.tsx
export function PermissionApprovalModal() {
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);

  // Listen for WebSocket events
  useWebSocket((data) => {
    if (data.type === 'permission-request') {
      setPendingPermissions(prev => [...prev, data.permission]);
    }
  });

  const handleApprove = async (id: string) => {
    await api.approvePermission(id);
    setPendingPermissions(prev => prev.filter(p => p.id !== id));
  };

  const handleDeny = async (id: string) => {
    await api.denyPermission(id);
    setPendingPermissions(prev => prev.filter(p => p.id !== id));
  };

  if (pendingPermissions.length === 0) return null;

  return (
    <div className="permission-modal">
      {pendingPermissions.map(permission => (
        <div key={permission.id} className="permission-request">
          <h3>Permission Request</h3>
          <p><strong>Team:</strong> {permission.fromTeam} → {permission.toTeam}</p>
          <p><strong>Tool:</strong> {permission.toolName}</p>
          {permission.reason && <p><strong>Reason:</strong> {permission.reason}</p>}
          <pre>{JSON.stringify(permission.input, null, 2)}</pre>

          {/* Show recent cache context */}
          {permission.cacheContext && (
            <div className="cache-context">
              <h4>Recent Conversation:</h4>
              {permission.cacheContext.map((msg, i) => (
                <div key={i}>{msg}</div>
              ))}
            </div>
          )}

          <button onClick={() => handleApprove(permission.id)}>Approve</button>
          <button onClick={() => handleDeny(permission.id)}>Deny</button>
        </div>
      ))}
    </div>
  );
}
```

---

## Open Questions

1. **Team Context Detection**: How do we reliably map HTTP MCP requests to team pairs?
   - Need to solve this before implementing "ask" mode
   - Options: Session tracking, unique ports, or process-scoped servers

2. **Timeout Handling**: What happens if dashboard approval times out?
   - Auto-deny after 60s?
   - Configurable timeout per team?

3. **Cache Context**: How much conversation history to show?
   - Last 5 messages?
   - Summarized view?

4. **Forward Mode**: What's the Slack integration spec?
   - Webhook URL in config?
   - Approval via Slack interactive messages?

---

## Next Steps

Before proceeding with full implementation, we need to solve the **team context detection** problem. Proposed approach:

1. Start with **Option 3** (unique port per team) for simplicity
2. Document limitation in config (max N teams with reverse MCP)
3. Plan migration to **Option 1** (session-based) in future

This lets us implement the feature now while leaving room for better architecture later.

## Decision Required

Which approach should we take for team context detection?

- **A**: Unique port per team (simple, limited scale)
- **B**: Session-based HTTP transport (complex, scalable)
- **C**: Wait for Claude CLI upstream changes (blocked indefinitely)
- **D**: Other approach?

Let me know your preference and I'll proceed with implementation!
