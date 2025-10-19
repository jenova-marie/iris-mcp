# Observability Architecture: RxJS Migration

This document describes the reactive observability architecture in Iris MCP, the RxJS migration strategy, and the rationale for maintaining EventEmitter bridges.

## Table of Contents

- [Overview](#overview)
- [Architecture Layers](#architecture-layers)
- [RxJS Implementation](#rxjs-implementation)
- [Event Name Type Safety](#event-name-type-safety)
- [EventEmitter Bridges](#eventemitter-bridges)
- [Migration Strategy](#migration-strategy)
- [Status Observable Flow](#status-observable-flow)
- [Error Observable Flow](#error-observable-flow)
- [Iris Orchestrator Integration](#iris-orchestrator-integration)

## Overview

Iris MCP uses a **hybrid reactive architecture** combining RxJS observables at the core layers with EventEmitter bridges for consumer compatibility. This approach provides:

- **Type-safe reactive streams** for status and error propagation
- **Single source of truth** via BehaviorSubjects
- **Backward compatibility** via EventEmitter bridges
- **Memory safety** through proper subscription management
- **Progressive enhancement** without breaking changes

## Architecture Layers

The codebase uses a **three-tier reactive architecture**:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Transport (Pure RxJS)                         │
│  - LocalTransport, SSHTransport                         │
│  - Emits: status$, errors$                              │
│  - NO EventEmitter                                      │
└──────────────────┬──────────────────────────────────────┘
                   │ subscribes to observables
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: ClaudeProcess (RxJS + EventEmitter bridge)    │
│  - Subscribes to transport.status$, transport.errors$   │
│  - Emits: status$, errors$                              │
│  - ALSO emits EventEmitter events for backward compat   │
└──────────────────┬──────────────────────────────────────┘
                   │ subscribes to observables
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: ProcessPool (RxJS + EventEmitter bridge)      │
│  - Subscribes to process.status$, process.errors$       │
│  - Maps ProcessStatus → cleanup actions                 │
│  - ALSO emits EventEmitter events for consumers         │
└──────────────────┬──────────────────────────────────────┘
                   │ .on("process-terminated"), etc.
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Consumers: mcp_server, Dashboard, Iris                 │
│  - Listen to EventEmitter events                        │
│  - Simple event-based logging/forwarding                │
└─────────────────────────────────────────────────────────┘
```

## RxJS Implementation

### Transport Layer (Pure RxJS)

All transports expose two observables:

```typescript
export interface Transport {
  /**
   * Observable stream of transport status changes
   * BehaviorSubject - emits current status immediately on subscription
   */
  status$: Observable<TransportStatus>;

  /**
   * Observable stream of transport errors
   * Subject - emits errors as they occur (no initial value)
   */
  errors$: Observable<Error>;
}
```

**TransportStatus Lifecycle:**
```
STOPPED → CONNECTING → SPAWNING → READY → BUSY → READY → TERMINATING → STOPPED
```

**Example: LocalTransport**
```typescript
export class LocalTransport implements Transport {
  private statusSubject = new BehaviorSubject<TransportStatus>(Status.STOPPED);
  public status$: Observable<TransportStatus>;

  private errorsSubject = new Subject<Error>();
  public errors$: Observable<Error>;

  constructor(...) {
    this.status$ = this.statusSubject.asObservable();
    this.errors$ = this.errorsSubject.asObservable();
  }

  async spawn(...) {
    this.statusSubject.next(Status.SPAWNING);
    // ... spawn logic ...
    this.statusSubject.next(Status.READY);
  }

  executeTell(...) {
    this.statusSubject.next(Status.BUSY);
    // ... execution logic ...
    // When result received:
    this.statusSubject.next(Status.READY);
  }

  async terminate() {
    this.statusSubject.next(Status.TERMINATING);
    // ... cleanup ...
    this.statusSubject.next(Status.STOPPED);
    this.statusSubject.complete();
    this.errorsSubject.complete();
  }
}
```

### ClaudeProcess Layer (RxJS + Bridge)

ClaudeProcess subscribes to Transport observables and:
1. Maps `TransportStatus` → `ProcessStatus`
2. Exposes its own observables (`status$`, `errors$`)
3. Maintains EventEmitter bridge for backward compatibility

```typescript
export class ClaudeProcess extends EventEmitter {
  private statusSubject = new BehaviorSubject<ProcessStatus>(ProcessStatus.STOPPED);
  public status$: Observable<ProcessStatus>;

  private errorsSubject = new Subject<Error>();
  public errors$: Observable<Error>;

  private subscriptions: Subscription[] = [];

  constructor(...) {
    super();
    this.status$ = this.statusSubject.asObservable();
    this.errors$ = this.errorsSubject.asObservable();

    this.transport = TransportFactory.create(...);
    this.setupTransportSubscriptions();
  }

  private setupTransportSubscriptions(): void {
    // Subscribe to transport status and map to process status
    const statusSub = this.transport.status$.subscribe((transportStatus) => {
      switch (transportStatus) {
        case TransportStatus.STOPPED:
          this.statusSubject.next(ProcessStatus.STOPPED);
          break;
        case TransportStatus.CONNECTING:
        case TransportStatus.SPAWNING:
          this.statusSubject.next(ProcessStatus.SPAWNING);
          break;
        case TransportStatus.READY:
          this.statusSubject.next(ProcessStatus.IDLE);
          break;
        case TransportStatus.BUSY:
          this.statusSubject.next(ProcessStatus.PROCESSING);
          break;
      }
    });

    // Subscribe to transport errors and forward
    const errorsSub = this.transport.errors$.subscribe((error) => {
      this.errorsSubject.next(error);
      // EventEmitter bridge for backward compatibility
      this.emit("process-error", { teamName: this.teamName, error });
    });

    this.subscriptions.push(statusSub, errorsSub);
  }

  async terminate(): Promise<void> {
    // Cleanup subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    await this.transport.terminate();

    // Complete observables
    this.statusSubject.complete();
    this.errorsSubject.complete();
  }
}
```

### ProcessPool Layer (RxJS + Bridge)

ProcessPool subscribes to ClaudeProcess observables and:
1. Manages process lifecycle based on status changes
2. Cleans up on `ProcessStatus.STOPPED`
3. Emits EventEmitter events for consumers

```typescript
export class ClaudeProcessPool extends EventEmitter {
  private processSubscriptions = new Map<string, Subscription[]>();

  private setupProcessSubscriptions(
    process: ClaudeProcess,
    poolKey: string,
    sessionId: string,
  ): void {
    const subscriptions: Subscription[] = [];

    // Subscribe to process status changes
    const statusSub = process.status$.subscribe((status) => {
      if (status === ProcessStatus.STOPPED) {
        // Clean up subscriptions
        const subs = this.processSubscriptions.get(poolKey);
        if (subs) {
          subs.forEach(sub => sub.unsubscribe());
          this.processSubscriptions.delete(poolKey);
        }

        // Clean up from pool
        this.processes.delete(poolKey);
        this.sessionToProcess.delete(sessionId);
        this.removeFromAccessOrder(poolKey);

        // EventEmitter bridge for backward compatibility
        this.emit(PoolEvent.PROCESS_TERMINATED, { teamName: process.teamName });
      }
    });

    // Subscribe to process errors
    const errorsSub = process.errors$.subscribe((error) => {
      // EventEmitter bridge for backward compatibility
      this.emit(PoolEvent.PROCESS_ERROR, {
        teamName: process.teamName,
        error,
      });
    });

    subscriptions.push(statusSub, errorsSub);
    this.processSubscriptions.set(poolKey, subscriptions);
  }
}
```

## Event Name Type Safety

To prevent typos and improve type safety, all ProcessPool events use an enum:

```typescript
// src/process-pool/types.ts
export enum PoolEvent {
  PROCESS_TERMINATED = "process-terminated",
  PROCESS_ERROR = "process-error",
  HEALTH_CHECK = "health-check",
}
```

**Usage:**
```typescript
// Emitter (type-safe)
this.emit(PoolEvent.PROCESS_TERMINATED, data);

// Listener (type-safe)
pool.on(PoolEvent.PROCESS_TERMINATED, handler);

// Compiler prevents typos
pool.on("process-spawned", handler);  // Won't happen - we use enum!
```

**Why not full type safety?**
EventEmitter itself doesn't enforce enum types at the TypeScript level (it accepts any string). However, by consistently using the enum in our codebase:
- IDE autocomplete suggests valid event names
- Refactoring is safe (rename enum value once)
- Code review catches string literals
- Convention prevents typos

## EventEmitter Bridges

### Why Keep EventEmitter Bridges?

The codebase maintains EventEmitter bridges at ProcessPool and ClaudeProcess levels for several reasons:

**1. Consumer Simplicity**
- `mcp_server` uses events for **simple logging only**
- `DashboardStateBridge` uses events for **WebSocket forwarding**
- Neither consumer needs reactive complexity

**2. Minimal Overhead**
- EventEmitter forwarding adds negligible performance cost
- Events are only emitted on significant state changes (terminate, error)
- No memory leaks - subscriptions properly cleaned up

**3. Isolation & Flexibility**
- Core layers (Transport, ClaudeProcess, ProcessPool) are fully reactive
- Consumers can be migrated to RxJS incrementally if needed
- Bridges provide clean abstraction boundary

**4. No Breaking Changes**
- mcp_server and Dashboard continue working unchanged
- Tests continue passing without modification
- Safe, progressive migration strategy

### What Events Are Bridged?

**ProcessPool emits:**
- `PoolEvent.PROCESS_TERMINATED` - When process stops (any reason)
- `PoolEvent.PROCESS_ERROR` - When process encounters error
- `PoolEvent.HEALTH_CHECK` - Periodic health check results

**ClaudeProcess emits (legacy, should be removed eventually):**
- `"process-spawned"` - When process starts (forwarded from Transport)
- `"process-exited"` - When process exits (forwarded from Transport)
- `"process-error"` - When process errors (forwarded from Transport)
- `"process-terminated"` - When process terminates (forwarded from Transport)
- `"message-response"` - When message completes (for tests)

**Note:** ClaudeProcess EventEmitter forwarding from Transport is deprecated since Transport no longer emits EventEmitter events. These forwarders should be removed in a future cleanup.

### Consumer Usage Examples

**mcp_server (simple logging):**
```typescript
private setupEventListeners(): void {
  this.processPool.on(PoolEvent.PROCESS_TERMINATED, (data) => {
    logger.info(data, "Process terminated");
  });

  this.processPool.on(PoolEvent.PROCESS_ERROR, (data) => {
    logger.error({ err: data.error }, "Process error");
  });
}
```

**DashboardStateBridge (WebSocket forwarding):**
```typescript
private setupEventForwarding(): void {
  this.pool.on(PoolEvent.PROCESS_TERMINATED, (data) => {
    this.emit("ws:process-status", {
      teamName: data.teamName,
      status: "stopped",
    });
  });

  this.pool.on(PoolEvent.PROCESS_ERROR, (data) => {
    this.emit("ws:process-error", {
      teamName: data.teamName,
      error: data.error.message,
    });
  });
}
```

## Migration Strategy

The RxJS migration followed a **progressive enhancement strategy** with backward compatibility at each layer:

### Phase 1: Transport Layer
1. ✅ Added `status$` and `errors$` observables to Transport interface
2. ✅ Implemented observables in LocalTransport, SSHTransport
3. ✅ Removed all EventEmitter code from transports
4. ✅ Kept Transport interface stable

### Phase 2: ClaudeProcess & ProcessPool
1. ✅ Added `status$` and `errors$` to ClaudeProcess
2. ✅ ClaudeProcess subscribes to Transport observables
3. ✅ ProcessPool subscribes to ClaudeProcess observables
4. ✅ Maintained EventEmitter bridges for consumers
5. ✅ Fixed event name bug (mcp_server listening to non-existent events)

### Phase 3: Type Safety (Current)
1. ✅ Created `PoolEvent` enum for event names
2. ✅ Updated all emit/on calls to use enum
3. ✅ Removed broken event listeners (non-existent events)

### Phase 4: Future (Optional)
- Convert mcp_server to use observables (low priority - logging is simple)
- Convert DashboardStateBridge to use observables (low priority - forwarding is simple)
- Remove EventEmitter bridges from ProcessPool
- Remove EventEmitter forwarding from ClaudeProcess
- Pure RxJS stack end-to-end

**Decision:** Keep bridges indefinitely. The reactive core provides all benefits, and bridges have no downsides.

## Status Observable Flow

### Complete Lifecycle Example

```
User calls send_message → Iris orchestrator → ProcessPool → ClaudeProcess → Transport
```

**Status propagation (reactive):**
```
1. Transport:      STOPPED
2. User action:    send_message("frontend", "backend", "hello")
3. Transport:      SPAWNING
   ↓ observable
4. ClaudeProcess:  SPAWNING
   ↓ observable
5. ProcessPool:    (observes SPAWNING, no action)

6. Transport:      READY (after init message)
   ↓ observable
7. ClaudeProcess:  IDLE
   ↓ observable
8. ProcessPool:    (observes IDLE, no action)

9. Transport:      BUSY (executeTell called)
   ↓ observable
10. ClaudeProcess: PROCESSING
    ↓ observable
11. ProcessPool:   (observes PROCESSING, no action)

12. Transport:     READY (result message received)
    ↓ observable
13. ClaudeProcess: IDLE
    ↓ observable
14. ProcessPool:   (observes IDLE, process available)

15. User calls:    team_sleep("backend")
16. Transport:     TERMINATING
    ↓ observable
17. ClaudeProcess: (no status change during termination)
    ↓ observable
18. ProcessPool:   (observes TERMINATING, no action)

19. Transport:     STOPPED
    ↓ observable
20. ClaudeProcess: STOPPED
    ↓ observable
21. ProcessPool:   CLEANUP (unsubscribe, delete from pool, emit event)
    ↓ EventEmitter
22. mcp_server:    Log "Process terminated"
```

### Key Points

- **Status flows via observables** through each layer
- **ProcessPool only acts on STOPPED** (cleanup trigger)
- **EventEmitter used only for final consumer notification**
- **Single source of truth**: BehaviorSubject at each layer

## Error Observable Flow

### Error Propagation Example

```
1. Transport:      Error occurs (SSH connection failed)
   ↓ errors$ observable
2. ClaudeProcess:  Receives error via transport.errors$ subscription
   - Emits to errors$ observable
   - ALSO emits "process-error" EventEmitter event (bridge)
   ↓ errors$ observable
3. ProcessPool:    Receives error via process.errors$ subscription
   - Logs error
   - Emits PoolEvent.PROCESS_ERROR (bridge)
   ↓ EventEmitter
4. mcp_server:     Logs error to console
5. Dashboard:      Forwards error to WebSocket clients
```

### Error Handling Best Practices

```typescript
// Transport layer - emit to errors$
this.errorsSubject.next(new ProcessError("SSH connection failed", this.teamName));

// ClaudeProcess - subscribe and forward
this.transport.errors$.subscribe((error) => {
  this.errorsSubject.next(error);  // Observable
  this.emit("process-error", { teamName: this.teamName, error });  // Bridge
});

// ProcessPool - subscribe and forward
process.errors$.subscribe((error) => {
  this.logger.error({ err: error }, "Process error");
  this.emit(PoolEvent.PROCESS_ERROR, { teamName: process.teamName, error });  // Bridge
});

// Consumer - simple EventEmitter listener
pool.on(PoolEvent.PROCESS_ERROR, (data) => {
  logger.error({ err: data.error }, "Process error");
});
```

## Iris Orchestrator Integration

Iris Orchestrator (`src/iris.ts`) is the **business logic brain** that:
- Orchestrates process lifecycle
- Manages completion detection
- Handles timeout logic (two-timeout architecture)
- Coordinates cache and sessions

### Iris Uses RxJS Internally

Iris uses RxJS extensively for reactive coordination:

```typescript
export class IrisOrchestrator {
  private responseSubscriptions = new Map<string, Subscription>();

  async sendMessage(...): Promise<string | object> {
    // Create cache entry
    const tellEntry = messageCache.createEntry(CacheEntryType.TELL, message);

    // Subscribe to cache messages for completion detection
    const subscription = tellEntry.messages$
      .pipe(filter((msg) => msg.type === "result"))
      .subscribe(() => {
        this.handleTellCompletion(sessionId, tellEntry);
        subscription.unsubscribe();
      });

    this.responseSubscriptions.set(sessionId, subscription);

    // Execute tell (non-blocking)
    process.executeTell(tellEntry);

    // Wait for completion or timeout
    return this.waitForCompletion(sessionId, tellEntry, timeout);
  }

  private async waitForCompletion(...): Promise<string | object> {
    return new Promise((resolve) => {
      // Subscribe to result message
      const subscription = cacheEntry.messages$
        .pipe(filter((msg) => msg.type === "result"))
        .subscribe(() => {
          const response = this.extractFullResponse(cacheEntry);
          resolve(response);
        });
    });
  }
}
```

### Iris Does NOT Use ProcessPool Events

**Important:** Iris does **NOT** listen to ProcessPool events. Instead, Iris:

1. **Calls methods directly** on ProcessPool and ClaudeProcess
2. **Subscribes to cache observables** (`tellEntry.messages$`)
3. **Manages timeouts independently** via internal timers
4. **Updates session state** via SessionManager

**Why?** Iris is the orchestrator - it drives behavior, not reacts to events. The event-based approach is for **observational consumers** (logging, monitoring, dashboards), not for **business logic**.

### Two-Timeout Architecture

Iris implements a sophisticated two-timeout system:

**1. Response Timeout (from config, default 120s)**
- Detects stalled Claude responses
- Resets on each message received
- Triggers process recreation on timeout
- Iris's responsibility, NOT ClaudeProcess

**2. MCP Timeout (from caller)**
- Controls how long caller waits
- `-1`: Async mode (return immediately)
- `0`: Wait indefinitely
- `N`: Wait N ms, then return partial results

```typescript
// Response timeout - resets on each message
const subscription = cacheEntry.messages$.subscribe((msg) => {
  resetTimer(); // Reset timeout on each message

  if (msg.type === "result") {
    this.handleTellCompletion(sessionId, cacheEntry);
  }
});

// MCP timeout - controls caller wait
if (mcpTimeout > 0) {
  setTimeout(() => {
    resolve({
      status: "mcp_timeout",
      partialResponse: this.extractPartialResponse(cacheEntry),
    });
  }, mcpTimeout);
}
```

**Key insight:** Both timeouts use **RxJS subscriptions** to `cacheEntry.messages$`, NOT ProcessPool events. This keeps business logic decoupled from event system.

## Summary

### Architecture Benefits

✅ **Reactive Core**: Transport, ClaudeProcess, ProcessPool use RxJS observables
✅ **Type Safety**: PoolEvent enum prevents event name typos
✅ **Single Source of Truth**: BehaviorSubjects hold canonical state
✅ **Memory Safe**: Proper subscription cleanup prevents leaks
✅ **Backward Compatible**: EventEmitter bridges maintain existing consumers
✅ **Progressive**: Can migrate consumers incrementally (or never)
✅ **Decoupled**: Business logic (Iris) uses observables, monitoring uses events

### Design Decisions

1. **Keep EventEmitter bridges** - No performance cost, maintains simplicity for consumers
2. **Use enums for event names** - Type safety via conventions and IDE support
3. **RxJS at core, events at edges** - Reactive where it matters, simple where it doesn't
4. **Iris uses observables directly** - Business logic decoupled from event system
5. **Cleanup on STOPPED** - ProcessPool acts only on terminal status

### Migration Complete

The RxJS migration is **complete and production-ready**. The hybrid architecture provides all benefits of reactive programming while maintaining pragmatic bridges for consumers that don't need reactive complexity.

**No further migration needed** unless there's a specific requirement to convert mcp_server or Dashboard to RxJS (currently: no benefit, added complexity).
