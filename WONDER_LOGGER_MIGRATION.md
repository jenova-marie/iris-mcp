# Wonder Logger Migration Analysis

## Executive Summary

**This is NOT a 1:1 conversion.** All 292 logging statements across 33 files will need to be updated due to fundamental API differences between the current logger and Wonder Logger (Pino).

## Current State

### Current Logger API (`src/utils/logger.ts`)
```typescript
// Construction
const logger = new Logger('pool'); // context passed to constructor

// Usage
logger.debug(message, meta);
logger.info(message, meta);
logger.warn(message, meta);
logger.error(message, error);

// Output: Logs to stderr as JSON
```

### Statistics
- **33 files** with `new Logger()` instantiations
- **292 logging statements** (debug/info/warn/error calls)
- All logs go to **stderr** (MCP protocol requirement)

## Target State

### Wonder Logger API (Pino-based)
```typescript
// Configuration-based initialization (once at startup)
import { createLoggerFromConfig } from '@recoverysky/wonder-logger';
const baseLogger = createLoggerFromConfig(); // Loads wonder-logger.yaml

// Child logger with context
const logger = baseLogger.child({ context: 'pool' });

// Usage - NOTE: PARAMETERS ARE REVERSED!
logger.debug({ meta }, message);
logger.info({ meta }, message);
logger.warn({ meta }, message);
logger.error({ err: error }, message); // errors use 'err' key by convention

// Output: Configurable via wonder-logger.yaml (console, file, OTEL)
```

## Key API Differences

### 1. Parameter Order (BREAKING)
```typescript
// Current
logger.info("Creating new process", { poolKey, teamName });

// Wonder Logger (Pino)
logger.info({ poolKey, teamName }, "Creating new process");
```
**Impact**: All 292 logging calls must be updated

### 2. Context Handling (BREAKING)
```typescript
// Current
const logger = new Logger('pool'); // context in constructor

// Wonder Logger
const logger = baseLogger.child({ context: 'pool' }); // child logger pattern
```
**Impact**: All 33 logger instantiations must be updated

### 3. Error Handling (MINOR)
```typescript
// Current
logger.error("Failed", error); // any error object

// Wonder Logger (Pino convention)
logger.error({ err: error }, "Failed"); // must use 'err' key for serialization
```
**Impact**: ~50-60 error logging calls need adjustment

### 4. Stream Destination (CONFIGURATION)
```typescript
// Current: Hardcoded to stderr
console.error(JSON.stringify(entry));

// Wonder Logger: Configured in wonder-logger.yaml
transports:
  - type: console
    pretty: false
    # Pino console transport logs to stdout by default
    # Need custom config to use stderr for MCP protocol
```
**Impact**: Must ensure console transport targets stderr

## Configuration Requirements

### wonder-logger.yaml Adjustments Needed

Your current config has:
```yaml
transports:
  - type: console
    pretty: ${LOG_PRETTY:-false}
```

But MCP protocol requires logs on **stderr**. Need to verify Wonder Logger's console transport targets stderr. If not, we'll need:

```yaml
transports:
  - type: file  # Use file transport instead
    dir: ./logs
    fileName: iris.log
  # OTEL transport is fine
  - type: otel
    endpoint: ${OTEL_LOGS_ENDPOINT:-http://localhost:4318/v1/logs}
```

## Migration Strategy

### Proposed Phased Approach

#### Phase 1: Infrastructure Setup
1. Create global logger instance in `src/utils/logger.ts`
2. Initialize Wonder Logger from config at startup
3. Export factory function for child loggers
4. Keep old Logger class for backwards compatibility (mark deprecated)
5. Verify stderr output works correctly with MCP protocol

#### Phase 2: Core Modules (Session-Based Architecture)
Convert in dependency order:
1. `src/iris.ts` - Main orchestrator
2. `src/session/session-manager.ts` - Session management
3. `src/session/session-store.ts` - Session storage
4. `src/cache/cache-manager.ts` - Cache coordination
5. `src/process-pool/pool-manager.ts` - Process pool

#### Phase 3: Process & Cache Modules
6. `src/process-pool/claude-process.ts` - Individual processes
7. `src/cache/cache-entry.ts` - Cache entries
8. `src/cache/cache-session.ts` - Cache sessions

#### Phase 4: MCP Actions (alphabetically)
9. `src/actions/tell.ts`
10. `src/actions/wake.ts`
11. `src/actions/sleep.ts`
12. `src/actions/isAwake.ts`
13. `src/actions/wake-all.ts`
14. `src/actions/report.ts`
15. `src/actions/teams.ts`
16. `src/actions/command.ts`
17. `src/actions/getTeamName.ts`

#### Phase 5: Servers & Config
18. `src/mcp_server.ts` - MCP server
19. `src/web_server.ts` - Web server
20. `src/config/teams-config.ts` - Config manager
21. `src/dashboard/server/*.ts` - Dashboard routes (3 files)

#### Phase 6: CLI & Supporting Modules
22. `src/cli/commands/*.ts` - CLI commands (3 files)
23. `src/session/validation.ts`
24. `src/session/metrics.ts`

#### Phase 7: Tests & Cleanup
25. Update `tests/unit/utils/logger.test.ts`
26. Update `tests/integration/actions/output-cache.test.ts`
27. Remove deprecated Logger class
28. Update documentation

### Per-File Conversion Checklist

For each file:
- [ ] Replace `import { Logger } from '../utils/logger'` with child logger import
- [ ] Replace `new Logger(context)` with `createChildLogger(context)`
- [ ] Reverse all logging call parameters: `(message, meta)` → `(meta, message)`
- [ ] Update error calls to use `{ err: error }` convention
- [ ] Run type checks: `pnpm build`
- [ ] Run tests if available
- [ ] Commit with descriptive message

## Testing Strategy

After each phase:
1. **Type Check**: `pnpm build` (TypeScript compilation)
2. **Unit Tests**: `pnpm test:unit` (if tests exist for converted modules)
3. **Integration Test**: Start MCP server and verify logs appear in correct location
4. **Manual Verification**:
   - Check logs are JSON formatted
   - Verify stderr output (not stdout)
   - Confirm trace context injection works (if OTEL enabled)
   - Test log levels work as expected

## Risks & Mitigations

### Risk 1: MCP Protocol Break (CRITICAL)
**Problem**: Logs leak to stdout, breaking MCP JSON-RPC protocol
**Mitigation**:
- Test immediately after Phase 1
- Verify `wonder-logger.yaml` console transport targets stderr
- Fall back to file transport if needed

### Risk 2: Context Loss
**Problem**: Context strings scattered across files, easy to miss/typo
**Mitigation**:
- Use constants for context names
- Create helper that validates context names
- Grep for old pattern after each phase

### Risk 3: Test Breakage
**Problem**: Tests may depend on old logger's behavior
**Mitigation**:
- Update test fixtures as we go
- Phase 7 dedicated to test updates
- Consider using memory transport for tests

### Risk 4: Error Serialization
**Problem**: Pino's error serializer may differ from current custom logic
**Mitigation**:
- Review current error formatting in `src/utils/logger.ts:41-65`
- Configure Pino serializers if needed
- Test error logging thoroughly

## Rollback Plan

If critical issues arise:
1. Keep old `Logger` class in place during entire migration
2. Each phase is atomic - can revert individual commits
3. Feature flag option:
```typescript
const USE_WONDER_LOGGER = process.env.USE_WONDER_LOGGER === 'true';
export const createChildLogger = USE_WONDER_LOGGER
  ? createWonderChildLogger
  : createLegacyLogger;
```

## Benefits of Migration

1. **OpenTelemetry Integration**: Automatic trace context in logs (trace_id, span_id)
2. **Multiple Transports**: Console, file, and OTEL simultaneously
3. **Better Performance**: Pino is one of the fastest Node.js loggers
4. **Unified Config**: Single YAML for all observability (logs, traces, metrics)
5. **Production Ready**: Battle-tested with redaction, serialization, etc.
6. **Future Extensibility**: Easy to add new transports/exporters

## Recommendation

**Proceed with phased migration** as outlined above. The work is substantial (292 calls to update) but necessary to gain the benefits of Wonder Logger. The phased approach allows us to:

- Test incrementally
- Catch issues early
- Maintain working state at each checkpoint
- Roll back easily if needed

**Estimated Effort**:
- Phase 1 (infrastructure): 2-3 hours
- Phases 2-6 (conversions): 6-8 hours (15-20 min per file average)
- Phase 7 (tests/cleanup): 2-3 hours
- **Total**: ~10-14 hours of focused work

## Open Questions for Discussion

1. **stderr requirement**: Should we use file transport instead of console to guarantee MCP protocol compliance?
2. **Context naming**: Standardize context names now, or keep existing strings?
3. **Error serialization**: Keep custom logic or trust Pino's defaults?
4. **Testing strategy**: Update tests as we go, or all at end?
5. **Rollback strategy**: Feature flag, or commit-based rollback?
6. **Timeline**: Convert over multiple sessions, or block time for full migration?

---

**Next Steps**: Review this analysis and discuss open questions before proceeding with Phase 1.
