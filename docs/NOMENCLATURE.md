# Iris MCP Nomenclature & Architecture

## Core Concepts

### Session
An Anthropic Claude Code conversation context. Sessions are created per requesting team and destination team pair.

**Key Points:**
- Sessions persist across multiple interactions
- Format: `fromTeam->toTeam` or `null->toTeam` for external/testing
- SessionManager initializes with `null->teamName` for all configured teams (testing/bootstrap purposes)
- In production, all `tell()` commands should include the requesting team name

### Instance
A specific execution context of a session, tied to a requesting team and destination team pair.

**Lifecycle:**
1. First call `wake(team-req, team-dest)` to create the session instance
2. Subsequent `tell()` commands use this specific req/dest session
3. Provides isolated, independent communication channels between team pairs

**Caching:**
- Each instance maintains its own output cache (stdout + stderr)
- Cache persists until explicitly cleared
- Cache cleared by default on: `wake()`, `tell()`, `sleep()`, `wakeAll()`

### Process
The actual Claude Code subprocess (`claude --headless`) managed by the pool.

**Management:**
- Pooled for performance (52% improvement over cold starts)
- LRU eviction when pool limit reached
- Health checks every 30 seconds

## Future Enhancements (Backlog)

### Session Forking (Not Implemented)
**Concept:** Improve performance by forking from base sessions

**Proposed Implementation:**
1. SessionManager initializes with `null->teamName` base sessions for all teams
2. New instances fork from base session for faster startup
3. Challenge: Getting new session ID from forked session

**Potential Solution Using Hooks:**
```json
{
  "hooks": {
    "Start": "echo $CLAUDE_SESSION_ID > /tmp/current-session-id.txt"
  }
}
```
This would allow capturing the forked session ID for subsequent operations.

### Message Queueing
**Question:** Does Claude Code automatically queue messages when busy, or do we need to track completion?

**Current Behavior:**
- Messages sent while Claude is processing may queue automatically
- Need to verify Claude Code's internal queueing behavior
- Consider tracking "tell in progress" state in pool-manager

## MCP Commands

### Core Communication
- **`team_tell`** - Send message to a team (clears cache by default)
- **`team_wake`** - Activate team process (clears cache by default)
- **`team_sleep`** - Deactivate team process (clears cache by default)
- **`team_wake_all`** - Activate all teams (wrapper around wake, clears cache)

### Status & Monitoring
- **`team_isAwake`** - Check if team is active
- **`team_report`** - View current output cache without clearing

## Cache Behavior

### Default Clear Operations
These operations clear the output cache by default (configurable via `clearCache` flag):
- `wake()`
- `tell()`
- `sleep()`
- `wakeAll()`

### Cache Contents
- **stdout**: Standard output from Claude process
- **stderr**: Error output from Claude process
- **Format**: Raw text (no structured data)
- **Persistence**: In-memory only, cleared on specified operations

### Cache Access
- **`report()`**: Returns all cached output since last clear
- No read markers - cache exists until next clear operation
- Instance-specific - each team pair maintains separate cache
