# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Iris MCP Server - Cross-Project Claude Coordination

Iris MCP is a Model Context Protocol server that enables Claude Code instances across different project directories to communicate and coordinate via MCP tools.

## Team Identity

This Claude instance represents the **team-iris** team.

When using Iris MCP tools, always set `fromTeam: "team-iris"` to identify yourself in inter-team communication.

You can verify your team identity at any time using the `team_getTeamName` tool:
```typescript
team_getTeamName({ pwd: "/Users/jenova/projects/jenova-marie/iris-mcp" })
// Returns: { teamName: "team-iris", found: true }
```

## Build & Development Commands

```bash
# Build TypeScript to dist/
pnpm build

# Watch mode (auto-rebuild on changes)
pnpm dev

# Run built server directly
pnpm start

# Test with MCP Inspector (http://localhost:5173)
pnpm inspector

# Run all tests
pnpm test

# Run specific test suites
pnpm test:unit          # Unit tests only
pnpm test:integration   # Integration tests only
pnpm test:ui           # Visual test UI
pnpm test:run          # Run once, no watch
```

## Architecture Overview

### Five-Phase Design

The codebase is architected for **five progressive phases**, with Phase 1 currently implemented:

- **Phase 1 (CURRENT)**: Core MCP server with process pooling
- **Phase 2**: React web dashboard for monitoring
- **Phase 3**: HTTP/WebSocket API for external integrations
- **Phase 4**: CLI interface using Ink (React for terminals)
- **Phase 5**: Intelligence Layer with autonomous coordination

**Critical Design Principle**: Foundational dependencies for ALL phases are included upfront (Express, React, Ink, Commander, Socket.io) to avoid retrofitting later. These dependencies are installed but only Phase 1 functionality is implemented.

### Unified React Framework

React (^18.2.0) is used for BOTH the web dashboard (Phase 2) and CLI (Phase 4 via Ink ^5.0.1). This enables component reuse between interfaces. This was an intentional architectural decision to maintain consistency.

### Process Pool with LRU Eviction

The heart of Iris is **process pooling** which achieves **52% performance improvement** over cold starts:

- **ClaudeProcess** (`src/process-pool/claude-process.ts`): Wraps individual `claude-code --headless` child process with stdio communication
- **ClaudeProcessPool** (`src/process-pool/pool-manager.ts`): Manages Map of processes with LRU eviction when `maxProcesses` limit reached

**Key Concepts**:
- Default 5-minute idle timeout (configurable per team)
- Health checks every 30s detect and restart unhealthy processes
- Message queue per process prevents race conditions
- Status lifecycle: `stopped → spawning → idle → processing → idle → terminating → stopped`

**Performance**: Cold start = 7s, warm (pooled) = 2s. For 3 messages: unpooled = 21s, pooled = 11s.

### Event-Driven Architecture

Both `ClaudeProcess` and `ClaudeProcessPool` extend `EventEmitter` and emit events throughout their lifecycle:

- `process-spawned`, `process-terminated`, `process-exited`
- `process-error`, `message-sent`, `message-response`

**Why**: Phase 5 Intelligence Layer will observe these events for autonomous coordination and meta-cognitive abilities. The event system is foundational infrastructure, not optional.

### Configuration with Hot-Reload

`TeamsConfigManager` (`src/config/teams-config.ts`) loads `config.json` (from `$IRIS_HOME/config.json` or `~/.iris/config.json`) with Zod validation. Uses `fs.watchFile()` with 1s interval to hot-reload configuration changes without server restart.

Configuration structure:
```typescript
{
  settings: {
    idleTimeout: 300000,      // 5 minutes
    maxProcesses: 10,          // LRU eviction when exceeded
    healthCheckInterval: 30000 // 30 seconds
  },
  teams: {
    [teamName]: {
      path: string,              // Absolute path to project
      description: string,
      idleTimeout?: number,      // Optional override
      skipPermissions?: boolean, // Auto-approve Claude actions
      color?: string            // Hex color for future UI
    }
  }
}
```

### Notification Queue (SQLite)

`NotificationQueue` (`src/notifications/queue.ts`) provides persistent async messaging via better-sqlite3:

- Schema: `id, fromTeam, toTeam, message, status (pending/read/expired), createdAt, readAt, expiresAt`
- 30-day default TTL with automatic cleanup
- WAL mode for better concurrency
- Indexes on `(toTeam, status)` and `(expiresAt)`

Use case: `teams_notify` tool for  messages that persist across server restarts.

## MCP Tools Implementation

All tools are implemented in `src/actions/` with consistent validation pipeline:

1. **team_tell** - Send message to a team (sync/async/persistent modes)
2. **team_isAwake** - Check if teams are active or inactive
3. **team_wake** - Wake up a team process
4. **team_sleep** - Put a team process to sleep
5. **team_wake_all** - Wake all configured teams
6. **team_report** - View team output cache (stdout/stderr)
7. **team_cache_read** - Read conversation cache and protocol messages
8. **team_cache_clear** - Clear conversation cache
9. **team_getTeamName** - Identify team name from current working directory

**Validation Pattern** (in all tools):
```typescript
validateTeamName(team);    // Prevents path traversal attacks
validateMessage(message);   // Sanitizes, limits length, removes null bytes
validateTimeout(timeout);   // Ensures 1s-1hr range
```

Tool handlers are registered in `src/index.ts` via `server.setRequestHandler(CallToolRequestSchema)`.

## Logging

**Critical**: All logs go to **stderr** (stdout reserved for MCP protocol). The `Logger` class (`src/utils/logger.ts`) outputs structured JSON:

```json
{"level":"info","context":"pool","message":"Process spawned","pid":12345,"timestamp":"2025-01-15T10:30:00.000Z"}
```

Log levels: `debug` (only if `DEBUG` env set), `info`, `warn`, `error`. Each logger instance is context-scoped (e.g., `new Logger('process:frontend')`).

## Error Hierarchy

Custom errors (`src/utils/errors.ts`) extend `IrisError` base class with `code`, `statusCode`, `cause`:

- `TeamNotFoundError` (404): Team not in config
- `ProcessError` (500): Process spawn/communication failure
- `ProcessPoolLimitError` (503): Max processes reached
- `TimeoutError` (408): Operation timeout
- `ValidationError` (400): Invalid inputs
- `ConfigurationError` (500): Config file issues

Status codes map to HTTP semantics for future Phase 3 API.

## Testing Strategy

Test structure (not yet implemented):
- `tests/unit/` - Process pool, tools, validation
- `tests/integration/` - End-to-end MCP communication
- Use Vitest (^3.2.4) with V8 coverage provider

When writing tests, avoid testing private implementation details. Export handler functions for testability.

## Key Files and Their Responsibilities

- `src/index.ts` - MCP server entry, tool registration, event forwarding
- `src/config/teams-config.ts` - Config loader with Zod validation, hot-reload
- `src/process-pool/pool-manager.ts` - Pool with LRU eviction, health checks
- `src/process-pool/claude-process.ts` - Individual process wrapper, stdio communication
- `src/notifications/queue.ts` - SQLite notification queue
- `src/actions/*.ts` - MCP tool implementations (tell, wake, sleep, isAwake, cache, getTeamName, etc.)
- `src/utils/logger.ts` - Structured JSON logging to stderr
- `src/utils/errors.ts` - Custom error hierarchy
- `src/utils/validation.ts` - Security-focused input validation

## TypeScript Configuration

Strict mode enabled, ES2022 target, Node16 module resolution. Declaration files and source maps generated. Type definitions in `src/process-pool/types.ts`.

## Future Phases (Not Yet Implemented)

See placeholder READMEs:
- `src/dashboard/README.md` - React SPA with Express backend
- `src/api/README.md` - RESTful + WebSocket API
- `src/cli/README.md` - Ink CLI with Commander
- `src/intelligence/README.md` - Self-aware coordination layer

Dependencies for these phases are installed but no functionality implemented yet.

## Memory Database

This project uses the `iris-mcp-db` Neo4j memory database via the Memory MCP server. At the start of each session:

```typescript
// Switch to project database
database_switch to "iris-mcp-db"

// Search for relevant context
memory_find with semantic search
```

The memory database contains 37+ nodes documenting technologies, architectural decisions, features, and implementation files with their relationships.
