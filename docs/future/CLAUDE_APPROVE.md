# Claude Permission Approval - Future Feature

## Overview

Allow Claude (or any orchestrating team) to programmatically approve permission requests for teams they have spawned/control via MCP actions.

## Flow

```
1. Claude wakes Team A
   → Session created: poolKey="claude->team-a", sessionId="abc123"

2. Team A performs work requiring permission (grantPermission: "ask")
   → Permission request created:
     {
       permissionId: "perm-001",
       sessionId: "abc123",
       teamName: "team-a",
       toolName: "mcp__iris__team_tell",
       ...
     }
   → Team A waits for approval (Promise pending)

3. Claude calls team_approve action
   → Input: { fromTeam: "claude" }
   → Approve action finds all pending permissions where:
     - sessionId maps to a session with fromTeam="claude"
   → Approves permission "perm-001"
   → Team A receives approval, continues execution
```

## Proposed MCP Actions

### 1. `team_approve`

**Purpose**: Approve all pending permission requests for sessions spawned by the calling team.

**Input**:
```typescript
{
  fromTeam: string;  // The orchestrating team (e.g., "claude")
  reason?: string;   // Optional reason for approval
}
```

**Logic**:
1. Get all pending permissions from `PendingPermissionsManager`
2. For each permission:
   - Look up `sessionId` in `SessionManager` to get `poolKey`
   - Parse `poolKey` to extract `fromTeam` (e.g., "claude->team-a" → "claude")
   - If `fromTeam` matches input `fromTeam`, approve the permission
3. Return count of approved permissions

**Output**:
```typescript
{
  approved: number;  // Count of permissions approved
  permissions: [     // List of approved permission IDs
    "perm-001",
    "perm-002"
  ]
}
```

**Security**:
- Teams can only approve permissions for sessions **they spawned**
- Cannot approve permissions for sessions spawned by other teams
- This maintains proper authorization hierarchy

### 2. `team_check_perm_requests`

**Purpose**: Check pending permission requests for sessions spawned by the calling team.

**Input**:
```typescript
{
  fromTeam: string;  // The orchestrating team
}
```

**Logic**:
1. Get all pending permissions from `PendingPermissionsManager`
2. For each permission:
   - Look up `sessionId` to get `fromTeam` from `poolKey`
   - If `fromTeam` matches, include in results
3. Return list of pending permissions

**Output**:
```typescript
{
  count: number;
  permissions: [
    {
      permissionId: "perm-001",
      sessionId: "abc123",
      teamName: "team-a",
      toolName: "mcp__iris__team_tell",
      toolInput: { ... },
      reason: "...",
      createdAt: "2025-01-15T10:30:00Z",
      timeRemaining: 25000  // milliseconds until timeout
    }
  ]
}
```

## Implementation Notes

### SessionId → FromTeam Lookup

Need to add helper method to `SessionManager`:

```typescript
getSessionFromTeam(sessionId: string): string | null {
  const session = this.getSession(sessionId);
  if (!session) return null;

  // Parse poolKey "fromTeam->toTeam" to extract fromTeam
  const [fromTeam] = session.poolKey.split('->');
  return fromTeam;
}
```

### PendingPermissionsManager Extensions

Add methods:

```typescript
/**
 * Get all pending permissions for sessions spawned by a specific team
 */
getPendingByFromTeam(fromTeam: string, sessionManager: SessionManager): PendingPermissionRequest[] {
  const results: PendingPermissionRequest[] = [];

  for (const [permissionId, entry] of this.pending) {
    const sessionFromTeam = sessionManager.getSessionFromTeam(entry.request.sessionId);
    if (sessionFromTeam === fromTeam) {
      results.push(entry.request);
    }
  }

  return results;
}

/**
 * Approve all pending permissions for sessions spawned by a specific team
 */
approveAllByFromTeam(fromTeam: string, sessionManager: SessionManager, reason?: string): string[] {
  const approved: string[] = [];

  for (const [permissionId, entry] of this.pending) {
    const sessionFromTeam = sessionManager.getSessionFromTeam(entry.request.sessionId);
    if (sessionFromTeam === fromTeam) {
      this.resolvePendingPermission(permissionId, true, reason);
      approved.push(permissionId);
    }
  }

  return approved;
}
```

## Use Cases

### 1. Autonomous Team Coordination

Claude orchestrates multiple teams and programmatically approves their cross-team actions:

```typescript
// Claude wakes frontend and backend teams
await team_wake({ team: "frontend", fromTeam: "claude" });
await team_wake({ team: "backend", fromTeam: "claude" });

// Claude tells frontend to query backend (requires permission)
await team_tell({
  toTeam: "frontend",
  fromTeam: "claude",
  message: "Query the backend team for user data"
});

// Frontend tries to tell backend (grantPermission: "ask")
// Permission request created, frontend waits...

// Claude checks and approves
const pending = await team_check_perm_requests({ fromTeam: "claude" });
if (pending.count > 0) {
  await team_approve({
    fromTeam: "claude",
    reason: "Approved for coordinated data query"
  });
}

// Frontend receives approval, continues work
```

### 2. Conditional Approval

Claude can inspect permission requests before approving:

```typescript
const pending = await team_check_perm_requests({ fromTeam: "claude" });

for (const perm of pending.permissions) {
  if (perm.toolName === "mcp__iris__team_tell" &&
      perm.toolInput.toTeam === "production") {
    // Risky operation - deny or escalate to dashboard
    continue;
  }

  // Safe operation - approve
  await team_approve({
    fromTeam: "claude",
    reason: `Approved ${perm.toolName} for ${perm.teamName}`
  });
}
```

### 3. Dashboard Integration

Dashboard could show permissions organized by orchestrator:

```
Pending Permissions (grouped by orchestrator):

claude (2 pending)
  ├─ team-frontend → team-backend (team_tell)
  └─ team-worker → file-write (write_file)

user-alice (1 pending)
  └─ team-production → deploy (deploy_app)
```

## Future Extensions

1. **Granular Approval**: Allow approving specific permission IDs instead of all
2. **Auto-Approval Rules**: Configure patterns for automatic approval
3. **Approval Delegation**: Allow teams to delegate approval authority
4. **Audit Trail**: Log all approval decisions for compliance
5. **Batch Operations**: Approve/deny multiple permissions in one call

## Implementation Priority

- **Phase 1**: Document design (this file) ✓
- **Phase 2**: Implement `team_check_perm_requests` for visibility
- **Phase 3**: Implement `team_approve` for programmatic approval
- **Phase 4**: Add granular filters and batch operations
- **Phase 5**: Integration with Intelligence Layer for autonomous approval

## Related Files

- `src/permissions/pending-manager.ts` - Permission tracking
- `src/session/session-manager.ts` - Session → fromTeam lookup
- `src/actions/` - MCP action implementations
- `src/iris.ts` - Permission request handling
