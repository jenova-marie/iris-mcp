# Message Handling and Process States

## The Spawning State Problem

### Overview

When sending messages to teams via the `tell` action (or `iris.sendMessage()`), there is a critical behavior to understand: **if the target team's process is not currently running, the message will be lost and the sender must retry manually**.

### Root Cause

The issue stems from the process spawning lifecycle in `src/process-pool/claude-process.ts`:

1. **Process Spawn Initiated** (`line 352`)
   - Status changes to `"spawning"`
   - Child process is created but not ready

2. **Initialization Ping** (`line 444-460`)
   - System sends a "ping" message to trigger Claude initialization
   - Claude responds with init message + pong response

3. **Wait for Ready** (`line 464`)
   - Process waits for init message and ping response to complete
   - Duration: typically 2-7 seconds depending on cold/warm start

4. **Cleanup** (`line 468-473`)
   - Clears text accumulator to remove ping contamination
   - Clears output cache

5. **Ready State** (`line 475`)
   - Status changes to `"idle"`
   - Process can now accept real messages

**The Problem**: During the "spawning" state (steps 1-4), the process exists but is not ready to accept messages.

### Current Behavior by Action

#### Passive Actions (Do NOT spawn processes)

- **`isAwake`**: Returns `status: "asleep"` if no process exists
- **`report`**: Returns empty output `{ stdout: "", stderr: "", hasProcess: false }`
- **`sleep`**: Returns `status: "already_asleep"` if no process exists

These actions are safe - they simply report current state without side effects.

#### Active Actions (DO spawn processes)

- **`wake`**: Explicitly spawns process and returns `status: "waking"`. No message loss because there's no message to lose.
- **`wake-all`**: Same as `wake` but for all teams.

#### Critical: `tell` Action

**Location**: `src/actions/tell.ts:165` → `src/iris.ts:64-147`

**What Happens When Target Team is Asleep**:

```typescript
// From src/iris.ts:99-106
const metrics = process.getMetrics();
if (metrics.status === "spawning") {
  logger.info("Process is spawning, returning early", {
    sessionId: session.sessionId,
    toTeam,
  });
  return "Session starting... Please retry your request in a moment.";
}
```

**Flow**:
1. `tell` calls `iris.sendMessage(fromTeam, toTeam, message)`
2. IrisOrchestrator calls `sessionManager.getOrCreateSession()` - creates session if needed
3. IrisOrchestrator calls `processPool.getOrCreateProcess()` - **spawns process** if offline
4. IrisOrchestrator checks `metrics.status`
5. If status is `"spawning"`, returns early with message: `"Session starting... Please retry your request in a moment."`
6. **Original message is discarded - not queued, not retried**

### Implications

#### Message Loss
When a team is asleep (offline) and you send a message:
- The process will spawn automatically
- Your message will be **lost**
- You receive: `"Session starting... Please retry your request in a moment."`
- You must **manually retry** the entire operation

#### Race Conditions
If multiple clients send messages to the same sleeping team simultaneously:
- First client triggers the spawn
- All clients receive "Session starting..." response
- All clients must retry
- Retries may collide again if timing is tight

#### No Auto-Retry
There is no built-in retry mechanism. The caller is responsible for:
1. Detecting the "Session starting..." response
2. Waiting an appropriate duration (2-7 seconds)
3. Retrying the message send

### Recommended Usage Patterns

#### Pattern 1: Check Before Send

```typescript
// Check if team is awake first
const status = await isAwake({ team: "team-alpha" });

if (status.teams[0].status === "asleep") {
  // Explicitly wake the team
  await wake({ team: "team-alpha" });

  // Wait for process to be ready (7 seconds for cold start)
  await new Promise(resolve => setTimeout(resolve, 7000));
}

// Now send the message (process should be ready)
const result = await tell({
  toTeam: "team-alpha",
  message: "Your message here",
  fromTeam: "team-beta"
});

// Still check for "Session starting..." in case of race conditions
if (result.response === "Session starting... Please retry your request in a moment.") {
  await new Promise(resolve => setTimeout(resolve, 3000));
  result = await tell({
    toTeam: "team-alpha",
    message: "Your message here",
    fromTeam: "team-beta"
  });
}
```

#### Pattern 2: Optimistic Send with Retry

```typescript
async function tellWithRetry(input: TellInput, maxRetries = 2): Promise<TellOutput> {
  let attempts = 0;

  while (attempts < maxRetries) {
    const result = await tell(input);

    // Check if process is spawning
    if (result.response === "Session starting... Please retry your request in a moment.") {
      attempts++;
      if (attempts < maxRetries) {
        // Wait longer on first retry (cold start), shorter on subsequent retries
        const delay = attempts === 1 ? 7000 : 3000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }

    return result;
  }

  throw new Error("Failed to send message after retries");
}
```

#### Pattern 3: Wake-All Before Bulk Operations

```typescript
// If you know you'll be sending many messages, wake all teams upfront
await wakeAll({ parallel: true });

// Wait for all processes to be ready
await new Promise(resolve => setTimeout(resolve, 10000));

// Now send messages (processes should all be ready)
await tell({ toTeam: "team-alpha", message: "Message 1" });
await tell({ toTeam: "team-beta", message: "Message 2" });
await tell({ toTeam: "team-gamma", message: "Message 3" });
```

### Future Improvements (Not Yet Implemented)

The following improvements would solve this issue but are not currently implemented:

1. **Auto-Retry in IrisOrchestrator**: Instead of returning early when `status === "spawning"`, wait for ready state and then send message
2. **Message Queue During Spawn**: Queue messages sent during spawning state and auto-send once ready
3. **Explicit Wait API**: Add `waitUntilReady(teamName, timeout)` method to poll until process is ready
4. **WebSocket Notifications**: Phase 3 feature that would allow async notification when process becomes ready

### Testing Implications

When writing tests that involve `tell`:

```typescript
// If using REUSE_DB=1, first message to a team may hit spawning state
const result1 = await sessionManager.sendMessage(null, "team-alpha", "hello");

// Check for spawning state and retry
if (result1 === "Session starting... Please retry your request in a moment.") {
  await new Promise(resolve => setTimeout(resolve, 7000));
  result1 = await sessionManager.sendMessage(null, "team-alpha", "hello");
}

expect(result1).not.toContain("Session starting");
```

Alternatively, always wake teams before testing:

```typescript
beforeAll(async () => {
  // Wake all teams to ensure they're ready for testing
  await processPool.getOrCreateProcess("team-alpha", sessionAlpha);
  await processPool.getOrCreateProcess("team-beta", sessionBeta);

  // Wait for initialization to complete
  await new Promise(resolve => setTimeout(resolve, 10000));
}, 30000);
```

### Related Files

- `src/iris.ts:99-106` - Early return when spawning
- `src/process-pool/claude-process.ts:352-490` - Spawn lifecycle
- `src/actions/tell.ts:165` - Tell action entry point
- `tests/integration/session/session-first.test.ts` - Example of handling spawning state in tests
