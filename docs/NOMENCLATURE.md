# Iris MCP Nomenclature & Architecture

## Core Concepts

### Session
An Anthropic Claude Code conversation context stored as a `.jsonl` file. Sessions are created per `(fromTeam, toTeam)` pair.

**Key Points:**
- Sessions persist across multiple interactions and server restarts
- Format: `fromTeam->toTeam` (e.g., `iris->alpha`, `alpha->beta`)
- **ALL sessions require both fromTeam and toTeam** (no null or "team-beta" sessions)
- SessionManager tracks session metadata in SQLite database (`data/sessions.db`)
- Session files stored at `~/.claude/projects/{escaped-path}/{sessionId}.jsonl`
- Each team pair has exactly ONE persistent session

### Pool Key
A unique identifier for a process in the pool, derived from the session's team pair.

**Format:** `fromTeam->toTeam` (e.g., `iris->alpha`, `frontend->backend`)

**Key Points:**
- Pool key = session identifier for process management
- One process per unique `(fromTeam, toTeam)` pair in the pool
- Process resumes its specific session via `--resume {sessionId}`
- LRU eviction removes least recently used pool key when pool is full
- Provides isolated, independent communication channels between team pairs

### Process
The actual Claude Code subprocess (`claude --headless`) managed by ClaudeProcessPool.

**Management:**
- Pooled for performance (52% improvement over cold starts)
- LRU eviction when pool limit reached (default: 10 processes max)
- Health checks every 30 seconds detect and restart unhealthy processes
- Idle timeout (default: 5 minutes) terminates inactive processes
- Process status: `stopped → spawning → idle → processing → terminating`

**Communication:**
- Stream-JSON protocol via stdin/stdout
- Message queue prevents concurrent sends
- Response streaming with text accumulation

### Cache
A hierarchical, event-driven cache system built on RxJS that captures all process I/O and protocol messages.

**Architecture:**
```
CacheManager
└── MessageCache (one per fromTeam->toTeam pair)
    └── CacheEntry[] (chronological messages/events)
```

**Hierarchy:**
- **CacheManager**: Top-level cache managing all message caches
- **MessageCache**: Per `(fromTeam, toTeam)` pair, contains chronological entries (links to SessionInfo via sessionId)
- **CacheEntry**: Individual message, event, or output with timestamp and type

**Entry Types:**
- `user` - User message sent to Claude
- `assistant` - Claude's text response
- `tool_use` - Claude invoked a tool
- `tool_result` - Tool execution result
- `stdout` - Process stdout output
- `stderr` - Process stderr output
- `event` - Process lifecycle event

**Key Features:**
- **RxJS Observables**: Real-time streaming via `cache.observe()`
- **Session Isolation**: Each team pair has independent cache
- **Automatic Pruning**: Configurable max entries per session (default: 1000)
- **Identity**: One cache session per `(fromTeam, toTeam)` pair
- **Persistence**: In-memory only (not persisted to disk)

**Access Patterns:**
- `session_report(team, fromTeam)` - View conversation history for a session
- `cache.observe()` - Subscribe to real-time cache events (internal API)

## MCP Tools (17 Total)

See [ACTIONS.md](ACTIONS.md) for complete API reference.

### Communication Tools (3)
- **`send_message`** - Send message to a team with optional response wait
  - Modes: `sync` (wait for response), `async` (background), `persistent` (SQLite queue)
  - Required: `toTeam`, `message`, `fromTeam`
  - Optional: `timeout`, `persist`, `ttlDays`

- **`ask_message`** - Ask a question and wait for response (semantic alias for send_message)
  - Same parameters as `send_message`
  - Signals question intent through naming

- **`quick_message`** - Fire-and-forget async message (convenience wrapper)
  - Required: `toTeam`, `message`, `fromTeam`
  - Equivalent to `send_message` with `timeout: -1`

### Session Management Tools (4)
- **`session_reboot`** - Create fresh session with clean slate
  - Required: `toTeam`, `fromTeam`
  - Terminates process, deletes old session, creates new UUID

- **`session_delete`** - Delete session permanently without replacement
  - Required: `toTeam`, `fromTeam`
  - Unlike reboot, does not create new session

- **`session_fork`** - Launch interactive terminal session
  - Required: `toTeam`, `fromTeam`
  - Opens new terminal with `claude --resume --fork-session`

- **`session_cancel`** - Cancel running operation (EXPERIMENTAL)
  - Required: `team`, `fromTeam`
  - Sends ESC to stdin to interrupt operation

### Process Management Tools (5)
- **`team_wake`** - Wake up a team's process (spawn if needed)
  - Required: `team`, `fromTeam`
  - Creates session-specific process for isolation

- **`team_launch`** - Launch a team process (semantic alias for team_wake)
  - Same parameters as `team_wake`
  - Natural language alternative

- **`team_sleep`** - Put team to sleep (terminate process)
  - Required: `team`, `fromTeam`
  - Optional: `force` (SIGKILL vs SIGTERM, default: false)

- **`team_wake_all`** - Wake up all configured teams
  - Required: `fromTeam`
  - Optional: `parallel` (default: false, NOT RECOMMENDED)

- **`team_status`** - Check if teams are awake or asleep
  - Required: `fromTeam`
  - Optional: `team` (specific team), `includeNotifications` (default: true)
  - Returns: Process details for active teams

### Information & Debug Tools (4)
- **`session_report`** - View conversation history for a session
  - Required: `team`, `fromTeam`
  - Returns: Complete conversation cache with messages and protocol events

- **`list_teams`** - List all configured teams
  - No parameters required
  - Returns: Array of team configurations (name, path, description, color, etc.)

- **`get_logs`** - Query in-memory logs from server
  - Optional: `logs_since`, `storeName`, `format`, `level`, `getAllStores`
  - Returns: Filtered logs since specified timestamp

- **`get_date`** - Get current system date and time
  - No parameters required
  - Returns: Timestamp in multiple formats (ISO, UTC, Unix, components)

### Internal Tools (1)
- **`permissions__approve`** - Permission approval handler (internal)
  - Required: `tool_name`, `input`
  - Optional: `reason`
  - Auto-approves Iris MCP tools, denies others
