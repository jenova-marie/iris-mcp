# Launch Command Debugging - Implementation Plan

## Objective

Store and display the full launch command used to spawn each Claude process for debugging purposes.

## Architecture Overview

```
Transport Layer (spawn process)
  ├─> Capture full command string
  └─> Pass to SessionManager.createSession()

SessionManager
  ├─> Store in Session object (in-memory)
  └─> Store in sessions table (SQLite)

DashboardStateBridge
  ├─> Read from SessionManager
  └─> Expose via REST API or WebSocket

ProcessMonitor UI
  └─> Display command in expandable section
```

## Phase 1: Data Model Changes

### 1.1 Session Type (`src/session/types.ts`)

Add `launchCommand` field:

```typescript
export interface Session {
  sessionId: string;
  poolKey: string;
  fromTeam: string;
  toTeam: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  launchCommand?: string; // NEW: Full command used to spawn this session
}
```

### 1.2 Database Schema (`src/session/session-manager.ts`)

Add `launch_command` column:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  pool_key TEXT NOT NULL,
  from_team TEXT NOT NULL,
  to_team TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  launch_command TEXT,  -- NEW: Store launch command for debugging
  UNIQUE(pool_key)
)
```

Migration strategy:
- Use `ALTER TABLE sessions ADD COLUMN launch_command TEXT` if table exists
- Or drop/recreate table (sessions are ephemeral anyway)

### 1.3 SessionManager Methods

Update `createSession()` signature:

```typescript
async createSession(
  sessionId: string,
  poolKey: string,
  fromTeam: string,
  toTeam: string,
  launchCommand?: string,  // NEW parameter
): Promise<Session>
```

Update `getSession()` to return `launchCommand`.

## Phase 2: Capture Launch Command

### 2.1 LocalTransport (`src/transport/local-transport.ts`)

**Current code** (approximate):
```typescript
const args = [
  '--headless',
  '--skip-update-check',
  // ... more args
];

if (this.irisConfig.skipPermissions) {
  args.push('--dangerously-skip-permissions');
}

// Spawn process
this.process = spawn('claude', args, { ... });
```

**New code**:
```typescript
const args = [ /* ... build args ... */ ];

// Capture full command for debugging
const fullCommand = `claude ${args.map(arg =>
  arg.includes(' ') ? `"${arg}"` : arg
).join(' ')}`;

// Store command before spawning
this.launchCommand = fullCommand;

// Spawn process
this.process = spawn('claude', args, { ... });
```

Then pass to SessionManager:
```typescript
await this.sessionManager.createSession(
  this.sessionId,
  this.poolKey,
  this.fromTeam,
  this.toTeam,
  this.launchCommand,  // NEW
);
```

### 2.2 SSH2Transport (`src/transport/ssh2-transport.ts`)

Similar approach, but capture the full SSH + claude command:

```typescript
const fullCommand = `ssh ${sshHost} "${claudeCommand}"`;
this.launchCommand = fullCommand;

// Later when creating session
await this.sessionManager.createSession(
  this.sessionId,
  this.poolKey,
  this.fromTeam,
  this.toTeam,
  this.launchCommand,
);
```

### 2.3 SSHTransport (`src/transport/ssh-transport.ts`)

Same pattern as SSH2Transport.

### 2.4 Transport Interface (`src/transport/transport.interface.ts`)

Add optional field to Transport interface:

```typescript
export interface Transport {
  // ... existing fields
  launchCommand?: string; // Full command used to spawn this process
}
```

## Phase 3: API Exposure

### 3.1 DashboardStateBridge (`src/dashboard/server/state-bridge.ts`)

Update `getActiveSessions()` to include launch command:

```typescript
getActiveSessions(): SessionProcessInfo[] {
  const sessions = this.sessionManager.getAllSessions();

  return sessions.map((session) => {
    const process = this.pool.getProcessBySessionId(session.sessionId);

    return {
      sessionId: session.sessionId,
      poolKey: session.poolKey,
      fromTeam: session.fromTeam,
      toTeam: session.toTeam,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      messageCount: session.messageCount,
      launchCommand: session.launchCommand, // NEW
      process: process ? {
        status: process.getStatus(),
        pid: process.getPid(),
        // ... rest of process info
      } : null,
    };
  });
}
```

Update `SessionProcessInfo` type:

```typescript
export interface SessionProcessInfo {
  sessionId: string;
  poolKey: string;
  fromTeam: string;
  toTeam: string;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  launchCommand?: string;  // NEW
  process: {
    status: string;
    pid?: number;
    // ... rest
  } | null;
}
```

### 3.2 REST API

Existing `/api/processes` endpoint should automatically include launch command once `SessionProcessInfo` is updated.

## Phase 4: UI Display

### 4.1 ProcessMonitor Component (`src/dashboard/client/src/pages/ProcessMonitor.tsx`)

Add expandable section to show launch command:

**Option A: Accordion/Collapsible**
```tsx
{session.launchCommand && (
  <div className="mt-2 border-t pt-2">
    <button
      onClick={() => toggleCommand(session.sessionId)}
      className="text-sm text-gray-600 hover:text-gray-900"
    >
      {showCommand[session.sessionId] ? '▼' : '▶'} Launch Command
    </button>

    {showCommand[session.sessionId] && (
      <pre className="mt-2 p-2 bg-gray-900 text-green-400 rounded text-xs overflow-x-auto">
        {session.launchCommand}
      </pre>
    )}
  </div>
)}
```

**Option B: Modal on Click**
```tsx
<button onClick={() => showCommandModal(session)}>
  View Launch Command
</button>

{modalSession && (
  <Modal>
    <h3>Launch Command</h3>
    <pre>{modalSession.launchCommand}</pre>
    <button onClick={copyToClipboard}>Copy</button>
  </Modal>
)}
```

**Option C: Tooltip on Hover**
```tsx
<div title={session.launchCommand}>
  <InfoIcon /> Hover for command
</div>
```

### 4.2 Features to Include

1. **Syntax Highlighting**: Use monospace font with green text on dark background (terminal-like)
2. **Copy Button**: One-click copy to clipboard
3. **Word Wrap Toggle**: Long commands can be hard to read
4. **Highlight Sensitive Data**: Warn if command contains potential secrets (API keys, tokens)

### 4.3 UI Mockup

```
┌─────────────────────────────────────────────────┐
│ Session: abc-123 (claude -> team-alpha)        │
│ Status: Active | PID: 12345 | Messages: 42     │
│                                                 │
│ ▶ Launch Command                         [Copy]│
└─────────────────────────────────────────────────┘

(When expanded:)
┌─────────────────────────────────────────────────┐
│ Session: abc-123 (claude -> team-alpha)        │
│ Status: Active | PID: 12345 | Messages: 42     │
│                                                 │
│ ▼ Launch Command                         [Copy]│
│ ┌─────────────────────────────────────────────┐│
│ │claude --headless --skip-update-check \      ││
│ │  --append-system-prompt "You are team-alpha"││
│ │  --mcp-config '{"mcpServers":{...}}'        ││
│ └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

## Implementation Order

1. ✅ **Plan & Design** (this document)
2. **Phase 1**: Update data model
   - [ ] Add `launchCommand` to Session type
   - [ ] Migrate database schema
   - [ ] Update SessionManager
3. **Phase 2**: Capture commands
   - [ ] LocalTransport
   - [ ] SSH2Transport
   - [ ] SSHTransport
4. **Phase 3**: Expose via API
   - [ ] Update DashboardStateBridge
   - [ ] Verify REST endpoint response
5. **Phase 4**: Display in UI
   - [ ] Update ProcessMonitor component
   - [ ] Add copy-to-clipboard
   - [ ] Test with real sessions

## Testing Strategy

### Unit Tests
- SessionManager: Verify launch command stored/retrieved correctly
- DashboardStateBridge: Verify launch command included in API response

### Integration Tests
1. Spawn a local team → verify command captured
2. Spawn a remote team (SSH) → verify full SSH command captured
3. Open ProcessMonitor → verify command displayed
4. Click copy button → verify command copied to clipboard

### Edge Cases
- Command with quotes/special characters
- Very long commands (>1000 chars)
- Missing launch command (legacy sessions)
- Multi-line commands (SSH with newlines)

## Security Considerations

**Potential Issues**:
1. Commands may contain sensitive data (API keys, tokens, passwords)
2. Commands may reveal internal network topology (SSH hostnames)
3. MCP config JSON may contain credentials

**Mitigations**:
1. **Mark as sensitive**: Add warning icon if command contains patterns like `--api-key`, `token`, `password`
2. **Redaction option**: Config flag to redact sensitive parts (e.g., replace with `***`)
3. **Access control**: Only show launch commands to authorized dashboard users (future)

**Example Redaction**:
```typescript
function redactSensitiveData(command: string): string {
  return command
    .replace(/--api-key[= ]\S+/g, '--api-key=***')
    .replace(/password[= ]\S+/gi, 'password=***')
    .replace(/token[= ]\S+/gi, 'token=***');
}
```

## Future Enhancements

1. **Command History**: Show all historical commands for a session (if resumed)
2. **Replay Command**: Button to copy command and instructions for manual replay
3. **Diff Commands**: Compare launch commands between sessions to debug config differences
4. **Command Templates**: Extract common patterns and suggest improvements
5. **Performance Metrics**: Correlate launch command complexity with spawn time

## Related Files

- `src/session/types.ts` - Session type definition
- `src/session/session-manager.ts` - Session persistence
- `src/transport/*.ts` - Command capture (LocalTransport, SSH2Transport, SSHTransport)
- `src/dashboard/server/state-bridge.ts` - API exposure
- `src/dashboard/client/src/pages/ProcessMonitor.tsx` - UI display

## Questions to Answer Before Implementation

1. **Database Migration**: Drop/recreate sessions table or use ALTER TABLE?
   - **Decision**: Use ALTER TABLE with IF NOT EXISTS check (graceful upgrade)

2. **Command Format**: Store as single string or array of args?
   - **Decision**: Single string (easier to copy/paste for debugging)

3. **Redaction**: Implement now or later?
   - **Decision**: Later (Phase 2 feature)

4. **UI Position**: Where in ProcessMonitor to show command?
   - **Decision**: Expandable accordion below session info (Option A)
