# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Iris MCP - Unit Tests Directory

This directory contains the unit test suite for the Iris MCP server. Tests are written using Vitest with Node.js environment.

## Test Commands

```bash
# Run all unit tests (from project root)
pnpm test:unit

# Run all tests (unit + integration)
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests once without watch mode
pnpm test:run

# Generate coverage report
pnpm test:coverage

# Type checking
pnpm tsc
```

### Running Specific Tests

From the project root, you can run specific test files or patterns:

```bash
# Run single test file
pnpm vitest run tests/unit/utils/validation.test.ts

# Run all tests in a directory
pnpm vitest run tests/unit/actions/

# Run tests matching a pattern
pnpm vitest run tests/unit/**/*manager*.test.ts

# Run with watch mode for development
pnpm vitest tests/unit/session/
```

## Test Environment Configuration

Tests use isolated test environment configured in:
- `vitest.config.ts` - Test runner configuration
- `tests/setup.ts` - Global test setup and utilities
- `tests/config.yaml` - Test teams configuration

**Environment Variables** (set automatically by vitest.config.ts):
- `NODE_ENV=test`
- `IRIS_HOME=<project-root>/tests` - Points to test config location
- `IRIS_TEST_REMOTE=1` - Enables remote transport tests

**Important Paths**:
- Test config: `tests/config.yaml`
- Test data dir: `tests/data/` (created automatically, cleaned per test)
- Test database: `tests/data/team-sessions.db` (in-memory for unit tests)

## Test Architecture

### Test Organization

```
tests/unit/
├── actions/        # MCP tool handlers (tell, wake, sleep, isAwake, etc.)
├── config/         # Configuration management and hot-reload
├── dashboard/      # Web dashboard state bridge
├── permissions/    # Permission management system
├── process/        # Individual ClaudeProcess wrapper tests
├── process-pool/   # Pool manager with LRU eviction
├── session/        # Session lifecycle and database operations
├── transport/      # Local/SSH transport layer delegation
└── utils/          # Validation, errors, logging, path utilities
```

### Key Testing Patterns

**1. Mock Strategy**

Unit tests mock external dependencies to avoid spawning real Claude processes:

```typescript
// Mock logger BEFORE imports using Vitest hoisting
vi.mock('../../../src/utils/logger.js', () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    // ...
  })),
}));

// Mock ClaudeProcess.initializeSessionFile
vi.spyOn(ClaudeProcess, 'initializeSessionFile').mockResolvedValue(undefined);
```

**2. Temporary Directory Pattern**

Tests requiring filesystem operations create isolated temp directories:

```typescript
beforeEach(() => {
  testPath = join(tmpdir(), 'iris-test-unique-id');
  mkdirSync(testPath, { recursive: true });
});

afterEach(() => {
  if (existsSync(testPath)) {
    rmSync(testPath, { recursive: true, force: true });
  }
});
```

**3. In-Memory Database**

SessionManager tests use in-memory SQLite to avoid file I/O:

```typescript
const manager = new SessionManager(config, { inMemory: true });
```

**4. Test Utilities**

Global test utilities in `tests/setup.ts`:
- `ensureTestDataDir()` - Create test data directory
- `cleanTestDataDir()` - Clean test data between tests
- `verifyTestEnvironment()` - Validate test setup
- `getTestIrisConfig()` - Get standardized test configuration

### Unit vs Integration Tests

**Unit Tests** (this directory):
- Mock external dependencies (ClaudeProcess, logger, file system where appropriate)
- Fast execution (milliseconds to seconds)
- Test individual components in isolation
- Use in-memory database
- No real Claude process spawning

**Integration Tests** (`tests/integration/`):
- Spawn real Claude Code processes
- Test end-to-end workflows
- Slower execution (seconds to minutes)
- Test inter-component communication
- File-based database and real stdio/SSH

## Common Test Scenarios

### Testing Validation

Validation tests verify security-critical input sanitization:

```typescript
// tests/unit/utils/validation.test.ts
it('should reject path traversal in team names', () => {
  expect(() => validateTeamName('../etc')).toThrow(ValidationError);
  expect(() => validateTeamName('team/name')).toThrow(ValidationError);
});
```

### Testing Session Management

Session tests verify team-to-team session lifecycle:

```typescript
// tests/unit/session/session-manager.test.ts
it('should create different sessions for different team pairs', async () => {
  const sessionAB = await manager.getOrCreateSession('team-alpha', 'team-beta');
  const sessionBA = await manager.getOrCreateSession('team-beta', 'team-alpha');

  expect(sessionAB.sessionId).not.toBe(sessionBA.sessionId);
});
```

### Testing Actions

Action tests verify MCP tool handler logic without spawning processes:

```typescript
// tests/unit/actions/*.test.ts
// Mock dependencies, test validation, error handling, and return values
```

## Test Timeouts

Configured in `vitest.config.ts`:
- Default test timeout: 30s (enough for most unit tests)
- Hook timeout: 15s (beforeEach/afterEach)
- Teardown timeout: 10s (cleanup)

Override per-test if needed:
```typescript
it('slow test', async () => {
  // test code
}, 60000); // 60 second timeout
```

## Test Coverage

Coverage reports exclude:
- `node_modules/`
- `dist/` (built files)
- `**/*.test.ts` (test files themselves)
- `**/*.config.ts` (configuration files)

Coverage thresholds and requirements are tracked per-component.

## Debugging Tests

**VS Code Launch Config** (add to `.vscode/launch.json`):
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Current Test File",
  "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/vitest",
  "args": ["run", "${relativeFile}"],
  "console": "integratedTerminal"
}
```

**CLI Debugging**:
```bash
# Run with verbose output
pnpm vitest run tests/unit/path/to/test.ts --reporter=verbose

# Run single test with debug logs
NODE_ENV=test DEBUG=1 pnpm vitest run tests/unit/session/session-manager.test.ts
```

## Important Constraints

1. **Never spawn real Claude processes in unit tests** - Use mocks or integration tests
2. **Clean up temp directories** - Use `afterEach` to remove test artifacts
3. **Use in-memory database** - Pass `{ inMemory: true }` to SessionManager
4. **Mock ClaudeProcess.initializeSessionFile** - Required to avoid session file creation
5. **Restore mocks** - Call `vi.restoreAllMocks()` in `afterEach`

## Team Identity

When testing actions that require `fromTeam` parameter, use `"team-iris"` as the calling team (defined in `tests/config.yaml`).

## Related Documentation

- Main project CLAUDE.md: `../../CLAUDE.md`
- Session architecture: `../../docs/SESSION.md`
- Test configuration: `../config.yaml`
- Test setup utilities: `../setup.ts`
