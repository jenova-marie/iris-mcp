# Iris MCP Features

> **Status**: This document catalogs all implemented and planned features of Iris MCP as of October 2025

A comprehensive inventory of Iris MCP's capabilities across all five architectural phases.

---

## Core MCP Server (Phase 1) ✅

### Cross-Project Communication

- **Team-to-Team Messaging**: Send messages between Claude Code instances across different project directories
- **Bidirectional Coordination**: Any team can communicate with any other team via MCP tools
- **Session Persistence**: Conversations maintain context across process restarts with unique `(fromTeam, toTeam)` sessions
- **Message Cache**: Full protocol-level message history stored per session with RxJS Observable streams

### Process Pool Management

- **Process Reuse**: 10-20x performance improvement via warm process pooling (2s vs 14s cold start)
- **LRU Eviction**: Automatic least-recently-used eviction when `maxProcesses` limit is reached
- **Idle Timeout**: Configurable per-team idle timeout (default: 5 minutes) with automatic process termination
- **Health Monitoring**: 30-second health checks detect and restart unhealthy Claude processes
- **Status Lifecycle**: Full process state tracking (stopped → spawning → idle → processing → terminating)

### Remote Execution via SSH ✅

- **OpenSSH Client Transport**: Execute Claude Code on remote hosts via SSH (default, implemented)
- **SSH2 Library Transport**: Pure Node.js SSH implementation (planned, opt-in)
- **Transport Abstraction**: Clean interface supporting LocalTransport and SSHTransport implementations
- **Configuration Flexibility**: Simple `remote: "ssh user@host"` configuration flag enables remote execution
- **Session Lifecycle**: SSH connection lifecycle tied to process session lifecycle

### Reverse MCP: Bidirectional Remote Coordination ✅

- **SSH Reverse Tunneling**: Remote Claude instances can call back to local Iris MCP server via `-R` tunnel
- **Secure Tunnel**: localhost-only binding with SSH encryption, no exposed network ports
- **Permission Approval**: Auto-approve Iris tools, deny others via `--permission-prompt-tool` interface
- **MCP Configuration Injection**: Automatic MCP server config passed to remote Claude via `--mcp-config`
- **Cross-Boundary Orchestration**: Remote teams can wake, fork, and coordinate local teams

### Configuration Management

- **Hot-Reload**: `fs.watchFile()` with 1-second interval reloads configuration without server restart
- **Zod Validation**: Strict schema validation for all configuration fields with helpful error messages
- **Team Overrides**: Per-team `idleTimeout`, `sessionInitTimeout`, and `skipPermissions` settings
- **Global Settings**: Configurable `maxProcesses`, `healthCheckInterval`, and default timeouts

### MCP Tools (15 Total)

**Core Communication**:
1. **team_tell**: Send messages with sync/async/persistent modes, configurable timeouts
2. **team_quick_tell**: Fire-and-forget async messaging (timeout=-1 wrapper)
3. **team_report**: View cached conversation output (stdout/stderr) for team sessions

**Process Lifecycle**:
4. **team_wake**: Wake up a specific team process (create if doesn't exist)
5. **team_wake_all**: Wake all configured teams sequentially (parallel mode not recommended)
6. **team_sleep**: Put a team process to sleep (terminate)
7. **team_isAwake**: Check if teams are active or inactive with process metrics

**Session Management**:
8. **team_clear** (reboot): Create fresh session, terminate old process, delete old session files
9. **team_delete**: Permanently delete session without replacement
10. **team_compact**: Compress session history using `claude --print /compact` to reduce context size
11. **team_fork**: Launch interactive terminal session with `--resume --fork-session` for manual debugging

**System**:
12. **team_cancel**: Experimental ESC signal to interrupt running operations (EXPERIMENTAL)
13. **team_teams**: Get all configured teams with metadata (name, path, description, color)
14. **team_debug**: Query in-memory logs from Wonder Logger memory transport with level filtering
15. **permissions__approve**: Permission approval handler for Reverse MCP (`--permission-prompt-tool`)

### Event System

- **EventEmitter Architecture**: Both `ClaudeProcess` and `ClaudeProcessPool` emit lifecycle events
- **Event Types**: process-spawned, process-terminated, process-exited, process-error, message-sent, message-response, health-check
- **Future Intelligence Layer**: Event system designed for Phase 5 autonomous coordination and meta-cognition

### Security

- **Input Validation**: `validateTeamName()`, `validateMessage()`, `validateTimeout()` prevent injection attacks
- **Path Traversal Protection**: Team name validation blocks `../`, `./`, absolute paths
- **Message Sanitization**: Null byte removal, length limits, encoding normalization
- **Permission Policies**: Auto-approve only `mcp__iris__*` tools in Reverse MCP, deny all others

### Persistence

- **SQLite Session Store**: Session metadata (message count, last used, status) with 60-second cache
- **Session File Management**: `.jsonl` files at `~/.claude/projects/{escaped-path}/{sessionId}.jsonl`
- **Eager Initialization**: All session files validated and initialized at startup
- **Filesystem Cleanup**: Automatic cleanup of session files on session deletion

### Observability & Telemetry ✅

**Powered by Wonder Logger** - Production-grade observability with OpenTelemetry integration

**Structured Logging (Pino-based)**:
- **JSON Format**: All logs to file/OTEL (stdout reserved for MCP protocol)
- **Context Hierarchies**: Colon-separated namespaces (e.g., `pool:process:teamName`, `action:tell`)
- **Child Loggers**: Automatic context binding with `getChildLogger(context)`
- **Log Levels**: trace, debug, info, warn, error, fatal with intelligent filtering
- **Sensitive Data Redaction**: Auto-redact password, token, apiKey, secret fields

**Multiple Transports**:
- **File Transport**: Async I/O to `./logs/iris.log` with rotation support
- **Memory Transport**: In-memory circular buffer (10,000 logs) with programmatic querying via `team_debug` tool
- **OTLP Transport**: Push logs to OpenTelemetry Collector, Grafana Loki, or any OTLP-compatible backend
- **Console Transport**: Pretty-printing for development (disabled in production to preserve MCP protocol)

**OpenTelemetry Integration** (optional, configurable):
- **Distributed Tracing**: OTLP, Jaeger, and console trace exporters with configurable sampling
- **Trace Context Correlation**: Automatic injection of trace_id and span_id into logs for seamless correlation
- **Custom Spans**: `withSpan()` utility for manual instrumentation of critical paths
- **Auto-Instrumentation**: HTTP, Express, GraphQL, database monitoring out-of-the-box

**Metrics & Monitoring**:
- **Prometheus Exporter**: Pull-based metrics endpoint on port 9464 for scraping
- **OTLP Metrics Push**: Export metrics to Grafana Tempo, OTLP Collector, or observability platforms
- **Custom Metrics**: Process pool size, session counts, message latency, error rates
- **Export Intervals**: Configurable push intervals (default: 60s)

**RxJS Log Streaming**:
- **Reactive Queries**: Memory transport supports Observable streams with operators
- **Level Filtering**: Filter by log level in real-time (e.g., only errors)
- **Timestamp Ranges**: Query logs since a specific timestamp
- **Backpressure Handling**: Stream large log volumes without memory overflow

**YAML-Based Configuration**:
- **Declarative Setup**: `wonder-logger.yaml` with environment variable interpolation
- **Environment Flexibility**: Same config works across dev/staging/prod with env vars
- **Hot-Reload Ready**: Configuration changes detected without restart (via fs.watchFile)
- **Validation**: Schema validation ensures correct config structure

**Supported Backends**:
- Grafana Loki (logs), Grafana Tempo (traces), Jaeger (traces), Prometheus (metrics)
- Any OTLP-compatible observability platform (DataDog, New Relic, Honeycomb, etc.)
- Local development with console exporters and file transports

**Runtime Inspection**:
- **team_debug Tool**: Query in-memory logs with level filtering and regex patterns
- **Process-Specific Logs**: Each Claude process has isolated logger context
- **Session Metrics**: Track session lifecycle events with structured metadata

**Graceful Shutdown**:
- `shutdownObservability()`: Flushes pending logs and telemetry before process exit
- Automatic SIGTERM/SIGINT handlers ensure no data loss on shutdown

### Error Handling

- **Custom Error Hierarchy**: All errors extend `IrisError` base with code, statusCode, cause
- **Error Types**: TeamNotFoundError (404), ProcessError (500), ProcessPoolLimitError (503), TimeoutError (408), ValidationError (400), ConfigurationError (500)
- **HTTP Status Mapping**: Error status codes map to HTTP semantics for future Phase 3 API

---

## Web Dashboard (Phase 2) 🚧

**Status**: React SPA and Express backend implemented, full feature set in progress

### Process Monitoring

- **Live Process Status**: Real-time view of all active Claude processes with pid, uptime, messages processed
- **Session Overview**: View all sessions with fromTeam→toTeam pairs, message counts, last activity
- **Pool Metrics**: Total processes, max processes, active sessions, queue length
- **Process States**: Visual indicators for stopped, spawning, idle, processing, terminating states

### Real-Time Updates

- **WebSocket Integration**: Socket.IO server with `/ws` endpoint for live updates
- **Event Streaming**: Process status changes, config saves, cache stream updates pushed to clients
- **Reactive UI**: React Query for data fetching with optimistic updates
- **Auto-Reconnect**: Automatic WebSocket reconnection on connection loss

### Configuration Editor

- **Live Config Editing**: Edit `config.json` directly from web UI with validation
- **Team Management**: Add, edit, remove teams with path, description, color configuration
- **Settings Panel**: Adjust maxProcesses, idleTimeout, healthCheckInterval without restart
- **Validation Feedback**: Real-time Zod validation errors displayed inline

### HTTP/HTTPS Support

- **Dual Server Support**: Run HTTP and HTTPS simultaneously on different ports
- **Self-Signed Certificates**: Auto-generate self-signed certs with `selfsigned` option
- **Custom Certificates**: Load custom cert/key files for production deployments
- **CORS Enabled**: Allow all origins for localhost-only development

### REST API

- **Health Check**: `GET /api/health` returns server status
- **Config Routes**: `GET /api/config` and `POST /api/config` for configuration management
- **Process Routes**: `GET /api/processes` returns all active sessions with process details
- **Cache Streaming**: Request cache stream for specific session via WebSocket `stream-cache` event

### UI Features (Implemented)

- **React Router**: Client-side routing with `/` (ProcessMonitor) and `/config` (ConfigEditor)
- **Layout Component**: Shared navigation and header across all pages
- **TanStack Query**: Optimized data fetching with caching and refetch strategies
- **Responsive Design**: Mobile-friendly UI (framework in place, styling in progress)

---

## Programmatic API (Phase 3) 🔮

**Status**: Express foundation in place, RESTful endpoints planned

### RESTful Endpoints (Planned)

- **Team Operations**: `POST /api/teams/{team}/tell`, `POST /api/teams/{team}/wake`, `DELETE /api/teams/{team}`
- **Session Management**: `GET /api/sessions`, `GET /api/sessions/{sessionId}`, `DELETE /api/sessions/{sessionId}`
- **Process Control**: `GET /api/processes`, `POST /api/processes/{team}/reboot`, `POST /api/processes/{team}/compact`
- **Configuration**: `GET /api/config`, `PUT /api/config`, `POST /api/config/teams`
- **Notifications**: `GET /api/notifications/{team}`, `POST /api/notifications`, `DELETE /api/notifications/{id}`

### WebSocket Streaming (Planned)

- **Live Message Stream**: Subscribe to team message streams with `socket.on('messages', ...)`
- **Process Events**: Real-time process-spawned, process-terminated, process-error events
- **Cache Streaming**: Stream full cache history for session with backpressure handling
- **Presence**: Track connected clients per team with join/leave events

### Authentication (Planned)

- **API Keys**: Bearer token authentication with configurable scopes (read, write, admin)
- **Key Management**: `POST /api/auth/keys` to create API keys with expiration
- **Rate Limiting**: Per-key rate limits to prevent abuse (100 req/min default)
- **Audit Logging**: Track all API calls with key, endpoint, timestamp, result

### Job Queue (Planned)

- **Async Operations**: Queue long-running operations (wake_all, multi-team messaging) with job IDs
- **Job Status**: `GET /api/jobs/{jobId}` returns pending, running, completed, failed
- **Job Cancellation**: `DELETE /api/jobs/{jobId}` to cancel running jobs
- **Job History**: Persist job results for 7 days with automatic cleanup

### Official SDKs (Planned)

- **TypeScript SDK**: Fully-typed client with `IrisClient` class, auto-retry, and error handling
- **Python SDK**: `iris-mcp-client` package with async/await support and type hints
- **REST Client Examples**: cURL examples for all endpoints in API documentation
- **WebSocket Examples**: Socket.IO client examples in JS and Python

---

## CLI Interface (Phase 4) 🔮

**Status**: Foundation in place (Ink + Commander installed), command structure planned

### Current CLI (Setup Commands) ✅

- **add-team**: Add a new team to configuration (`iris-mcp add-team <name> <path>`)
- **install**: Install Iris MCP server to Claude Code's MCP config (`iris-mcp install`)
- **uninstall**: Remove Iris MCP from Claude Code's MCP config (`iris-mcp uninstall`)

### Planned Interactive CLI

**Message Commands**:
- `iris ask <team> <question>`: Ask a team a question and wait for response
- `iris tell <team> <message>`: Send a message to a team
- `iris notify <team> <message>`: Send fire-and-forget notification

**Team Commands**:
- `iris teams`: List all configured teams with status
- `iris status [team]`: Check team process status and metrics
- `iris wake <team>`: Wake up a team process
- `iris sleep <team>`: Put a team to sleep
- `iris fork <team>`: Launch interactive terminal session

**Session Commands**:
- `iris sessions`: List all active sessions with message counts
- `iris compact <team>`: Compress session history
- `iris clear <team>`: Create fresh session (reboot)
- `iris logs <team>`: View recent logs for team process

**Interactive Shell**:
- `iris shell`: Launch interactive REPL with autocomplete
- `> wake frontend`: Execute commands without `iris` prefix
- `> ask backend "What's the API version?"`: Multi-word arguments
- Tab completion for team names and commands

### Rich Terminal UI (Ink Components)

- **Live Dashboard**: `iris monitor` shows live process status in terminal UI
- **Progress Indicators**: Spinners for async operations with estimated time
- **Color-Coded Output**: Team colors from config for visual distinction
- **Table Formatting**: Pretty-printed tables for team/session lists
- **Syntax Highlighting**: JSON output with colors for readability

---

## Intelligence Layer (Phase 5) 🔮

**Status**: Event system foundation in place, autonomous features planned

### Loop Detection

- **Message Pattern Analysis**: Detect cyclical message patterns (A→B→A→B...)
- **Infinite Loop Prevention**: Automatically break loops after N iterations
- **Loop Alerts**: Notify when loop detected with suggested resolution
- **Deadlock Detection**: Identify teams waiting on each other with timeout warnings

### Destructive Action Prevention

- **Risk Assessment**: Analyze tool calls for potential destructive operations
- **Confirmation Prompts**: Require human approval for high-risk actions (delete, mass-reboot)
- **Rollback Capability**: Track state changes to enable rollback on error
- **Dry-Run Mode**: Simulate destructive actions without execution

### Pattern Recognition

- **Common Workflows**: Learn frequently-used message sequences (frontend→backend→database)
- **Workflow Shortcuts**: `iris workflow deploy` executes learned multi-step pattern
- **Anomaly Detection**: Alert when teams deviate from normal communication patterns
- **Performance Optimization**: Suggest workflow improvements based on observed bottlenecks

### Self-Aware Coordination

- **Meta-Cognition**: Iris analyzes its own coordination patterns and suggests improvements
- **Auto-Scaling**: Dynamically adjust `maxProcesses` based on demand
- **Proactive Waking**: Wake teams before they're needed based on predicted usage
- **Context Sharing**: Automatically share relevant context between teams without explicit tells

---

## Performance Metrics

### Process Pool

- **Cold Start**: 7-14 seconds (session creation + process spawn)
- **Warm Start**: 0.5-2 seconds (process reuse, 10-20x faster)
- **Session Lookup**: ~1ms (60-second cache hit)
- **LRU Eviction**: <10ms (terminate + cleanup)

### Memory Usage

- **10 Processes**: 600 MB - 1.25 GB RAM
- **Session Database**: ~2 MB per 10,000 sessions
- **Notification Queue**: ~5 MB per 10,000 notifications
- **Message Cache**: ~1-5 MB per session (depends on message count)

### Test Suite

- **Unit Tests**: 203 tests passing in <2 seconds (mocked)
- **Integration Tests**: 85% faster (7min → 1min) with `beforeAll` optimization
- **Coverage**: V8 coverage provider with branch/line/function metrics

### Remote Execution

- **SSH Connection**: ~100-500ms (network latency dependent)
- **Reverse Tunnel**: ~100ms one-time overhead per connection
- **MCP Tool Latency**: ~50-200ms (network latency + SSH encryption)
- **Permission Approval**: ~10-50ms (cached after first approval)

---

## Feature Comparison

### Iris MCP vs Other Orchestration Frameworks

| Feature | Iris MCP | Symphony of One | Claude-Flow | Agent-MCP | Others |
|---------|-----------|-----------------|-------------|-----------|--------|
| **Cross-Project Communication** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Independent Team Contexts** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Direct Agent-to-Agent Messaging** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Per-Team MCP Server Access** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Zero Shared State** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Natural Language Coordination** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Remote Execution via SSH** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Reverse MCP Tunnel** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Persistent Session Context** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Process Pool Management** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **OpenTelemetry Integration** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Distributed Tracing** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Prometheus Metrics** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Web Dashboard** | 🚧 | ❌ | ❌ | ❌ | ❌ |
| **RESTful API** | 🔮 | ❌ | ❌ | ❌ | ❌ |
| **Interactive CLI** | 🔮 | ❌ | ❌ | ❌ | ❌ |
| **Intelligence Layer** | 🔮 | ❌ | ❌ | ❌ | ❌ |

**Legend**: ✅ Implemented | 🚧 In Progress | 🔮 Planned | ❌ Not Available

### Unique Capabilities

1. **True Cross-Codebase Coordination**: Only Iris enables Claude instances across completely independent projects to communicate
2. **Context Isolation**: Each team maintains separate `.claude/` config, MCP servers, dependencies, and git repos
3. **Bidirectional Remote Orchestration**: Remote teams can call back to local Iris via SSH reverse tunneling
4. **Session Persistence**: Full conversation history maintained across process restarts
5. **Warm Process Pooling**: 10-20x performance improvement via process reuse
6. **Production-Grade Observability**: OpenTelemetry integration with distributed tracing, metrics, and log correlation
7. **Multi-Interface Access**: MCP tools, web dashboard, REST API, CLI (current + planned)

---

## Technology Stack

### Core (Phase 1)

- **Runtime**: Node.js 18+ with ES2022 modules
- **Language**: TypeScript 5.7+ with strict mode
- **MCP Protocol**: `@modelcontextprotocol/sdk` for MCP server implementation
- **Process Management**: Node.js `child_process` with stdio communication
- **Database**: `better-sqlite3` for session store and notification queue
- **Validation**: Zod schemas for configuration and input validation
- **Observability**: `@recoverysky/wonder-logger` with Pino + OpenTelemetry
- **Tracing**: OpenTelemetry SDK with OTLP, Jaeger exporters
- **Metrics**: Prometheus pull endpoint + OTLP push
- **Testing**: Vitest with V8 coverage provider

### Dashboard (Phase 2)

- **Frontend**: React 18.2+ with TypeScript
- **Routing**: React Router 7.1+ for SPA navigation
- **State**: TanStack Query (React Query) for server state
- **Real-Time**: Socket.IO for WebSocket connections
- **Backend**: Express 5.0+ with CORS middleware
- **HTTPS**: Self-signed certificates via `selfsigned` package
- **Build**: Vite for client bundling with HMR

### API (Phase 3)

- **HTTP Server**: Express (already installed for Dashboard)
- **WebSocket**: Socket.IO (already installed for Dashboard)
- **Authentication**: JWT tokens with `jsonwebtoken` (planned)
- **Rate Limiting**: `express-rate-limit` (planned)
- **API Docs**: OpenAPI 3.0 spec (planned)

### CLI (Phase 4)

- **Framework**: Commander.js for argument parsing
- **Terminal UI**: Ink 5.0+ (React for terminals)
- **Styling**: Chalk for colors (via Ink)
- **Prompts**: Inquirer.js for interactive questions (planned)

### Remote Execution

- **SSH Client**: OpenSSH CLI via `child_process` (default, implemented)
- **SSH2 Library**: `ssh2` package for pure Node.js SSH (planned, opt-in)
- **Transport Abstraction**: Interface-based design for LocalTransport vs SSHTransport

---

## Documentation

- **[GETTING_STARTED.md](../GETTING_STARTED.md)**: Installation and quick start guide
- **[ARCHITECTURE.md](./ARCHITECTURE.md)**: System design and component interaction
- **[ACTIONS.md](./ACTIONS.md)**: Complete MCP tools API reference
- **[REMOTE.md](./REMOTE.md)**: Remote execution via SSH documentation
- **[REVERSE_MCP.md](./REVERSE_MCP.md)**: Bidirectional tunnel architecture and security
- **[SESSION.md](./SESSION.md)**: Session management deep dive
- **[PROCESS_POOL.md](./PROCESS_POOL.md)**: Process pool management and LRU eviction
- **[CACHE.md](./CACHE.md)**: Message cache system with RxJS observables
- **[BREAKING.md](./BREAKING.md)**: Migration guide for breaking changes

---

## Related Resources

- **GitHub Repository**: https://github.com/jenova-marie/iris-mcp
- **NPM Package**: https://www.npmjs.com/package/@jenova-marie/iris-mcp
- **Issue Tracker**: https://github.com/jenova-marie/iris-mcp/issues
- **Contributing**: [CONTRIBUTING.md](../CONTRIBUTING.md)
- **License**: MIT

---

**Document Version**: 2.0
**Last Updated**: October 2025
**Status Key**: ✅ Implemented | 🚧 In Progress | 🔮 Planned
