# Iris MCP API Reference

Complete reference for all MCP tools provided by Iris MCP Server for cross-project Claude Code coordination.

## Overview

Iris MCP Server enables Claude Code instances across different project directories to communicate and coordinate via standardized MCP tools. Each tool is designed to follow natural language patterns and provide clear, descriptive functionality.

## Tool Categories

### Communication Tools
Tools for sending messages between teams.

### Session Management Tools
Tools for managing Claude sessions (fork, reboot, delete, etc.).

### Team Management Tools
Tools for managing team processes (wake, sleep, status).

### System/Utility Tools
Tools for querying system information (logs, date, teams list).

---

## Communication Tools

### `send_message`

Send a message to a team and wait for response. Use this for communication that requires acknowledgment or when you need to wait for the team to complete a task.

**Parameters:**
- `toTeam` (string, required): Name of the team to send message to
- `message` (string, required): The message content to send
- `fromTeam` (string, required): Name of the team sending the message
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)
  - `0` = wait indefinitely
  - `-1` = async/non-blocking (returns immediately)
- `persist` (boolean, optional): Use persistent SQLite queue (default: false)
- `ttlDays` (number, optional): TTL in days for persistent messages (default: 30)

**Example:**
```json
{
  "toTeam": "team-backend",
  "message": "Please implement the new authentication endpoint",
  "fromTeam": "team-frontend",
  "timeout": 60000
}
```

**Use Cases:**
- Requesting work from another team
- Asking questions that require detailed responses
- Coordinating multi-step workflows

---

### `ask_message`

Ask a question to a team and wait for their response. This is a semantic alias for `send_message` that makes it clear you're expecting an answer.

**Parameters:**
Same as `send_message`.

**Example:**
```json
{
  "toTeam": "team-database",
  "message": "What's the schema for the users table?",
  "fromTeam": "team-api"
}
```

**Use Cases:**
- Asking questions about code or architecture
- Requesting explanations
- Seeking guidance or recommendations

**Note:** This is functionally identical to `send_message`, but provides semantic clarity for question-asking scenarios.

---

### `quick_message`

Quickly send a message to a team without waiting (async/fire-and-forget). Returns immediately after queuing the message.

**Parameters:**
- `toTeam` (string, required): Name of the team to send message to
- `message` (string, required): The message content to send
- `fromTeam` (string, required): Name of the team sending the message

**Example:**
```json
{
  "toTeam": "team-frontend",
  "message": "FYI: Database migration completed successfully",
  "fromTeam": "team-backend"
}
```

**Use Cases:**
- Sending notifications or updates
- Broadcasting information that doesn't require acknowledgment
- Phrases like "quickly tell team-X to..." or "notify team-Y that..."

**Note:** This automatically sets `timeout: -1` for async behavior.

---

## Session Management Tools

### `session_fork`

Fork a session into a new terminal window for manual interaction. Launches a separate terminal with `claude --resume --fork-session` so you can interact with the session directly.

**Parameters:**
- `toTeam` (string, required): Name of the team whose session to fork
- `fromTeam` (string, required): Name of the team requesting the fork

**Example:**
```json
{
  "toTeam": "team-backend",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Manual debugging of a team's session
- Direct interaction with a team's Claude instance
- Inspecting session state in a terminal

**Requirements:**
- Fork script configured at `~/.iris/scripts/spawn.sh` (or `.ps1` on Windows)
- Works for both local and remote teams

---

### `session_reboot`

Reboot a session to start fresh with a clean slate. Creates a brand new session with new UUID, terminating the existing process and deleting old session data.

**Parameters:**
- `toTeam` (string, required): Name of the team whose session to reboot
- `fromTeam` (string, required): Name of the team requesting the reboot

**Example:**
```json
{
  "toTeam": "team-frontend",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Clearing conversation history when context becomes too large
- Starting fresh after errors or confusion
- Resetting stuck sessions

**Warning:** This permanently deletes the old session data.

---

### `session_delete`

Delete a session permanently. Terminates the process and removes the session data completely without creating a replacement.

**Parameters:**
- `toTeam` (string, required): Name of the team whose session to delete
- `fromTeam` (string, required): Name of the team requesting the delete

**Example:**
```json
{
  "toTeam": "team-testing",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Removing sessions that are no longer needed
- Cleaning up after temporary teams
- Freeing resources

**Note:** Unlike `session_reboot`, this does NOT create a new session.

---

### `session_report`

View the conversation history for a session. Returns complete conversation cache including all messages, responses, and protocol messages from Claude.

**Parameters:**
- `team` (string, required): Name of the team whose conversation to view
- `fromTeam` (string, required): Name of the team requesting the report

**Example:**
```json
{
  "team": "team-backend",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Reviewing what you've asked a team to do
- Debugging communication issues
- Auditing team interactions

**Returns:** Array of cache entries with timestamps, messages, and status.

---

### `session_cancel`

Cancel a running session operation. Attempts to interrupt a long-running Claude operation by sending ESC to stdin.

**Parameters:**
- `team` (string, required): Name of the team whose operation to cancel
- `fromTeam` (string, required): Name of the team requesting the cancel

**Example:**
```json
{
  "team": "team-backend",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Stopping long-running or stuck operations
- Canceling tasks that are taking too long

**Note:** May not work in all cases depending on Claude headless mode support.

---

## Team Management Tools

### `team_wake`

Wake up a team by ensuring its process is active in the pool. Returns immediately if team is already awake.

**Parameters:**
- `team` (string, required): Name of the team to wake up
- `fromTeam` (string, required): Name of the calling team (creates session-specific process)

**Example:**
```json
{
  "team": "team-backend",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Starting a team before sending messages
- Ensuring a team is ready for work
- Pre-warming team processes

**Note:** The `fromTeam` parameter creates a dedicated process for the team pair (e.g., `team-iris -> team-backend`) to maintain conversation isolation.

---

### `team_launch`

Launch a team by ensuring its process is active. This is a convenience alias for `team_wake` that matches natural language patterns.

**Parameters:**
- `team` (string, required): Name of the team to launch
- `fromTeam` (string, required): Name of the calling team (creates session-specific process)

**Example:**
```json
{
  "team": "team-frontend",
  "fromTeam": "team-iris"
}
```

**Use Cases:**
- Natural language phrases like "launch team-X" or "start team-Y"
- Same functionality as `team_wake`
- Semantic clarity for starting teams

**Note:** This is functionally identical to `team_wake`, but provides semantic clarity for launch/start scenarios.

---

### `team_sleep`

Put a team to sleep by removing its process from the pool. Terminates the team process and frees resources.

**Parameters:**
- `team` (string, required): Name of the team to put to sleep
- `fromTeam` (string, required): Name of the team requesting the sleep
- `force` (boolean, optional): Force termination even if process is busy (default: false)

**Example:**
```json
{
  "team": "team-testing",
  "fromTeam": "team-iris",
  "force": false
}
```

**Use Cases:**
- Freeing resources when a team is no longer needed
- Cleaning up idle processes
- Managing pool size limits

---

### `team_wake_all`

Wake up all configured teams sequentially. Sounds the air-raid siren and brings all teams online.

**Parameters:**
- `fromTeam` (string, required): Name of the team requesting the wake-all
- `parallel` (boolean, optional): Wake teams in parallel (NOT RECOMMENDED - unstable, default: false)

**Example:**
```json
{
  "fromTeam": "team-iris",
  "parallel": false
}
```

**Use Cases:**
- Initializing all teams at project startup
- Warming up the entire team pool

**Warning:** Parallel mode is unstable and can cause timeouts. Use sequential mode (default).

---

### `team_status`

Get the status of teams (awake/active or asleep/inactive). Returns process details for active teams including PID, status, and session information.

**Parameters:**
- `fromTeam` (string, required): Name of the calling team (required to identify sessions)
- `team` (string, optional): Check status for a specific team only
- `includeNotifications` (boolean, optional): Include notification queue statistics (default: true)

**Example:**
```json
{
  "fromTeam": "team-iris",
  "team": "team-backend",
  "includeNotifications": true
}
```

**Use Cases:**
- Checking if a team is available
- Monitoring team process health
- Viewing notification queue stats

**Returns:** Object with team status, process details, and optional notification stats.

---

## System/Utility Tools

### `list_teams`

List all configured teams. Returns team names with configuration details including path, description, color, and settings.

**Parameters:**
None.

**Example:**
```json
{}
```

**Use Cases:**
- Discovering available teams
- Viewing team configurations
- Programmatically accessing team metadata

**Returns:** Array of team objects with name, path, description, color, and config settings.

---

### `get_logs`

Query in-memory logs from the Iris MCP server. Returns logs since a specified timestamp with optional filtering by level and format.

**Parameters:**
- `logs_since` (number, optional): Timestamp in milliseconds to get logs since
- `storeName` (string, optional): Memory store name to query (default: 'iris-mcp')
- `format` (string, optional): Return format - 'raw' (Pino JSON) or 'parsed' (human-readable, default)
- `level` (string or array, optional): Filter by log level(s) - 'error', ['error', 'warn'], etc.
- `getAllStores` (boolean, optional): If true, returns list of available memory stores

**Example:**
```json
{
  "logs_since": 1704067200000,
  "level": ["error", "warn"],
  "format": "parsed"
}
```

**Use Cases:**
- Debugging server issues
- Monitoring server activity
- Auditing team communication

**Available Log Levels:** trace, debug, info, warn, error, fatal

---

### `get_date`

Get the current system date and time. Returns timestamp in multiple formats.

**Parameters:**
None.

**Example:**
```json
{}
```

**Use Cases:**
- Timestamp synchronization across teams
- Time-based logging
- Scheduling and timing operations

**Returns:**
- ISO 8601 format
- UTC string
- Unix timestamp
- Detailed components (year, month, day, hour, minute, second, etc.)

---

## Internal Tools

### `permissions__approve`

**Internal Tool** - Permission approval handler for Claude Code's `--permission-prompt-tool` feature. Auto-approves all Iris MCP tools and denies others.

**Note:** This is an internal tool used by the permission system. You typically don't call this directly.

---

## Usage Patterns

### Natural Language Mapping

Iris MCP tools are designed to match natural language patterns:

| Natural Phrase | Recommended Tool |
|----------------|------------------|
| "Ask team-X about..." | `ask_message` |
| "Tell team-X to..." | `send_message` |
| "Quickly notify team-X..." | `quick_message` |
| "Wake up team-X" | `team_wake` |
| "Launch team-X" | `team_launch` |
| "Start team-X" | `team_launch` |
| "Check if team-X is active" | `team_status` |
| "Reboot team-X's session" | `session_reboot` |
| "Show me what I asked team-X" | `session_report` |

### Best Practices

1. **Use `fromTeam` consistently**: Always identify your team for proper session isolation
2. **Prefer `ask_message` for questions**: Makes intent clear and improves readability
3. **Use `quick_message` for notifications**: Don't block on informational messages
4. **Wake teams before messaging**: Ensure teams are active before sending important messages
5. **Check status regularly**: Use `team_status` to monitor team health
6. **Clean up sessions**: Use `session_delete` or `team_sleep` to free resources when done

### Error Handling

All tools return JSON responses with error information when operations fail:

```json
{
  "error": "Team not found: team-nonexistent",
  "tool": "send_message"
}
```

Common error scenarios:
- Team not configured
- Session not found
- Process spawn failures
- Timeout exceeded
- Permission denied

---

## Configuration

Team configuration is managed via `config.yaml` (see [CONFIG.md](CONFIG.md) for full details).

**Example Team Configuration:**
```yaml
teams:
  team-backend:
    path: /path/to/backend/project
    description: "Backend API team"
    color: "#FF6B9D"
    idleTimeout: 300000
    sessionMcpEnabled: true
    sessionMcpPath: ".claude/iris/mcp"
```

---

## Version History

- **v1.0.0** (2025-01): Initial MCP API release with refactored tool names
  - Renamed tools for clarity and natural language mapping
  - Added `ask_message` convenience tool
  - Organized tools into logical categories

---

## See Also

- [CONFIG.md](CONFIG.md) - Configuration reference
- [CLAUDE.md](../CLAUDE.md) - Development guide
- [README.md](../README.md) - Project overview
