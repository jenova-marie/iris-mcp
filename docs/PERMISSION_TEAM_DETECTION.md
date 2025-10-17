# Permission Team Detection via SessionId

## The Elegant Solution

We don't need a separate team registry. The **sessionId already uniquely identifies which team is requesting permission**.

## Core Insight

**Only autonomous agents (toTeam) ever call the `permissions__approve` tool.**

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

**LocalTransport** (for local teams):
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

**SSH2Transport** (for remote teams):
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
