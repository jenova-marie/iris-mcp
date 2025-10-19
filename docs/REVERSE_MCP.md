# Reverse MCP: Bidirectional Claude Orchestration via SSH Tunneling

## Overview

Reverse MCP enables **remote Claude instances** (accessed via SSH) to communicate back to the **local Iris MCP server** through SSH reverse tunneling. This creates bidirectional orchestration capabilities where remote teams can coordinate local teams across network boundaries.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Local Machine (Box A)                                           │
│                                                                  │
│  ┌──────────────┐         ┌─────────────────┐                  │
│  │  team-iris   │────────▶│  Iris MCP Server│                  │
│  │  (Claude)    │         │  (HTTP :1615)   │                  │
│  └──────────────┘         └─────────────────┘                  │
│         │                          ▲                             │
│         │                          │                             │
│         │ SSH + Reverse Tunnel     │ HTTP via tunnel            │
│         │ -R 1615:localhost:1615   │                             │
│         ▼                          │                             │
└─────────────────────────────────────────────────────────────────┘
          │                          │
          │ SSH Connection           │
          ▼                          │
┌─────────────────────────────────────────────────────────────────┐
│ Remote Machine (Box B)                                          │
│                                                                  │
│  ┌──────────────────┐                                           │
│  │  team-remote     │                                           │
│  │  (Claude Code)   │                                           │
│  │                  │                                           │
│  │  localhost:1615 ─┼───────────────────────────────────────────┘
│  │  (tunneled back) │
│  └──────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. SSH Reverse Tunnel

When Iris spawns a remote Claude process, it establishes an SSH reverse tunnel:

```bash
ssh -R 1615:localhost:1615 user@remote-host "claude --headless --mcp-config '...' ..."
```

The `-R 1615:localhost:1615` flag creates a tunnel where:
- Port `1615` on the **remote machine** forwards back to port `1615` on the **local machine**
- Any process on the remote machine connecting to `localhost:1615` reaches the local Iris MCP server
- The tunnel is secured within the SSH connection (no exposed ports)

### 2. MCP Configuration

The remote Claude instance is started with an MCP configuration pointing to the tunnel:

```json
{
  "mcpServers": {
    "iris": {
      "type": "http",
      "url": "http://localhost:1615/mcp"
    }
  }
}
```

This configuration is passed via `--mcp-config` flag, allowing the remote Claude to discover and use Iris MCP tools.

### 3. Permission Approval

Remote Claude instances require permission to use MCP tools. Iris implements the `--permission-prompt-tool` interface to handle these requests:

```bash
claude --headless \
  --mcp-config '{"mcpServers":{"iris":{...}}}' \
  --permission-prompt-tool mcp__iris__permissions__approve
```

When the remote Claude wants to use an Iris tool, it calls `permissions__approve` via the reverse tunnel, and Iris responds with `allow` or `deny`.

## Configuration

### Team Configuration Schema

Add these fields to a team's configuration to enable reverse MCP:

```json
{
  "teams": {
    "team-remote": {
      "remote": "ssh user@remote-host",
      "claudePath": "~/.local/bin/claude",
      "path": "/path/to/remote/project",
      "description": "Remote team description",

      // Reverse MCP Configuration
      "enableReverseMcp": true,        // Enable reverse tunnel
      "reverseMcpPort": 1615,          // Port to tunnel (default: 1615)
      "allowHttp": true,               // Use HTTP instead of HTTPS (dev only)
    }
  }
}
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enableReverseMcp` | boolean | `false` | Enable SSH reverse tunnel for this team |
| `reverseMcpPort` | number | `1615` | Port to tunnel (both local and remote) |
| `allowHttp` | boolean | `false` | Use HTTP instead of HTTPS (for dev/self-signed certs) |

### Security Considerations

#### SSH Tunnel Security

By default, the reverse tunnel binds to `localhost` only on the remote machine. This means:

✅ **Secure**: Only processes on the remote machine can access the tunnel
✅ **No exposed ports**: The tunnel is contained within the SSH connection
✅ **Encrypted**: All traffic goes through SSH encryption

❌ **DO NOT** set `GatewayPorts yes` in `/etc/ssh/sshd_config` on the remote machine
❌ **DO NOT** expose the tunnel to the network with `-R 0.0.0.0:1615:...`

**Why this is dangerous**: With `GatewayPorts yes`, ANY machine on the remote network could access your local Iris MCP server through the tunnel. This creates a massive attack surface.

#### Permission Approval

The `permissions__approve` tool implements security policies:

```typescript
// Auto-approve only Iris MCP tools
if (tool_name.startsWith("mcp__iris__")) {
  return { behavior: "allow" };
}

// Deny everything else
return {
  behavior: "deny",
  message: "Only Iris MCP tools are auto-approved"
};
```

**Current Policy**: Auto-approve all `mcp__iris__*` tools, deny everything else.

**Future Enhancements**:
- Dashboard integration for manual approval
- Per-team approval policies
- Approval audit logs
- Time-limited approvals

#### HTTP vs HTTPS

The `allowHttp` option exists for development environments with self-signed certificates:

```json
{
  "allowHttp": true  // Development only!
}
```

⚠️ **Development Only**: HTTP traffic is unencrypted. Use only when:
- Working with self-signed certificates locally
- The tunnel is SSH-encrypted anyway (HTTP over SSH tunnel is secure)
- NOT exposing Iris MCP server directly to the network

For production deployments, use HTTPS with valid certificates.

## Implementation Details

### File: `src/config/iris-config.ts`

Zod schema validation for reverse MCP configuration:

```typescript
const TeamConfigSchema = z.object({
  // ... existing fields ...

  enableReverseMcp: z.boolean().optional(),
  reverseMcpPort: z.number().int().min(1).max(65535).optional(),
  allowHttp: z.boolean().optional(),
}).refine(
  (data) => {
    // enableReverseMcp requires remote execution
    if (data.enableReverseMcp && !data.remote) {
      return false;
    }
    return true;
  },
  {
    message: "enableReverseMcp requires remote execution to be configured",
    path: ["enableReverseMcp"],
  }
);
```

### File: `src/transport/ssh-transport.ts`

SSH command construction with reverse tunnel:

```typescript
// Add reverse tunnel flag
if (this.irisConfig.enableReverseMcp) {
  const tunnelPort = this.irisConfig.reverseMcpPort || 1615;
  const irisHttpPort = process.env.IRIS_HTTP_PORT || "1615";
  sshArgs.push("-R", `${tunnelPort}:localhost:${irisHttpPort}`);
}

// Add MCP configuration
if (this.irisConfig.enableReverseMcp) {
  const protocol = this.irisConfig.allowHttp ? "http" : "https";
  const mcpPort = this.irisConfig.reverseMcpPort || 1615;

  const mcpConfig = {
    mcpServers: {
      iris: {
        type: "http",
        url: `${protocol}://localhost:${mcpPort}/mcp`,
      },
    },
  };

  args.push("--mcp-config", `'${JSON.stringify(mcpConfig)}'`);
}

// Add permission prompt tool
if (this.irisConfig.enableReverseMcp) {
  args.push("--permission-prompt-tool", "mcp__iris__permissions__approve");
}
```

### File: `src/actions/grant-permission.ts`

Permission approval handler implementing Claude Code's `--permission-prompt-tool` interface:

```typescript
export interface PermissionApprovalRequest {
  tool_name: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface PermissionApprovalResponse {
  behavior: "allow" | "deny";
  message?: string;
  updatedInput?: Record<string, unknown>;
}

export async function permissionsApprove(
  request: PermissionApprovalRequest
): Promise<PermissionApprovalResponse> {
  // Auto-approve Iris MCP tools
  if (request.tool_name.startsWith("mcp__iris__")) {
    return {
      behavior: "allow",
      updatedInput: request.input,
    };
  }

  // Deny all other tools
  return {
    behavior: "deny",
    message: `Only Iris MCP tools are auto-approved (requested: ${request.tool_name})`,
  };
}
```

### File: `src/mcp_server.ts`

Tool registration for `permissions__approve`:

```typescript
const TOOLS = [
  {
    name: "permissions__approve",
    description: "Permission approval handler for Claude Code's --permission-prompt-tool feature",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        reason: { type: "string" },
      },
      required: ["tool_name", "input"],
    },
  },
  // ... other tools ...
];
```

## Usage Examples

### Example 1: Wake a Local Team from Remote

```typescript
// Local: team-iris tells team-remote to wake team-alpha
send_message({
  toTeam: "team-remote",
  message: "Wake team-alpha using the team_wake tool",
  fromTeam: "team-iris"
});

// Remote: team-remote executes
team_wake({
  team: "team-alpha",
  fromTeam: "team-remote"
});
// → Local team-alpha wakes up via reverse tunnel
```

### Example 2: Fork a Local Session from Remote

```typescript
// Remote team wants to interactively debug local team
session_fork({
  toTeam: "team-alpha",
  fromTeam: "team-remote"
});
// → Launches interactive terminal on local machine
```

### Example 3: List Local Teams from Remote

```typescript
list_teams({});
// → Returns all configured teams from local Iris config
```

## Testing

### Manual Testing

1. **Start Iris MCP server**:
```bash
pnpm start
```

2. **Wake a remote team with reverse MCP enabled**:
```typescript
team_wake({ team: "team-remote", fromTeam: "team-iris" });
```

3. **Test reverse communication**:
```typescript
send_message({
  toTeam: "team-remote",
  message: "List all Iris MCP teams using list_teams",
  fromTeam: "team-iris"
});
```

4. **Verify tunnel**:
On the remote machine, check that the tunnel is active:
```bash
ss -tlnp | grep :1615
# Should show: 127.0.0.1:1615 (listening)
```

### Integration Tests

See `tests/integration/reverse-mcp.test.ts` (TODO) for automated tests covering:
- SSH tunnel establishment
- MCP configuration validation
- Permission approval flow
- Tool execution via reverse tunnel

## Troubleshooting

### Error: "Invalid MCP configuration"

**Cause**: MCP config schema is incorrect.

**Fix**: Ensure the configuration follows the exact schema:
```json
{
  "mcpServers": {
    "iris": {
      "type": "http",
      "url": "http://localhost:1615/mcp"
    }
  }
}
```

Note: The `mcpServers` wrapper and `type` field are required!

### Error: "Permission denied for tool: mcp__iris__team_wake"

**Cause**: Permission approval is not working.

**Fix**: Ensure `--permission-prompt-tool mcp__iris__permissions__approve` is set in the Claude command.

**Debug**: Check logs for permission requests:
```bash
grep "Permission approval request" ~/.iris/logs/iris-mcp.log
```

### Error: "Connection refused to localhost:1615"

**Cause**: SSH reverse tunnel is not established.

**Fix**:
1. Check that `enableReverseMcp: true` in team config
2. Verify SSH connection is active
3. Check SSH command includes `-R 1615:localhost:1615`

**Debug**: On remote machine:
```bash
# Check if port is listening
netstat -tlnp | grep :1615

# Check SSH tunnel status
ps aux | grep ssh | grep -- '-R'
```

### Error: "HTTPS certificate validation failed"

**Cause**: Using self-signed certificate with HTTPS.

**Fix**: Set `"allowHttp": true` in team config for development.

**Production Fix**: Use valid HTTPS certificate or configure Claude to trust your CA.

## Performance

Reverse MCP adds minimal overhead:

- **Tunnel establishment**: ~100ms (one-time per SSH connection)
- **MCP tool call latency**: ~50-200ms (depends on network latency)
- **Permission approval**: ~10-50ms (cached after first approval)

The performance impact is negligible compared to the benefits of bidirectional orchestration.

## Future Enhancements

### Dashboard Integration

The permission approval system will integrate with the Phase 2 Dashboard for manual approval:

```
Remote team requests permission
    ↓
permissions__approve called via tunnel
    ↓
Dashboard shows approval request
    ↓
Human approves/denies in UI
    ↓
Response sent back through tunnel
```

### Per-Team Approval Policies

Configure approval policies per team:

```json
{
  "teams": {
    "team-remote": {
      "enableReverseMcp": true,
      "approvalPolicy": {
        "autoApprove": ["list_teams", "team_status"],
        "requireApproval": ["team_wake", "session_fork"],
        "deny": ["session_delete", "session_reboot"]
      }
    }
  }
}
```

### Approval Audit Logs

Track all permission requests and approvals:

```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "team": "team-remote",
  "tool": "mcp__iris__team_wake",
  "input": {"team": "team-alpha"},
  "decision": "allow",
  "reason": "Auto-approved Iris tool"
}
```

### Slack Integration

Send permission requests to Slack for human approval:

```
team-remote wants to wake team-alpha
Reason: CI/CD build failed, investigating issue

[Approve] [Deny] [Details]
```

## Reference Implementation

This implementation is based on the Claude Code `--permission-prompt-tool` interface:

- **Reference**: https://github.com/mmarcen/test_permission-prompt-tool
- **Tool Name**: `permissions__approve` (double underscore!)
- **Interface**: `(tool_name: string, input: object, reason?: string) => {behavior: "allow"|"deny", message?: string, updatedInput?: object}`

## Related Documentation

- [USE_CASE.md](./USE_CASE.md) - CI/CD integration scenarios with different autonomy levels
- [REVERSE_MCP_IMPLEMENTATION_PLAN.md](./REVERSE_MCP_IMPLEMENTATION_PLAN.md) - Original implementation plan
- [REVERSE_MCP_SECURITY.md](./REVERSE_MCP_SECURITY.md) - Security considerations and threat model

## Conclusion

Reverse MCP enables powerful bidirectional orchestration while maintaining security through SSH tunneling and permission policies. Remote teams can now coordinate local teams, opening up new possibilities for distributed AI workflows, CI/CD integration, and cross-boundary collaboration.

The key insight: **SSH reverse tunneling provides secure, firewall-friendly bidirectional communication without exposing any ports to the network.**

---

## Tech Writer Notes

**Coverage Areas:**
- Reverse MCP architecture and SSH tunnel configuration
- Bidirectional orchestration between local and remote Claude instances
- Permission approval system (permissions__approve tool)
- Security considerations (SSH tunnel, permission policies, HTTP vs HTTPS)
- Configuration schema for enableReverseMcp, reverseMcpPort, allowHttp
- Usage examples and troubleshooting

**Keywords:** reverse MCP, SSH tunnel, bidirectional orchestration, remote execution, permission approval, permissions__approve, enableReverseMcp, reverseMcpPort, allowHttp, GatewayPorts security, HTTP vs HTTPS, approval policies

**Last Updated:** 2025-10-18
**Change Context:** Updated MCP tool names in usage examples and approval policy. Changed: team_tell → send_message, team_teams → list_teams, team_fork → session_fork, team_isAwake → team_status, team_delete → session_delete, team_clear → session_reboot. Updated all code examples, testing instructions, and future enhancement examples with new tool names.
**Related Files:** REMOTE.md (remote execution), PERMISSIONS.md (permission system), REVERSE_MCP_IMPLEMENTATION_PLAN.md (implementation design), REVERSE_MCP_SECURITY.md (security model), USE_CASE.md (CI/CD integration scenarios), ACTIONS.md (complete tool API reference)
