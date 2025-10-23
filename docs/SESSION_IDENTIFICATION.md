# Team Identification via SessionId

## The Elegant Solution

The **sessionId already uniquely identifies which team is requesting permission**.

## Core Insight

**Only autonomous spawned agents (toTeam) ever call the `permissions__approve` tool.**

The user at the console (fromTeam) has a keyboard - they approve permissions interactively. They will NEVER call `mcp__iris__permissions__approve`.

## The Chain of Sessions

Let's trace a realistic scenario:

```
1. Console user (jenova) runs claude
   → The user is there to approve claude

2. Console claude wakes team-alpha
   → Creates session: claude->team-alpha (sessionId: 123)
   → team-alpha gets MCP config: http://localhost:1615/mcp/123

3. team-alpha needs permission to sudo rm -rf /
   → Calls permissions__approve via /mcp/123
   → We KNOW this is team-alpha (toTeam from session 123)
   → Why? Console claude would never call this endpoint!

4. team-alpha wakes team-beta
   → Creates session: team-alpha->team-beta (sessionId: 456)
   → team-beta gets MCP config: http://localhost:1615/mcp/456
   → User is notified of request approval via dashboard or other

5. team-beta needs permission (because alpha said to sudo rm -rf /)
   → Calls permissions__approve via /mcp/456
   → We KNOW this is team-beta (toTeam from session 456)
   → Why? team-alpha would use /mcp/123 for its own perms!
   → User is notified of request approval via dashboard or other

6. team-beta wakes team-gamma
   → Creates session: team-beta->team-gamma (sessionId: 789)
   → team-gamma gets MCP config: http://localhost:1615/mcp/789

7. team-gamma needs permission to sudo kill -9 <team-alpha-pid>
   → Calls permissions__approve via /mcp/789
   → We KNOW this is team-gamma (toTeam from session 789)
```

## The Pattern

```
Session Creation:
  fromTeam -> toTeam (sessionId: X)
  └─> toTeam gets MCP config with /mcp/X

Permission Request:
  Request arrives at /mcp/X
  └─> ALWAYS from toTeam (the spawned agent)
  └─> NEVER from fromTeam (they have interactive approval)
```

## Why This Works

1. **SessionId = Unique Session**: Each Claude session has a unique ID
2. **Session = Team Pair**: SessionId maps to fromTeam->toTeam relationship
3. **Only Agents Need Permission**: Only the spawned agent (toTeam) calls permissions__approve
4. **MCP Config Per Session**: Each spawned agent gets unique /mcp/:sessionId URL
5. **Natural Routing**: Request URL tells us exactly which team is asking

## Implementation

### Route Pattern
```
/mcp/:sessionId
```

Not `/mcp/:teamId` or `/mcp/:uuid` - just the sessionId we already have!

### Lookup Strategy
```typescript
// Permission request arrives at /mcp/abc-123
const sessionId = req.params.sessionId; // "abc-123"

// Look up session in ProcessPool
const process = processPool.getProcessBySessionId(sessionId);

// Get team context
const requestingTeam = process.toTeam; // This is who's asking!
const teamConfig = configManager.getTeam(requestingTeam);

// Check permission config
switch (teamConfig.grantPermission) {
  case 'yes': return { behavior: 'allow' };
  case 'no': return { behavior: 'deny' };
  case 'ask': /* show dashboard popup */
  case 'forward': /* send to Slack/webhook */
}
```

### MCP Config Injection

**CRITICAL UPDATE (2025-10-23): Session-Specific Server Naming**

To avoid conflicts with global `~/.claude.json` MCP configurations, session-specific MCP configs now use a **unique server name** per session:

```typescript
// Session-specific server name prevents conflicts with global "iris" config
const serverName = `iris-${sessionId}`;

const mcpConfig = {
  mcpServers: {
    [serverName]: {  // e.g., "iris-abc-123-def-456"
      type: "http",
      url: `http://localhost:1615/mcp/${this.sessionId}`
    }
  }
};
```

**Why This Matters:**

Without unique naming, local teams had **two simultaneous connections** to iris-mcp:
1. Global connection via `~/.claude.json` (server name: `"iris"`) - **NO session context**
2. Session-specific connection via `--mcp-config` (server name: `"iris"`) - **HAS session context**

When Claude called tools, it used the global connection by default, causing `permissions__approve` to fail with "No session context" errors.

**The Fix:**

By naming the session-specific server `iris-${sessionId}`, we create separate namespaces:
- Regular tools use global `mcp__iris__*` (no session needed)
- Permission tool uses session-specific `mcp__iris-${sessionId}__permissions__approve` (has session context)

**Implementation:**

**ClaudeCommandBuilder** (`src/utils/command-builder.ts:199-224`):
```typescript
static buildMcpConfig(irisConfig: IrisConfig, sessionId: string): McpConfig {
  const mcpUrl = `${protocol}://localhost:${mcpPort}/mcp/${sessionId}`;

  // Use session-specific server name to avoid global config conflicts
  const serverName = `iris-${sessionId}`;

  return {
    mcpServers: {
      [serverName]: {
        type: "http",
        url: mcpUrl,
      },
    },
  };
}
```

**Permission Tool Flag** (`src/utils/command-builder.ts:128-154`):
```typescript
// Match the session-specific server name
const permissionTool = `mcp__iris-${sessionId}__permissions__approve`;

if (grantPermission === "yes" || grantPermission === "ask") {
  args.push("--permission-prompt-tool", permissionTool);
}
```

**Benefits:**
- ✅ No naming conflicts between global and session configs
- ✅ Permission tool gets session context via dedicated connection
- ✅ Regular tools continue using global connection (efficient)
- ✅ No need for `--strict-mcp-config` flag
- ✅ Works for both local and remote teams

## What We Don't Need

- ❌ `mcp-team-registry.ts` - Delete it!
- ❌ UUID generation - Use sessionId!
- ❌ registerTeam() / unregisterTeam() - ProcessPool already manages!
- ❌ Dependency injection of registry - Use ProcessPool!
- ❌ Path mapping - Direct sessionId lookup!

## Benefits

1. **Simpler**: One less abstraction layer
2. **Faster**: Direct ProcessPool lookup (already in-memory)
3. **Consistent**: SessionId is already the source of truth
4. **Natural**: Leverages existing session lifecycle management
5. **Obvious**: The URL itself tells you which session is asking

## Security Note

The sessionId is a UUID, so it's unguessable. Even if an attacker knew the endpoint pattern, they can't forge permission requests for other teams without knowing their sessionId.

## Edge Cases

**Q: What if a session terminates but requests still arrive?**
A: ProcessPool lookup returns null → return 404 "Session not found"

**Q: What if the same team is spawned multiple times?**
A: Each spawn gets a unique sessionId → separate /mcp/:sessionId endpoints → no collision

**Q: What about session resumption (--resume)?**
A: Same sessionId = same team context = same permissions → works perfectly

## Summary

**The sessionId is the team identifier.**

When a permission request arrives at `/mcp/:sessionId`, we look up that session in the ProcessPool to find the `toTeam` (the agent requesting permission). The `toTeam` is ALWAYS the one asking for permission because only autonomous agents call `permissions__approve` - users have keyboards.

This is beautiful, simple, and requires no additional infrastructure beyond what we already have.

---

## Changelog

### 2025-10-23: Session-Specific Server Naming

**Problem Discovered:** Local teams experienced "No session context" errors when calling `permissions__approve`.

**Root Cause:** MCP server name collision
- Global `~/.claude.json` config: server name `"iris"`
- Session-specific `--mcp-config`: server name `"iris"` (same!)
- Claude defaulted to global connection → no session context in URL

**Solution Implemented:** Unique server names per session
- Global config remains: `"iris"` → tools use `mcp__iris__*`
- Session configs now use: `"iris-${sessionId}"` → permission tool uses `mcp__iris-${sessionId}__permissions__approve`

**Files Modified:**
- `src/utils/command-builder.ts:199-224` - buildMcpConfig() generates unique server name
- `src/utils/command-builder.ts:128-154` - Permission tool flag matches session-specific name

**Result:**
- ✅ Dual-connection architecture works perfectly
- ✅ Regular tools use efficient global connection
- ✅ Permission tool gets session context via dedicated connection
- ✅ No conflicts, no "No session context" errors

**Credit:** Human insight identified that only `permissions__approve` requires session context, enabling this elegant namespace-based solution instead of heavy-handed `--strict-mcp-config` approach.
