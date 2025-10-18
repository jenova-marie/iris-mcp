# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Integration Tests - Iris MCP Server

Integration tests for the Iris MCP server that validate end-to-end functionality with real Claude Code processes.

## Running Tests

```bash
# From project root (/Users/jenova/projects/jenova-marie/iris-mcp)

# Run all integration tests
pnpm test:integration

# Run specific integration test file
pnpm vitest run tests/integration/actions/actions.test.ts

# Run integration tests in watch mode
pnpm vitest tests/integration

# Run with UI
pnpm test:ui

# Run single test by name
pnpm vitest run tests/integration/actions/actions.test.ts -t "should wake up team-alpha"
```

## Test Architecture

### Test Environment Setup

All tests use an isolated environment defined in `tests/setup.ts`:

- **IRIS_HOME**: Points to `tests/` directory (not `~/.iris`)
- **Config**: Uses `tests/config.yaml` with test teams (team-iris, team-alpha, team-beta, team-inanna)
- **Database**: In-memory SQLite database (`{ inMemory: true }`) for session storage
- **Teams**: Test teams located in `tests/teams/team-alpha` and `tests/teams/team-beta`

### Critical Test Configuration

From `vitest.config.ts`:

- **Test timeout**: 30 seconds (enough for single Claude spawn + response)
- **Hook timeout**: 15 seconds (for beforeEach/afterEach with SessionManager init)
- **Pool mode**: `forks` with `singleFork: true` (runs tests **sequentially** to avoid port conflicts)
- **Bail**: Stops after first failure in integration tests

### Session Initialization Timeout

Most tests that spawn Claude processes use a dynamic timeout from `config.yaml`:

```typescript
const tempConfigManager = new TeamsConfigManager(testConfigPath);
tempConfigManager.load();
const sessionInitTimeout =
  tempConfigManager.getConfig().settings.sessionInitTimeout || 60000;
```

Default: 30 seconds (`tests/config.yaml` line 11)

## Test Organization

### Core Component Tests

- **actions/actions.test.ts**: End-to-end test of all MCP tools (tell, wake, sleep, isAwake, wakeAll, reboot)
  - **IMPORTANT**: Tests are intentionally interdependent for performance (avoid re-spawning processes)
  - Tests build on each other's state sequentially
  - Single `beforeAll` initialization, shared state across all tests

- **session/session-manager.test.ts**: SessionManager lifecycle (create, retrieve, filter, metadata)
  - Tests fromTeam->toTeam session architecture
  - Validates on-demand session creation
  - Tests session filtering by fromTeam, toTeam, status

- **process/pool-manager.test.ts**: Process pooling with LRU eviction
  - Tests pool operations with SessionManager integration
  - Validates fromTeam->toTeam pool keys

- **dashboard/cache-with-tell.test.ts**: Cache operations integrated with tell action

### Transport Tests

- **print/claude-print-local.test.ts**: Local stdio transport with `--print` flag
- **print/claude-print-remote.test.ts**: Remote SSH transport with `--print` flag (requires `IRIS_TEST_REMOTE=1`)

### Session Tests

- **session/createSession.test.ts**: Session creation with file system operations
- **session/path-utils.test.ts**: Path resolution and validation
- **session/metrics.test.ts**: Session metrics tracking
- **session/validation.test.ts**: Session parameter validation
- **session/session-store.test.ts**: SQLite session storage

## Key Architecture Patterns

### fromTeam Requirement (NEW)

All session operations now require a `fromTeam` parameter:

```typescript
// CORRECT
await sessionManager.createSession("team-iris", "team-alpha");
const session = manager.getSession("team-iris", "team-alpha");

// INCORRECT (old architecture)
await sessionManager.createSession(null, "team-alpha"); // WILL THROW
```

### Test Cleanup Strategy

```typescript
beforeAll(async () => {
  // ONE-TIME setup with in-memory database
  sessionManager = new SessionManager(teamsConfig, { inMemory: true });
  await sessionManager.initialize();
}, 120000); // 2 minute timeout

afterEach(() => {
  // Reset manager between tests (preserves DB and sessions)
  if (sessionManager) {
    sessionManager.reset();
  }
});

afterAll(async () => {
  // Final cleanup
  if (processPool) await processPool.terminateAll();
  if (sessionManager) sessionManager.close();
});
```

**Why `reset()` instead of `close()`?** Preserves database connection and sessions while clearing operation state.

### RxJS Observables for Process Status

Integration tests use RxJS to wait for specific process states:

```typescript
import { firstValueFrom, filter, take, timeout } from "rxjs";

// Wait for process to reach IDLE status
const process = processPool.getProcess("team-alpha");
await firstValueFrom(
  process.status$.pipe(
    filter((status) => status === ProcessStatus.IDLE),
    take(1),
    timeout(30000), // 30 second timeout
  ),
);
```

**Critical**: The `wake` action sends an initial ping, so tests must wait for IDLE status before sending messages.

## Common Test Patterns

### Spawning Claude Process

```typescript
it("should wake up team-alpha", async () => {
  const result = await wake(
    { team: "team-alpha", fromTeam: "team-iris" },
    iris,
    processPool,
    sessionManager,
  );

  expect(result.status).toMatch(/awake|waking/);
  expect(result.sessionId).toBeTruthy();
}, sessionInitTimeout); // Use dynamic timeout
```

### Sending Messages

```typescript
it("should send message and get response", async () => {
  // Ensure process is IDLE first
  const process = processPool.getProcess("team-alpha");
  await firstValueFrom(
    process.status$.pipe(
      filter((status) => status === ProcessStatus.IDLE),
      take(1),
      timeout(30000),
    ),
  );

  const result = await tell({
    fromTeam: "team-iris",
    toTeam: "team-alpha",
    message: "Hello from test",
  }, iris);

  expect(result.response).toBeTruthy();
}, sessionInitTimeout);
```

## Debugging Integration Tests

### Enable Verbose Logging

Set environment variables in `vitest.config.ts` (line 14-18):

```typescript
env: {
  DEBUG: "1",           // Enable debug logs
  NODE_ENV: "test",
  IRIS_HOME: resolve(__dirname, "tests"),
},
```

### Check Process Logs

Test processes write to `tests/logs/` directory.

### Common Issues

1. **Timeout on first test**: Claude spawn takes ~7s cold start. Use `sessionInitTimeout` from config.
2. **Port conflicts**: Tests run sequentially (`singleFork: true`) to prevent this.
3. **Process not IDLE**: Always wait for IDLE status after wake before sending messages.
4. **Database locked**: Ensure `inMemory: true` in SessionManager options.

## Test Coverage

Run with coverage analysis:

```bash
pnpm test:coverage
```

Coverage output in `coverage/` directory (excluded from git).

## Remote SSH Tests

Tests with `remote-ssh` in filename require remote host configuration:

- Set `IRIS_TEST_REMOTE=1` environment variable
- Configure SSH host in `tests/config.yaml` (team-inanna)
- Requires `~/.ssh/config` entry for host

**Warning**: Remote tests are slower and may fail if SSH connection unavailable.
