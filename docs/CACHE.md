# Cache Subsystem Documentation

**Location:** `src/cache/`
**Purpose:** Event-driven message storage with RxJS observables
**Pattern:** Hierarchical storage with reactive notifications

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Component Details](#component-details)
4. [Message Flow](#message-flow)
5. [RxJS Integration](#rxjs-integration)
6. [Lifecycle Management](#lifecycle-management)
7. [API Reference](#api-reference)

---

## Overview

The Cache subsystem provides **persistent, event-driven storage** for Claude protocol messages. It implements a **hierarchical structure** that mirrors the system's organizational model:

- **CacheManager**: Singleton coordinator for all message caches
- **MessageCache**: One per team pair (fromTeam→toTeam)
- **CacheEntry**: One per operation (spawn ping or tell)
- **CacheMessage**: Individual protocol messages from Claude

**Key Innovation:** Uses **RxJS observables** to emit events when new messages arrive, enabling Iris to react in real-time without polling.

**Survivability:** Message caches **survive process crashes**, preserving partial responses for retrieval even after process recreation.

---

## Architecture

### Component Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                     CacheManager                              │
│                    (cache-manager.ts)                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ caches: Map<sessionId, MessageCache>                   │  │
│  │                                                        │  │
│  │ Methods:                                               │  │
│  │ • getOrCreateCache(sessionId, fromTeam, toTeam)       │  │
│  │ • getCache(sessionId)                                 │  │
│  │ • getAllCaches()                                       │  │
│  │ • destroyAll()                                         │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │ manages
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                     MessageCache                              │
│                   (message-cache.ts)                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ sessionId: string                                      │  │
│  │ fromTeam: string                                       │  │
│  │ toTeam: string                                         │  │
│  │ entries: CacheEntry[]                                  │  │
│  │                                                        │  │
│  │ Methods:                                               │  │
│  │ • createEntry(type, tellString) → CacheEntry          │  │
│  │ • getAllEntries()                                      │  │
│  │ • getEntriesByType(type)                               │  │
│  │ • getEntriesByStatus(status)                           │  │
│  │ • getStats()                                           │  │
│  │ • destroy()                                            │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │ contains
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                     CacheEntry                                │
│                   (cache-entry.ts)                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ cacheEntryType: SPAWN | TELL                           │  │
│  │ tellString: string                                     │  │
│  │ status: active | completed | terminated                │  │
│  │ messages: CacheMessage[]                               │  │
│  │ terminationReason?: TerminationReason                  │  │
│  │                                                        │  │
│  │ RxJS Observable:                                       │  │
│  │ • messages$: Observable<CacheMessage>                  │  │
│  │                                                        │  │
│  │ Write Methods (ClaudeProcess):                         │  │
│  │ • addMessage(data)                                     │  │
│  │                                                        │  │
│  │ Read Methods (Iris):                                   │  │
│  │ • getMessages()                                        │  │
│  │ • getLatestMessage()                                   │  │
│  │                                                        │  │
│  │ Lifecycle (Iris):                                      │  │
│  │ • complete()                                           │  │
│  │ • terminate(reason)                                    │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │ contains
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                   CacheMessage                                │
│                    (types.ts)                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ timestamp: number                                      │  │
│  │ type: "system" | "user" | "assistant" |                │  │
│  │       "stream_event" | "result" | "unknown"            │  │
│  │ data: any  (raw Claude protocol message)               │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/cache/
├── types.ts              # TypeScript interfaces, enums, types
├── cache-manager.ts      # Top-level manager (singleton)
├── message-cache.ts      # Per-team-pair cache
├── cache-entry.ts        # Per-operation cache with RxJS
└── README.md             # Future phase placeholder
```

---

## Component Details

### 1. CacheManager (cache-manager.ts)

**Responsibility:** Coordinate all cache sessions

**State:**
```typescript
class CacheManager {
  private caches = new Map<string, MessageCache>();
}
```

**Key Methods:**

```typescript
// Get or create message cache (called by Iris)
getOrCreateCache(
  sessionId: string,
  fromTeam: string,
  toTeam: string
): MessageCache

// Get existing cache
getCache(sessionId: string): MessageCache | null

// Get all caches (for monitoring)
getAllCaches(): MessageCache[]

// Aggregate statistics
getStats(): {
  totalSessions: number;
  totalEntries: number;
  sessionStats: Array<{
    sessionId: string;
    fromTeam: string;
    toTeam: string;
    entryCount: number;
    activeEntries: number;
    completedEntries: number;
  }>;
}

// Cleanup (shutdown)
destroyAll(): void
```

**Lifetime:** Lives for entire Iris process lifetime

**Thread Safety:** Not thread-safe (single-threaded Node.js)

---

### 2. MessageCache (message-cache.ts)

**Responsibility:** Manage cache entries for a specific team pair

**Identity:** One cache per `(fromTeam, toTeam)` pair
- `iris → alpha` = one cache
- `alpha → beta` = different cache
- Links to SessionInfo (persistent metadata) via sessionId

**State:**
```typescript
class MessageCache {
  readonly sessionId: string;
  readonly fromTeam: string;
  readonly toTeam: string;
  readonly createdAt: number;
  private entries: CacheEntry[] = [];
}
```

**Key Methods:**

```typescript
// Create new entry (for spawn or tell)
createEntry(
  cacheEntryType: CacheEntryType,
  tellString: string
): CacheEntry

// Get all entries (chronological)
getAllEntries(): CacheEntry[]

// Filter by type
getEntriesByType(type: CacheEntryType): CacheEntry[]

// Filter by status
getEntriesByStatus(status: CacheEntryStatus): CacheEntry[]

// Get latest entry
getLatestEntry(): CacheEntry | null

// Statistics
getStats(): {
  totalEntries: number;
  activeEntries: number;
  completedEntries: number;
  terminatedEntries: number;
  spawnEntries: number;
  tellEntries: number;
}

// Cleanup (called by CacheManager)
destroy(): void
```

**Example Usage:**
```typescript
// Iris creates entry for spawn
const spawnEntry = messageCache.createEntry(
  CacheEntryType.SPAWN,
  "ping"
);

// Pass to ClaudeProcess
await process.spawn(spawnEntry);

// Iris creates entry for tell
const tellEntry = messageCache.createEntry(
  CacheEntryType.TELL,
  "What is 2+2?"
);

// Subscribe to messages
tellEntry.messages$.subscribe(msg => {
  console.log('New message:', msg.type);
});

// Execute
process.executeTell(tellEntry);
```

---

### 3. CacheEntry (cache-entry.ts)

**Responsibility:** Store messages for a single operation with RxJS notifications

**Entry Types:**
- **SPAWN**: Initial ping to warm up process
- **TELL**: Actual user message

**State:**
```typescript
class CacheEntryImpl implements CacheEntry {
  readonly cacheEntryType: CacheEntryType;
  readonly tellString: string;
  readonly createdAt: number;

  status: CacheEntryStatus = CacheEntryStatus.ACTIVE;
  completedAt: number | null = null;
  terminationReason?: TerminationReason;

  private messages: CacheMessage[] = [];
  private messagesSubject = new Subject<CacheMessage>();
  public messages$: Observable<CacheMessage>;
}
```

**Write Methods (Called by ClaudeProcess - DUMB PIPE):**

```typescript
addMessage(data: any): void {
  // Only accept messages while active
  if (this.status !== CacheEntryStatus.ACTIVE) return;

  // Create message
  const message: CacheMessage = {
    timestamp: Date.now(),
    type: data.type || "unknown",
    data,  // Raw JSON from Claude
  };

  // Store
  this.messages.push(message);

  // 🔔 EMIT to RxJS subscribers
  this.messagesSubject.next(message);
}
```

**Read Methods (Called by Iris - BRAIN):**

```typescript
// Get all messages
getMessages(): CacheMessage[]

// Get most recent message
getLatestMessage(): CacheMessage | null
```

**Lifecycle Methods (Called by Iris - BRAIN):**

```typescript
// Mark as successfully completed
complete(): void {
  this.status = CacheEntryStatus.COMPLETED;
  this.completedAt = Date.now();
  this.messagesSubject.complete(); // Complete RxJS observable
}

// Mark as terminated (error/timeout)
terminate(reason: TerminationReason): void {
  this.status = CacheEntryStatus.TERMINATED;
  this.terminationReason = reason;
  this.completedAt = Date.now();
  this.messagesSubject.complete(); // Complete RxJS observable
}
```

**Observable:**
```typescript
messages$: Observable<CacheMessage>
```

**Example Subscription:**
```typescript
const subscription = cacheEntry.messages$.subscribe({
  next: (message) => {
    console.log(`Received: ${message.type}`);

    if (message.type === 'result') {
      console.log('Completed!');
    }
  },
  complete: () => {
    console.log('Observable completed (entry finished)');
  }
});

// Cleanup
subscription.unsubscribe();
```

---

### 4. CacheMessage (types.ts)

**Responsibility:** Immutable snapshot of a Claude protocol message

**Structure:**
```typescript
interface CacheMessage {
  timestamp: number;  // When message was added to cache
  type: "system" | "user" | "assistant" |
        "stream_event" | "result" | "unknown";
  data: any;  // Raw JSON from Claude (not parsed)
}
```

**Message Types:**
- `system`: System messages (e.g., `subtype: "init"`)
- `user`: User messages sent to Claude
- `assistant`: Assistant responses (text content)
- `stream_event`: Streaming progress events
- `result`: Final result with success/error
- `unknown`: Unrecognized message type

**Example Message Data:**
```json
{
  "timestamp": 1697567890123,
  "type": "assistant",
  "data": {
    "type": "assistant",
    "message": {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "The answer is 4."
        }
      ]
    }
  }
}
```

---

## Message Flow

### Write Path (ClaudeProcess → Cache)

```
┌─────────────────────────────────────────────────────────────┐
│          Claude Code Process (External)                      │
│  Writes newline-delimited JSON to stdout                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ stdout stream
                     ▼
┌─────────────────────────────────────────────────────────────┐
│     ClaudeProcess.handleStdoutData() (DUMB PIPE)             │
│  1. Parse JSON line                                          │
│  2. currentCacheEntry.addMessage(json) ← THAT'S IT!          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ addMessage(json)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          CacheEntry.addMessage(data)                         │
│  1. Create CacheMessage:                                     │
│     { timestamp: Date.now(), type: data.type, data }         │
│  2. messages.push(message)                                   │
│  3. messagesSubject.next(message) ← Emit to RxJS             │
└─────────────────────────────────────────────────────────────┘
```

**Key Point:** ClaudeProcess has **zero business logic** - it just pipes JSON to cache.

### Read Path (Iris → Cache)

```
┌─────────────────────────────────────────────────────────────┐
│                  Iris Orchestrator                           │
│  Needs to react to new messages                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Subscribe to observable
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          cacheEntry.messages$ (RxJS Observable)              │
│  Stream of CacheMessage objects                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Emit on each addMessage()
                     ▼
┌─────────────────────────────────────────────────────────────┐
│           Iris RxJS Subscription                             │
│  cacheEntry.messages$.subscribe(message => {                 │
│    // Reset responseTimeout                                  │
│    // Check for completion                                   │
│    // Update session state                                   │
│  });                                                         │
└─────────────────────────────────────────────────────────────┘
```

**Alternative Read Path (Polling):**
```typescript
// Get all messages at once (for team_cache_read tool)
const messages = cacheEntry.getMessages();

// Get latest message
const latest = cacheEntry.getLatestMessage();
```

---

## RxJS Integration

### Observable Pattern

**Why RxJS?**
- **Event-driven**: Iris reacts immediately to new messages
- **Composable**: Use RxJS operators (filter, map, debounce)
- **Cancellable**: Unsubscribe to stop listening
- **Foundation for Phase 5**: Intelligence layer needs event streams

**Implementation:**

```typescript
class CacheEntryImpl {
  // Private subject (write-only from inside)
  private messagesSubject = new Subject<CacheMessage>();

  // Public observable (read-only from outside)
  public messages$: Observable<CacheMessage>;

  constructor() {
    // Convert subject to observable
    this.messages$ = this.messagesSubject.asObservable();
  }

  addMessage(data: any): void {
    const message = { timestamp, type, data };
    this.messages.push(message);
    this.messagesSubject.next(message); // Emit!
  }

  complete(): void {
    this.messagesSubject.complete(); // Complete observable
  }
}
```

### Subscription Management (Iris Responsibility)

**Iris tracks subscriptions to prevent memory leaks:**

```typescript
class IrisOrchestrator {
  private responseSubscriptions = new Map<string, Subscription>();

  private startResponseTimeout(sessionId: string, cacheEntry: CacheEntry) {
    // Subscribe to messages
    const subscription = cacheEntry.messages$.subscribe(msg => {
      // Handle message
    });

    // Store for cleanup
    this.responseSubscriptions.set(sessionId, subscription);
  }

  private cleanupTell(sessionId: string) {
    // Unsubscribe to prevent memory leak
    const subscription = this.responseSubscriptions.get(sessionId);
    if (subscription) {
      subscription.unsubscribe();
      this.responseSubscriptions.delete(sessionId);
    }
  }
}
```

### RxJS Operators in Iris

**Filter for specific message types:**
```typescript
import { filter } from 'rxjs/operators';

cacheEntry.messages$
  .pipe(filter(msg => msg.type === 'result'))
  .subscribe(() => {
    console.log('Completed!');
  });
```

**Timeout handling:**
```typescript
import { timeout } from 'rxjs/operators';

cacheEntry.messages$
  .pipe(
    filter(msg => msg.type === 'result'),
    timeout(30000)  // 30s timeout
  )
  .subscribe({
    next: () => console.log('Completed'),
    error: (err) => console.log('Timeout!')
  });
```

---

## Lifecycle Management

### CacheEntry Lifecycle

```
┌──────────┐
│  CREATE  │ ← cacheSession.createEntry(type, tellString)
└────┬─────┘
     │
     ▼
┌──────────┐
│  ACTIVE  │ ← Receiving messages, observable emitting
└────┬─────┘
     │
     ├─────────────┬──────────────────┐
     │             │                  │
     │             │                  │
     ▼             ▼                  ▼
┌───────────┐  ┌─────────────┐  ┌────────────┐
│ COMPLETED │  │ TERMINATED  │  │  DESTROY   │
└───────────┘  └─────────────┘  └────────────┘
     │             │                  │
     │             │                  │
     └─────────────┴──────────────────┘
                   │
                   ▼
           [Observable completed]
           [Subscribers notified]
```

**State Transitions:**

1. **CREATE → ACTIVE**
   - `cacheSession.createEntry(type, tellString)`
   - Observable created and ready
   - Status = `ACTIVE`

2. **ACTIVE → COMPLETED**
   - `cacheEntry.complete()` called by Iris
   - Received `result` message with success
   - Observable completed
   - Status = `COMPLETED`

3. **ACTIVE → TERMINATED**
   - `cacheEntry.terminate(reason)` called by Iris
   - Reasons: RESPONSE_TIMEOUT, PROCESS_CRASHED, MANUAL_TERMINATION
   - Observable completed
   - Status = `TERMINATED`

4. **COMPLETED/TERMINATED → DESTROY**
   - `messageCache.destroy()` called by CacheManager
   - Entry removed from cache
   - Memory freed

### MessageCache Lifetime

**Creation:**
```typescript
// Iris gets or creates cache first time team pair communicates
const cache = cacheManager.getOrCreateCache(
  sessionId,
  fromTeam,
  toTeam
);
```

**Survival:**
- MessageCache **survives** process crashes
- MessageCache **survives** process recreation
- MessageCache **preserves** all entries and messages

**Example:**
```
1. Tell sent to alpha team
2. Process responding...
3. ⚠️ Process crashes (responseTimeout)
4. ✅ MessageCache STILL EXISTS in CacheManager
5. ✅ All messages preserved in cache entries
6. 📖 Caller can retrieve partial results via team_cache_read
7. Next tell creates NEW process
8. ✅ SAME MessageCache reused
9. New cache entry added to existing cache
```

**Destruction:**
```typescript
// Only destroyed on explicit cleanup
cacheManager.destroyAll();  // Shutdown
cacheManager.deleteCache(sessionId);  // Manual cleanup
```

---

## API Reference

### CacheManager

```typescript
class CacheManager {
  // Get or create message cache (idempotent)
  getOrCreateCache(
    sessionId: string,
    fromTeam: string,
    toTeam: string
  ): MessageCache;

  // Get existing cache (returns null if not found)
  getCache(sessionId: string): MessageCache | null;

  // Get all caches
  getAllCaches(): MessageCache[];

  // Delete specific cache
  deleteCache(sessionId: string): void;

  // Get aggregate statistics
  getStats(): {
    totalSessions: number;
    totalEntries: number;
    sessionStats: Array<{...}>;
  };

  // Destroy all caches (shutdown)
  destroyAll(): void;
}
```

### MessageCache

```typescript
class MessageCache {
  readonly sessionId: string;
  readonly fromTeam: string;
  readonly toTeam: string;
  readonly createdAt: number;

  // Create new entry
  createEntry(
    cacheEntryType: CacheEntryType,
    tellString: string
  ): CacheEntry;

  // Get all entries (chronological)
  getAllEntries(): CacheEntry[];

  // Filter by type (SPAWN or TELL)
  getEntriesByType(type: CacheEntryType): CacheEntry[];

  // Filter by status (active, completed, terminated)
  getEntriesByStatus(status: CacheEntryStatus): CacheEntry[];

  // Get latest entry
  getLatestEntry(): CacheEntry | null;

  // Statistics
  getStats(): {
    totalEntries: number;
    activeEntries: number;
    completedEntries: number;
    terminatedEntries: number;
    spawnEntries: number;
    tellEntries: number;
  };

  // Cleanup
  destroy(): void;
}
```

### CacheEntry

```typescript
interface CacheEntry {
  // Metadata
  readonly cacheEntryType: CacheEntryType;  // SPAWN or TELL
  readonly tellString: string;              // Original message
  readonly createdAt: number;
  status: CacheEntryStatus;                 // active, completed, terminated
  completedAt: number | null;
  terminationReason?: TerminationReason;

  // Data
  messages: CacheMessage[];                 // All messages
  messages$: Observable<CacheMessage>;      // RxJS observable

  // Write methods (ClaudeProcess)
  addMessage(data: any): void;

  // Read methods (Iris)
  getMessages(): CacheMessage[];
  getLatestMessage(): CacheMessage | null;

  // Lifecycle (Iris)
  complete(): void;
  terminate(reason: TerminationReason): void;
}
```

### CacheMessage

```typescript
interface CacheMessage {
  timestamp: number;  // When added to cache
  type: "system" | "user" | "assistant" |
        "stream_event" | "result" | "unknown";
  data: any;  // Raw Claude protocol message
}
```

### Enums

```typescript
enum CacheEntryType {
  SPAWN = "spawn",  // Process initialization ping
  TELL = "tell"     // Actual tell message
}

enum CacheEntryStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  TERMINATED = "terminated"
}

enum TerminationReason {
  RESPONSE_TIMEOUT = "response_timeout",
  PROCESS_CRASHED = "process_crashed",
  MANUAL_TERMINATION = "manual_termination"
}
```

---

## Integration Points

### With Iris Orchestrator

**Iris creates and manages cache:**
```typescript
class IrisOrchestrator {
  private cacheManager: CacheManager;

  async sendMessage(fromTeam, toTeam, message) {
    // Get or create message cache
    const messageCache = this.cacheManager.getOrCreateCache(
      sessionId, fromTeam, toTeam
    );

    // Create cache entry
    const tellEntry = messageCache.createEntry(
      CacheEntryType.TELL, message
    );

    // Subscribe to messages
    this.startResponseTimeout(sessionId, tellEntry);

    // Execute
    process.executeTell(tellEntry);
  }
}
```

### With ClaudeProcess

**ClaudeProcess writes to cache:**
```typescript
class ClaudeProcess {
  private currentCacheEntry: CacheEntry | null = null;

  async spawn(spawnCacheEntry: CacheEntry) {
    this.currentCacheEntry = spawnCacheEntry;
    // ... spawn process
    // stdout piped to cache via handleStdoutData
  }

  executeTell(cacheEntry: CacheEntry) {
    this.currentCacheEntry = cacheEntry;
    this.writeToStdin(cacheEntry.tellString);
  }

  private handleStdoutData(data: Buffer) {
    const json = JSON.parse(line);

    // DUMB PIPE: Just write to cache
    if (this.currentCacheEntry) {
      this.currentCacheEntry.addMessage(json);
    }
  }
}
```

### With MCP Tools

**team_cache_read tool:**
```typescript
async function team_cache_read(sessionId: string) {
  const messageCache = iris.cacheManager.getCache(sessionId);
  if (!messageCache) return { error: "Cache not found" };

  const entries = messageCache.getAllEntries();

  return {
    sessionId,
    entries: entries.map(entry => ({
      type: entry.cacheEntryType,
      status: entry.status,
      messageCount: entry.getMessages().length,
      messages: entry.getMessages()
    }))
  };
}
```

**team_cache_clear tool:**
```typescript
async function team_cache_clear(sessionId: string) {
  iris.cacheManager.deleteCache(sessionId);
  return { success: true };
}
```

---

## Performance Characteristics

**Memory:**
- CacheMessage: ~200 bytes (average)
- CacheEntry: ~1-5 KB (10-50 messages)
- MessageCache: ~10-100 KB (10-20 entries)
- CacheManager: ~1-10 MB (100 caches)

**Typical Sizes:**
- Short tell: 10-20 messages (~2 KB)
- Long tell: 50-200 messages (~10-40 KB)
- Session with 20 tells: ~200-400 KB

**Observable Overhead:**
- RxJS Subject: ~1 KB per entry
- Subscription: ~100 bytes per subscriber
- Negligible compared to message data

**Scalability:**
- 1000 message caches: ~100 MB RAM
- 10,000 messages: ~2 MB RAM
- Observable cleanup prevents memory leaks

---

## Future Enhancements

### Phase 2: Dashboard Integration
```typescript
// Real-time cache monitoring
cacheEntry.messages$.subscribe(msg => {
  dashboard.emit('cache-message', {
    sessionId, entryId, message: msg
  });
});
```

### Phase 3: API Integration
```typescript
// WebSocket streaming
app.ws('/cache/:sessionId/stream', (ws) => {
  const cache = cacheManager.getCache(sessionId);
  const sub = cache?.getLatestEntry()?.messages$.subscribe(msg => {
    ws.send(JSON.stringify(msg));
  });
});
```

### Phase 5: Intelligence Layer
```typescript
// Pattern recognition on cache streams
cacheEntry.messages$
  .pipe(
    map(msg => extractPatterns(msg)),
    buffer(time(5000)),
    filter(patterns => patterns.length > threshold)
  )
  .subscribe(patterns => {
    intelligence.learnFromPatterns(patterns);
  });
```

---

## Testing Strategy

**Unit Tests:**
- CacheEntry message addition and observable emission
- MessageCache entry management and filtering
- CacheManager cache CRUD operations
- Observable completion on entry lifecycle

**Integration Tests:**
- Cache survives process crashes
- Multiple subscribers receive all messages
- Memory leak prevention (subscription cleanup)
- Large message volumes (1000+ messages)

---

**Document Version:** 1.0
**Last Updated:** October 2025
