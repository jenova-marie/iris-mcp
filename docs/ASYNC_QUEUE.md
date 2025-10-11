# Async Queue Implementation

## Overview

The AsyncQueue system provides true asynchronous, non-blocking message handling for Iris MCP actions. Instead of blocking the caller while waiting for session/process creation, async operations return immediately and are processed in the background via RxJS observable streams.

## Problem Solved

### Before AsyncQueue

When using `waitForResponse=false` (fire-and-forget mode), the caller would still block for:
- Session creation: 7-12 seconds (if session doesn't exist)
- Process spawning: 1-2 seconds (if process doesn't exist)
- **Total**: Up to 14 seconds before returning!

### After AsyncQueue

With AsyncQueue:
- Immediate return: **< 100ms** (just validates and enqueues)
- Background processing: Session/process creation happens asynchronously
- Queue management: Per-team queues with 100-message rolling limit
- Reactive coordination: Uses RxJS to process tasks as ClaudeProcess instances become available

## Architecture

### Components

1. **AsyncQueue** (`src/async/queue.ts`)
   - Generic RxJS-based queue system
   - Supports `tell`, `command`, and `sleep` task types
   - Per-team queues for parallel cross-team processing
   - Serial FIFO processing within each team

2. **ClaudeProcess Events** (`src/process-pool/claude-process.ts`)
   - Emits `message-complete` when messages finish processing
   - Events include `{ teamName, success, duration, error? }`
   - Enables reactive coordination with AsyncQueue

3. **IrisOrchestrator Integration** (`src/iris.ts`)
   - Initializes AsyncQueue on startup
   - Provides `isAwake()` check for team readiness
   - Exposes `getAsyncQueue()` for direct access

4. **Action Updates** (`src/actions/`)
   - `tell.ts`: Uses AsyncQueue when `waitForResponse=false`
   - `command.ts`: Uses AsyncQueue when `waitForResponse=false`
   - Both check `isAwake()` before enqueueing

## Queue Behavior

### Per-Team Queues

Each team has its own queue:
- **Parallel processing** across teams
- **Serial processing** within each team (FIFO order)
- **100-message limit** per team (rolling, prevents memory issues)
- **No timeouts** - tasks wait indefinitely until processed

### Task States

Tasks flow through these states:
1. **Enqueued** - Task added to team queue, taskId returned immediately
2. **Processing** - Task picked up by RxJS concatMap operator
3. **Completed** - Task finishes successfully or with error
4. **Stats Updated** - Queue statistics updated (pending--, processed++ or failed++)

### Queue Statistics

Each queue tracks:
- `pending`: Number of tasks waiting to be processed
- `processed`: Total number of successfully completed tasks
- `failed`: Total number of failed tasks
- `maxQueueSize`: Maximum allowed queue size (100)

## Usage

### Async Tell

```typescript
// Check if team is awake
if (!iris.isAwake(fromTeam, toTeam)) {
  return { response: "Team is asleep. Use 'wake' action first." };
}

// Enqueue task (returns immediately with taskId)
const taskId = iris.getAsyncQueue().enqueue({
  type: "tell",
  fromTeam: fromTeam || null,
  toTeam,
  content: message,
  timeout: 30000,
});

return {
  from: fromTeam,
  to: toTeam,
  message,
  timestamp: Date.now(),
  async: true,
  taskId, // For tracking
};
```

### Async Command

```typescript
// Check if team is awake
if (!iris.isAwake(fromTeam, toTeam)) {
  return { response: "Team is asleep. Use 'wake' action first." };
}

// Enqueue command (returns immediately with taskId)
const taskId = iris.getAsyncQueue().enqueue({
  type: "command",
  fromTeam: fromTeam || null,
  toTeam: team,
  content: commandName, // Without slash
  args: args, // Optional
  timeout: 30000,
});

return {
  team,
  command: fullCommand,
  success: true,
  timestamp: Date.now(),
  async: true,
  taskId,
};
```

### Queue Stats

```typescript
// Get stats for a specific team
const stats = iris.getAsyncQueue().getQueueStats("backend");
// { teamName: "backend", pending: 5, processed: 42, failed: 2, maxQueueSize: 100 }

// Get stats for all teams
const allStats = iris.getAsyncQueue().getAllQueueStats();
// [{ teamName: "backend", ... }, { teamName: "frontend", ... }]
```

## Implementation Details

### Task Processing Flow

1. **Enqueue** (`AsyncQueue.enqueue()`)
   ```typescript
   - Generate taskId (UUID)
   - Check queue size (throw if >= 100)
   - Increment stats.pending
   - Emit task to RxJS Subject
   - Return taskId immediately
   ```

2. **RxJS Processing** (concatMap operator)
   ```typescript
   queue.pipe(
     concatMap(task => this.processTask(task)),  // Serial, one at a time
     catchError(error => of(null))                // Continue on errors
   ).subscribe()
   ```

3. **Process Task** (`AsyncQueue.processTask()`)
   ```typescript
   - Route to appropriate handler (tell/command/sleep)
   - Call iris.sendMessage() (blocks queue, not caller)
   - Update stats (pending--, processed++ or failed++)
   - Return AsyncTaskResult
   ```

### Team Awake Check

```typescript
isAwake(fromTeam: string | null, toTeam: string): boolean {
  // 1. Check if session exists
  const session = this.sessionManager.getSession(fromTeam, toTeam);
  if (!session) return false;

  // 2. Check if process exists for session
  const process = this.processPool.getProcessBySessionId(session.sessionId);
  if (!process) return false;

  // 3. Check if process is ready (not spawning or stopped)
  const metrics = process.getMetrics();
  return metrics.status !== "spawning" && metrics.status !== "stopped";
}
```

### Error Handling

- **Queue Full**: Throws error immediately (100 tasks limit)
- **Team Asleep**: Returns response "Team is asleep. Use 'wake' action first."
- **Process Errors**: Logged, task marked as failed, queue continues
- **Timeout**: Not implemented - tasks wait indefinitely (by design)

## RxJS Operators Used

- **Subject**: Hot observable for emitting tasks
- **concatMap**: Serial processing (one task at a time, in order)
- **catchError**: Graceful error handling (continue processing)
- **of**: Return observable for error recovery

## Benefits

1. **Instant Return** - Caller gets response in < 100ms
2. **Backpressure** - 100-message limit prevents memory issues
3. **Parallel Teams** - Different teams process simultaneously
4. **Serial Team** - Same team processes in order (FIFO)
5. **No Lost Messages** - Queue persists until processed
6. **Reactive** - Processes as ClaudeProcess instances become available

## Limitations

1. **No Persistence** - Queue is in-memory only (lost on restart)
2. **No Timeouts** - Tasks wait indefinitely (no expiration)
3. **No Priorities** - All tasks treated equally (FIFO only)
4. **No Retries** - Failed tasks are not automatically retried
5. **Team Must Be Awake** - Cannot enqueue to sleeping teams

## Future Enhancements

- [ ] Persistent queue (SQLite or Redis)
- [ ] Task expiration/TTL
- [ ] Priority queues
- [ ] Automatic retry with exponential backoff
- [ ] Auto-wake sleeping teams
- [ ] Task cancellation
- [ ] Queue metrics dashboard
- [ ] Rate limiting per team

## Testing

### Unit Tests

```typescript
// Test queue creation
test("creates queue for new team", () => {
  const queue = new AsyncQueue(iris);
  const taskId = queue.enqueue({ type: "tell", ... });
  expect(taskId).toBeDefined();
});

// Test queue limit
test("throws when queue is full", () => {
  const queue = new AsyncQueue(iris);
  for (let i = 0; i < 100; i++) {
    queue.enqueue({ type: "tell", ... });
  }
  expect(() => queue.enqueue({ type: "tell", ... })).toThrow("Queue for team");
});

// Test stats
test("updates stats correctly", async () => {
  const queue = new AsyncQueue(iris);
  queue.enqueue({ type: "tell", ... });
  const stats = queue.getQueueStats("backend");
  expect(stats.pending).toBe(1);
});
```

### Integration Tests

```typescript
// Test async tell
test("async tell returns immediately", async () => {
  const start = Date.now();
  const result = await tell({
    toTeam: "backend",
    message: "test",
    waitForResponse: false,
  }, iris);
  const duration = Date.now() - start;

  expect(duration).toBeLessThan(500); // < 500ms
  expect(result.async).toBe(true);
  expect(result.taskId).toBeDefined();
});

// Test team asleep
test("rejects async tell when team asleep", async () => {
  const result = await tell({
    toTeam: "sleeping-team",
    message: "test",
    waitForResponse: false,
  }, iris);

  expect(result.response).toContain("Team is asleep");
});
```

## Monitoring

### Logs

AsyncQueue logs all activity to stderr in JSON format:

```json
{"level":"info","context":"async-queue","message":"Task enqueued","taskId":"abc-123","type":"tell","toTeam":"backend","queueSize":5}
{"level":"info","context":"async-queue","message":"Processing task","taskId":"abc-123","type":"tell","toTeam":"backend"}
{"level":"info","context":"async-queue","message":"Task completed successfully","taskId":"abc-123","duration":2847,"responseLength":142}
{"level":"error","context":"async-queue","message":"Task failed","taskId":"xyz-789","error":"Timeout"}
```

### Metrics

Track these metrics for observability:
- Queue depth per team (pending tasks)
- Task throughput (tasks/second)
- Task duration (p50, p95, p99)
- Error rate (failed/total)
- Queue full events (rejected tasks)

## References

- [RxJS Documentation](https://rxjs.dev/)
- [AsyncQueue Implementation](../src/async/queue.ts)
- [IrisOrchestrator Integration](../src/iris.ts)
- [Tell Action](../src/actions/tell.ts)
- [Command Action](../src/actions/command.ts)
