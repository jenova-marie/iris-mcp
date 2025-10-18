# Environment Variables

This document lists all environment variables used by Iris MCP Server and their effects.

## Core Configuration

### `IRIS_HOME`
- **Type:** Path
- **Default:** `~/.iris`
- **Description:** Base directory for Iris configuration, logs, and runtime data
- **Used by:** `src/utils/paths.ts`

### `IRIS_HTTP_PORT`
- **Type:** Number
- **Default:** `1615`
- **Description:** HTTP server port for MCP-over-HTTP transport (Phase 3)
- **Used by:** `src/utils/command-builder.ts`, config interpolation
- **Config Override:** Can be overridden in `config.yaml` with `settings.httpPort`

### `IRIS_IDLE_TIMEOUT`
- **Type:** Number (milliseconds)
- **Default:** `300000` (5 minutes)
- **Description:** Default idle timeout for process pool eviction
- **Used by:** Config interpolation
- **Config Override:** Can be overridden in `config.yaml` with `settings.idleTimeout`

## Test Mode Variables

### `NODE_ENV`
- **Type:** String
- **Values:** `test` | `development` | `production`
- **Description:** Node.js environment mode
- **Special Behavior:** When set to `test`, the following behaviors are modified:
  - **Skips `--resume <sessionId>` flag** in Claude command builder (`src/utils/command-builder.ts:93-99`)
  - This prevents tests from attempting to resume actual sessions
  - **Important:** If you're experiencing permission issues with forked sessions in production, ensure this is NOT set to `test`

### `IRIS_TEST_REMOTE`
- **Type:** Boolean flag (`1` = true)
- **Description:** Enables remote testing mode for integration tests
- **Special Behavior:** When set to `1`:
  - **Skips `--resume <sessionId>` flag** in Claude command builder (same as NODE_ENV=test)
  - Allows integration tests to run against remote SSH connections without session persistence
  - Used in test commands: `IRIS_TEST_REMOTE=1 pnpm test:integration`
- **Important:** Ensure this is NOT set when running production forks or you'll get fresh sessions instead of resuming existing ones

## Logging & Debugging

### `DEBUG`
- **Type:** Boolean flag (any truthy value)
- **Description:** Enables debug-level logging
- **Used by:** `src/utils/logger.ts`
- **Output:** Debug logs go to stderr in JSON format

## Configuration Interpolation

Environment variables can be interpolated in `config.yaml` using the syntax:
```yaml
${ENV_VAR_NAME}           # Required - throws error if not set
${ENV_VAR_NAME:-default}  # Optional - uses default if not set
```

**Example:**
```yaml
settings:
  httpPort: ${IRIS_HTTP_PORT:-1615}
  idleTimeout: ${IRIS_IDLE_TIMEOUT:-300000}

teams:
  production:
    path: ${PROD_PATH}  # Required - must be set in environment
```

## Common Issues

### Forked Sessions Not Resuming

**Symptom:** When using `team_fork`, the new terminal starts a fresh Claude session instead of resuming the existing one.

**Cause:** Either `NODE_ENV=test` or `IRIS_TEST_REMOTE=1` is set in your shell environment.

**Solution:**
```bash
# Check your environment
echo $NODE_ENV
echo $IRIS_TEST_REMOTE

# Unset if present
unset NODE_ENV
unset IRIS_TEST_REMOTE
```

**Why:** These variables disable the `--resume <sessionId>` flag to allow tests to run without session persistence. This was added to pacify unit tests but has the side effect of preventing session resumption in production usage.

**Code Reference:** `src/utils/command-builder.ts:93-99`
