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
└── CacheSession (one per fromTeam->toTeam pair)
    └── CacheEntry[] (chronological messages/events)
```

**Hierarchy:**
- **CacheManager**: Top-level cache managing all sessions
- **CacheSession**: Per `(fromTeam, toTeam)` pair, contains chronological entries
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
- `team_cache_read(sessionId)` - Read all entries for a session
- `team_cache_clear(sessionId)` - Clear specific session cache
- `cache.observe()` - Subscribe to real-time cache events

## MCP Tools (All 10)

### Communication
- **`team_tell`** - Send message to a team and optionally wait for response
  - Modes: `sync` (wait), `async` (background), `persistent` (queue for later)
  - Required: `fromTeam`, `toTeam`, `message`
  - Optional: `waitForResponse`, `timeout`

### Process Management
- **`team_wake`** - Wake up a team's process (spawn if needed)
  - Required: `team`, `fromTeam`
  - Optional: `clearCache` (default: true)

- **`team_sleep`** - Put a team's process to sleep (terminate gracefully)
  - Required: `team`, `fromTeam`
  - Optional: `force` (SIGKILL vs SIGTERM)

- **`team_wake_all`** - Wake up all configured teams
  - Required: `fromTeam`
  - Optional: `parallel` (default: false - sequential mode)

### Status & Monitoring
- **`team_isAwake`** - Check if team processes are active
  - Required: `teams` (array of team names)
  - Returns: Status for each team (active/inactive)

- **`team_report`** - View process output (stdout/stderr)
  - Required: `team`, `fromTeam`
  - Returns: Recent process output without clearing

### Cache Operations
- **`team_cache_read`** - Read conversation cache and protocol messages
  - Required: `sessionId`, `fromTeam`
  - Returns: All cache entries for the session

- **`team_cache_clear`** - Clear conversation cache
  - Required: `sessionId`, `fromTeam`
  - Removes all entries for the session

### Team Identification
- **`team_getTeamName`** - Identify team name from current directory
  - Required: `pwd` (current working directory)
  - Returns: Team name matching the directory path

- **`team_teams`** - List all configured teams
  - No parameters required
  - Returns: Array of all team configurations
