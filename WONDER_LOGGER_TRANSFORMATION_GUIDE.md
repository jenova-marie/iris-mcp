# Wonder Logger Transformation Quick Reference

## Import Changes

### Before
```typescript
import { Logger } from '../utils/logger.js';
```

### After
```typescript
import { getChildLogger } from '../utils/logger.js';
```

## Instantiation Changes

### Before
```typescript
const logger = new Logger('pool');
const logger = new Logger('mcp:tell');
const logger = new Logger('process:frontend');
```

### After
```typescript
const logger = getChildLogger('pool');
const logger = getChildLogger('mcp:tell');
const logger = getChildLogger('process:frontend');
```

## Logging Call Transformations

### Simple Messages (No Metadata)

#### Before
```typescript
logger.info("Starting process");
logger.warn("No response");
logger.error("Failed to connect");
```

#### After (No Change Needed!)
```typescript
logger.info("Starting process");
logger.warn("No response");
logger.error("Failed to connect");
```

### Messages with Metadata

#### Before
```typescript
logger.info("Creating new process", { poolKey, teamName, sessionId });

logger.debug("Using session for team pair", {
  fromTeam,
  toTeam: teamName,
  sessionId,
});

logger.warn("Process not found", { teamName });
```

#### After (REVERSE PARAMETERS)
```typescript
logger.info({ poolKey, teamName, sessionId }, "Creating new process");

logger.debug({
  fromTeam,
  toTeam: teamName,
  sessionId,
}, "Using session for team pair");

logger.warn({ teamName }, "Process not found");
```

### Error Logging

#### Before
```typescript
logger.error("Failed to send message", {
  error: error instanceof Error ? error.message : error,
  stack: error instanceof Error ? error.stack : undefined,
  toTeam,
  fromTeam,
});

logger.error("Process spawn failed", error);
```

#### After (Use `err` key)
```typescript
logger.error({
  err: error,  // Pino will serialize this automatically
  toTeam,
  fromTeam,
}, "Failed to send message");

logger.error({ err: error }, "Process spawn failed");
```

## Pattern Matching Regex

### Find all logger instantiations
```regex
new Logger\(['"]([^'"]+)['"]\)
```
Replace with: `getChildLogger('$1')`

### Find calls with metadata (manual review needed)
```regex
logger\.(info|warn|debug|error)\(['"]([^'"]+)['"],\s*\{
```
These need parameter reversal

## Real-World Examples from Iris Codebase

### Example 1: src/process-pool/pool-manager.ts:74-78

#### Before
```typescript
this.logger.debug("Using session for team pair", {
  fromTeam,
  toTeam: teamName,
  sessionId,
});
```

#### After
```typescript
this.logger.debug({
  fromTeam,
  toTeam: teamName,
  sessionId,
}, "Using session for team pair");
```

### Example 2: src/process-pool/pool-manager.ts:99-103

#### Before
```typescript
this.logger.info("Creating new process", {
  poolKey,
  teamName,
  sessionId,
});
```

#### After
```typescript
this.logger.info({
  poolKey,
  teamName,
  sessionId,
}, "Creating new process");
```

### Example 3: src/actions/tell.ts:109-116

#### Before
```typescript
logger.info("Sending message to team", {
  from: fromTeam,
  to: toTeam,
  async: !waitForResponse,
  timeout: actualTimeout,
  messageLength: message.length,
  messagePreview: message.substring(0, 50),
});
```

#### After
```typescript
logger.info({
  from: fromTeam,
  to: toTeam,
  async: !waitForResponse,
  timeout: actualTimeout,
  messageLength: message.length,
  messagePreview: message.substring(0, 50),
}, "Sending message to team");
```

### Example 4: src/actions/tell.ts:194-200 (Error)

#### Before
```typescript
logger.error("Failed to send message to team", {
  error: error instanceof Error ? error.message : error,
  stack: error instanceof Error ? error.stack : undefined,
  toTeam,
  fromTeam,
});
```

#### After
```typescript
logger.error({
  err: error,  // Pino serializes Error objects automatically
  toTeam,
  fromTeam,
}, "Failed to send message to team");
```

### Example 5: src/process-pool/pool-manager.ts:148-153 (Error with custom message)

#### Before
```typescript
this.logger.error("Process spawn failed, cleaning up", {
  poolKey,
  teamName,
  sessionId,
  error: error instanceof Error ? error.message : String(error),
});
```

#### After
```typescript
this.logger.error({
  err: error,  // Let Pino handle serialization
  poolKey,
  teamName,
  sessionId,
}, "Process spawn failed, cleaning up");
```

## Edge Cases

### Multiline Object Formatting

Keep multiline metadata objects readable:

#### Before
```typescript
logger.debug("Pool state snapshot", {
  context,
  totalProcesses: status.totalProcesses,
  maxProcesses: status.maxProcesses,
  activeSessions: status.activeSessions,
  processes: Object.entries(status.processes).map(([key, proc]) => ({
    poolKey: key,
    status: proc.status,
  })),
});
```

#### After
```typescript
logger.debug({
  context,
  totalProcesses: status.totalProcesses,
  maxProcesses: status.maxProcesses,
  activeSessions: status.activeSessions,
  processes: Object.entries(status.processes).map(([key, proc]) => ({
    poolKey: key,
    status: proc.status,
  })),
}, "Pool state snapshot");
```

### Conditional Logging

No change to conditional structure:

#### Before & After (Same)
```typescript
if (process.env.DEBUG) {
  logger.debug({ state }, "Current state");
}
```

### Dynamic Messages

#### Before
```typescript
logger.info(`Process ${teamName} started`);
logger.info(`Process ${teamName} started`, { pid });
```

#### After
```typescript
logger.info(`Process ${teamName} started`);
logger.info({ pid }, `Process ${teamName} started`);
```

## Testing Verification

After converting a file, verify:

1. **TypeScript compiles**: `pnpm build`
2. **Tests pass**: `pnpm test:unit src/path/to/file.test.ts`
3. **Manual check**: Run server and check log output format
4. **Grep check**: Ensure no old patterns remain
   ```bash
   # Should return 0 results for converted file
   grep -n 'logger\.\(info\|warn\|debug\|error\)("[^"]*", {' src/path/to/file.ts
   ```

## Common Mistakes to Avoid

1. **Forgetting to reverse parameters** - Most common error!
   ```typescript
   // WRONG
   logger.info("Message", { data });

   // RIGHT
   logger.info({ data }, "Message");
   ```

2. **Using wrong error key**
   ```typescript
   // WRONG
   logger.error({ error: err }, "Failed");

   // RIGHT
   logger.error({ err }, "Failed");
   ```

3. **Manually serializing errors** - Pino does this automatically
   ```typescript
   // WRONG - unnecessary
   logger.error({
     err: error instanceof Error ? error.message : String(error)
   }, "Failed");

   // RIGHT - Pino handles it
   logger.error({ err: error }, "Failed");
   ```

4. **Forgetting to update imports**
   ```typescript
   // WRONG - old import
   import { Logger } from '../utils/logger.js';
   const logger = getChildLogger('foo'); // getChildLogger not imported!

   // RIGHT
   import { getChildLogger } from '../utils/logger.js';
   const logger = getChildLogger('foo');
   ```

## Phase 1 Implementation (src/utils/logger.ts)

This will be the new logger.ts:

```typescript
/**
 * Iris MCP - Wonder Logger Integration
 * Provides Wonder Logger instance with child logger factory
 */

import { createLoggerFromConfig } from '@recoverysky/wonder-logger';
import type { Logger as PinoLogger } from 'pino';

// Global logger instance (initialized once at startup)
let globalLogger: PinoLogger | null = null;

/**
 * Initialize Wonder Logger from config
 * Call this once at application startup (in index.ts or iris.ts)
 */
export function initializeLogger(): PinoLogger {
  if (globalLogger) {
    return globalLogger;
  }

  globalLogger = createLoggerFromConfig({
    configPath: './wonder-logger.yaml',
    required: true,
  });

  return globalLogger;
}

/**
 * Get child logger with context
 * Replaces: new Logger('context')
 */
export function getChildLogger(context: string): PinoLogger {
  if (!globalLogger) {
    // Auto-initialize if not done yet
    initializeLogger();
  }

  return globalLogger!.child({ context });
}

/**
 * Get base logger instance
 */
export function getLogger(): PinoLogger {
  if (!globalLogger) {
    initializeLogger();
  }

  return globalLogger!;
}

// For backwards compatibility during migration
export { PinoLogger as Logger };

// Export types
export type { LogLevel } from 'pino';
```

---

**Usage**: Reference this guide while converting each file. Copy the relevant "After" patterns for common scenarios.
