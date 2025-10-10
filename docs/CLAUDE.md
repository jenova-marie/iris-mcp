# Claude Process Architecture

**Last Updated**: 2025-10-10
**Current Phase**: Phase 1 (Post-Refactor)

## Table of Contents

1. [Overview](#overview)
2. [Dual-Role Architecture](#dual-role-architecture)
3. [Static Method: Session File Initialization](#static-method-session-file-initialization)
4. [Instance Methods: Process Management](#instance-methods-process-management)
5. [Lifecycle State Machine](#lifecycle-state-machine)
6. [Message Processing](#message-processing)
7. [Response Handling: Stream-JSON Protocol](#response-handling-stream-json-protocol)
8. [Idle Timeout Management](#idle-timeout-management)
9. [Event-Driven Architecture](#event-driven-architecture)
10. [Error Handling](#error-handling)
11. [Integration with Pool Manager](#integration-with-pool-manager)
12. [Performance Characteristics](#performance-characteristics)
13. [Security Considerations](#security-considerations)
14. [Debugging Capabilities](#debugging-capabilities)
15. [Testing Strategy](#testing-strategy)
16. [Common Issues and Solutions](#common-issues-and-solutions)
17. [Future Enhancements](#future-enhancements)

---

## Overview

The `ClaudeProcess` class is the **core process wrapper** that manages communication with Claude Code CLI instances running in headless mode. It serves two distinct but complementary roles:

1. **Static Session Initializer** - Creates `.jsonl` session files before processes spawn
2. **Instance Process Manager** - Wraps running Claude processes with stdio communication

**Location**: `src/process-pool/claude-process.ts`

**Key Principle**: ClaudeProcess handles ALL direct interaction with the `claude` CLI binary, providing a clean abstraction for the rest of the system.

---

## Dual-Role Architecture

### Role 1: Static Session Initialization

**Purpose**: Create session files at `~/.claude/projects/{escaped-path}/{sessionId}.jsonl` **before** any process spawns.

**Why Static?** Session initialization is a **one-time setup operation** that doesn't require a running process instance. Making it static allows:
- SessionManager to call it during eager initialization at startup
- No coupling between session creation and process lifecycle
- Clean separation: "create session file" vs "run Claude with that session"

**Method Signature**:
```typescript
static async initializeSessionFile(
  teamConfig: TeamConfig,
  sessionId: string,
  sessionInitTimeout = 30000,
): Promise<void>
```

**Used By**:
- `SessionManager.initialize()` - Eager initialization of all team sessions at startup
- `SessionManager.createSession()` - On-demand session creation for new team pairs

### Role 2: Instance Process Management

**Purpose**: Wrap a running `claude` process, handle stdio communication, manage message queue, enforce idle timeouts.

**Why Instances?** Each team's Claude process needs:
- Independent state (status, message queue, response buffer)
- Event emission for lifecycle hooks (spawned, exited, error)
- Idle timeout management per process
- Isolated communication channel

**Constructor Signature**:
```typescript
constructor(
  teamName: string,
  teamConfig: TeamConfig,
  idleTimeout: number,
  sessionId?: string,
)
```

**Used By**:
- `ClaudeProcessPool.getOrCreateProcess()` - Creates instances for team process pools

---

## Static Method: Session File Initialization

### Complete Flow

#### 1. Path Computation

```typescript
static getSessionFilePath(projectPath: string, sessionId: string): string {
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const escapedPath = projectPath.replace(/\//g, "-");
  return `${homedir}/.claude/projects/${escapedPath}/${sessionId}.jsonl`;
}
```

**Examples**:
| Project Path | Session ID | File Path |
|--------------|-----------|-----------|
| `/Users/jenova/projects/iris-mcp` | `abc123...` | `~/.claude/projects/-Users-jenova-projects-iris-mcp/abc123....jsonl` |
| `/tmp/test` | `def456...` | `~/.claude/projects/-tmp-test/def456....jsonl` |

**Critical Detail**: Path escaping uses simple `/` → `-` replacement, matching Claude CLI's algorithm exactly.

#### 2. Spawn Command Construction

```bash
cd {teamConfig.path}
/Users/jenova/.asdf/installs/nodejs/22.16.0/bin/claude \
  --session-id {sessionId} \
  --print \
  ping
```

**Key Flags**:
- `--session-id <uuid>`: **CREATE** new session (will NOT resume existing)
- `--print`: Non-interactive mode (exit after command completes)
- `ping`: Dummy command to trigger session file creation

**Why the hardcoded path?** Avoids PATH resolution issues during spawning. In production, this should use `which claude` or configuration.

#### 3. Process Lifecycle Management

**Stdout Monitoring**:
```typescript
claudeProcess.stdout!.on("data", (data) => {
  const output = data.toString();
  stdoutData += output;

  // ANY response counts as success
  if (output.length > 0) {
    responseReceived = true;
  }
});
```

**Important**: Does NOT validate response content - any output means Claude processed the command successfully.

**Stderr Capture**:
```typescript
claudeProcess.stderr!.on("data", (data) => {
  const errorOutput = data.toString();
  stderrData += errorOutput;

  // Extract debug log path: "Logging to: /path/to/debug.txt"
  const logPathMatch = errorOutput.match(/Logging to: (.+)/);
  if (logPathMatch) {
    debugLogPath = logPathMatch[1].trim();
  }
});
```

Claude CLI logs diagnostic information to stderr, including debug log file location when `--debug` flag is used.

#### 4. Timeout Handling (CRITICAL)

**The Problem**: Timeout handlers that aren't cleared cause spurious errors 20+ seconds after successful completion.

**The Solution**:
```typescript
let timeoutHandle: NodeJS.Timeout | null = null;

// Set timeout
timeoutHandle = setTimeout(() => {
  timeoutHandle = null; // Clear reference immediately

  logger.error("Session initialization timed out", {
    sessionId,
    timeout: sessionInitTimeout,
    responseReceived,
    stdout: stdoutData,
    stderr: stderrData,
  });

  claudeProcess.kill();
  reject(new ProcessError(`Timeout after ${sessionInitTimeout}ms`, projectPath));
}, sessionInitTimeout);

// Clear on exit
claudeProcess.on("exit", (code) => {
  // CRITICAL: Clear timeout FIRST before any other logic
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }

  // Now handle exit logic...
  if (code !== 0 && code !== 143) {
    reject(new ProcessError(`Exit code ${code}`, projectPath));
  } else if (!responseReceived) {
    reject(new ProcessError("No response received", projectPath));
  } else {
    resolve(); // Success!
  }
});
```

**Why this matters**: Tests showed timeout errors firing 22 seconds AFTER successful completion because handlers weren't cleared. This pattern ensures cleanup happens immediately on exit.

#### 5. Exit Code Validation

**Accepted Exit Codes**:
- `0`: Clean exit (success)
- `143`: SIGTERM signal (expected when we kill the process)

**Rejected Exit Codes**:
- Anything else indicates Claude CLI error (invalid flags, missing files, etc.)

**Response Validation**:
```typescript
if (!responseReceived) {
  // Even with exit code 0, if no stdout, something's wrong
  reject(new ProcessError("No response received", projectPath));
} else {
  // Accept ANY response - content doesn't matter
  resolve();
}
```

#### 6. File Verification

**After process exits successfully**:
```typescript
const sessionFilePath = ClaudeProcess.getSessionFilePath(projectPath, sessionId);

if (!existsSync(sessionFilePath)) {
  throw new ProcessError(
    `Session file was not created at ${sessionFilePath}`,
    projectPath,
  );
}
```

**Critical Check**: Even if Claude exited cleanly, verify the `.jsonl` file actually exists. Catches edge cases like:
- Directory permission issues
- Disk space exhaustion
- Claude CLI bugs

### Session File Format

**Location**: `~/.claude/projects/{escaped-path}/{sessionId}.jsonl`

**Format**: NDJSON (newline-delimited JSON) with linked messages

**Example Content**:
```jsonl
{"uuid":"msg-001","role":"user","content":[{"type":"text","text":"ping"}],"parentUuid":null,"createdAt":1234567890}
{"uuid":"msg-002","role":"assistant","content":[{"type":"text","text":"pong"}],"parentUuid":"msg-001","createdAt":1234567891}
```

**Properties**:
- `uuid`: Message identifier
- `parentUuid`: Links to previous message (forms conversation tree)
- `role`: `"user"` | `"assistant"` | `"system"`
- `content`: Array of content blocks (text, images, tool uses, etc.)
- `createdAt`: Unix timestamp

**Critical Detail**: Claude CLI **creates** this file on first `--session-id` command and **reads** it on subsequent `--resume` commands.

---

## Instance Methods: Process Management

### Lifecycle State Machine

**States**:
```typescript
type ProcessStatus =
  | "stopped"      // No process running
  | "spawning"     // Process starting, waiting for init
  | "idle"         // Process ready, no active message
  | "processing"   // Processing a message
  | "terminating"; // Shutting down gracefully
```

**Transitions**:
```
stopped ──spawn()──> spawning ──init_received──> idle
   ↑                                               ↓
   │                                        sendMessage()
   │                                               ↓
   └───────────────────────────────────────── processing
                    terminate()                    ↓
                                            message_complete
                                                   ↓
                                                 idle
```

### Method: `spawn()`

**Purpose**: Spawn Claude CLI process in headless mode with session resumption.

**Command Construction**:
```typescript
const args: string[] = [];

// Resume existing session (if sessionId provided and not in test)
if (this.sessionId && process.env.NODE_ENV !== "test") {
  args.push("--resume", this.sessionId);
}

// Enable debug logging in test/debug mode
if (process.env.NODE_ENV === "test" || process.env.DEBUG) {
  args.push("--debug");
}

// Stream-JSON mode for structured I/O
args.push(
  "--print",                      // Non-interactive headless mode
  "--verbose",                    // Required for stream-json output
  "--input-format", "stream-json", // Accept JSON messages via stdin
  "--output-format", "stream-json" // Emit JSON messages via stdout
);

// Auto-approve all actions (optional, per team config)
if (this.teamConfig.skipPermissions) {
  args.push("--dangerously-skip-permissions");
}
```

**Full Command Example**:
```bash
cd /Users/jenova/projects/iris-mcp
claude \
  --resume abc123-def4-5678-90ab-cdef12345678 \
  --print \
  --verbose \
  --input-format stream-json \
  --output-format stream-json \
  --dangerously-skip-permissions
```

**Key Differences from Static Method**:
| Static (`initializeSessionFile`) | Instance (`spawn`) |
|----------------------------------|---------------------|
| `--session-id <uuid>` (CREATE)   | `--resume <uuid>` (CONTINUE) |
| `--print ping` (one-shot)        | `--verbose` (persistent) |
| No I/O format flags              | `stream-json` I/O |
| Exits immediately                | Runs until terminated |

**Initialization Ping**:
```typescript
// Claude in stream-json mode sends init AFTER receiving first message
// So we send a dummy message to trigger initialization
const initMessage = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "text", text: "ping" }],
  },
}) + "\n";

this.process.stdin!.write(initMessage);

// Wait for init message
await this.waitForReady();
```

**Why the ping?** Stream-JSON mode doesn't send the `system/init` message until it receives the first user message. The ping triggers this initialization.

---

## Message Processing

### Method: `sendMessage()`

**Purpose**: Send a message to Claude and wait for response.

**Signature**:
```typescript
async sendMessage(message: string, timeout = 30000): Promise<string>
```

**Message Queue Pattern**:
```typescript
return new Promise((resolve, reject) => {
  const messageObj: ProcessMessage = { message, resolve, reject };

  // Add to queue
  this.messageQueue.push(messageObj);

  // Trigger processing
  this.processNextMessage();

  // Set timeout
  const timeoutId = setTimeout(() => {
    // Remove from queue or current message
    // ...
    reject(new TimeoutError("Message send", timeout));
  }, timeout);

  // Wrap resolve/reject to clear timeout
  messageObj.resolve = (value) => {
    clearTimeout(timeoutId);
    originalResolve(value);
  };
  messageObj.reject = (error) => {
    clearTimeout(timeoutId);
    originalReject(error);
  };
});
```

**Why Queue?** Prevents concurrent message sends which would corrupt the stream-json protocol. Messages are processed **sequentially** in FIFO order.

### Processing: `processNextMessage()`

**Guards**:
```typescript
// Don't process if already processing or queue empty
if (this.currentMessage || this.messageQueue.length === 0) {
  return;
}

// Don't process if stdin unavailable
if (!this.process || !this.process.stdin) {
  // Reject all queued messages
  while (this.messageQueue.length > 0) {
    const msg = this.messageQueue.shift()!;
    msg.reject(new ProcessError("Process stdin not available", this.teamName));
  }
  return;
}
```

**Processing Flow**:
```typescript
this.currentMessage = this.messageQueue.shift()!;
this.status = "processing";
this.textAccumulator = ""; // Reset for new response

// Format message per stream-json spec
const jsonMessage = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "text", text: this.currentMessage.message }],
  },
}) + "\n";

// Write to stdin
this.process.stdin.write(jsonMessage);
this.messagesProcessed++;

this.emit("message-sent", { teamName: this.teamName, message });
```

**Stream-JSON Message Format**:
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "What is the current directory?"
      }
    ]
  }
}
```

---

## Response Handling: Stream-JSON Protocol

**Protocol**: Newline-delimited JSON responses from Claude CLI

**Message Types** (per `docs/HEADLESS_CLAUDE.md`):

### 1. `system/init` - Initial Session Info
```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "abc123...",
  "model": "claude-sonnet-4-5-20250929",
  "tools": [...],
  "workspace": {...}
}
```

**Handler**:
```typescript
if (jsonResponse.type === "system" && jsonResponse.subtype === "init") {
  // Resolve initPromise to signal spawn() completion
  if (this.initResolve) {
    this.initResolve();
    this.initResolve = null;
  }
}
```

### 2. `user` - Echo of User Message
```json
{
  "type": "user",
  "message": {...}
}
```

**Handler**: Log and ignore (confirmation that message was received)

### 3. `stream_event` - Real-Time Streaming

**Message Start**:
```json
{
  "type": "stream_event",
  "event": {
    "type": "message_start",
    "message": {"id": "msg_123", "role": "assistant"}
  }
}
```

**Handler**: Reset text accumulator for new response

**Content Delta** (streaming chunks):
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {"type": "text_delta", "text": "Here "}
  }
}
```

**Handler**:
```typescript
if (event?.type === "content_block_delta" && event?.delta?.type === "text_delta") {
  const deltaText = event.delta.text || "";
  this.textAccumulator += deltaText; // Accumulate chunks

  logger.debug("Accumulated text", {
    chunkLength: deltaText.length,
    totalLength: this.textAccumulator.length,
  });
}
```

**Message Stop** (response complete):
```json
{
  "type": "stream_event",
  "event": {"type": "message_stop"}
}
```

**Handler**:
```typescript
if (event?.type === "message_stop") {
  if (this.currentMessage && this.textAccumulator.length > 0) {
    // Resolve promise with accumulated text
    this.currentMessage.resolve(this.textAccumulator);

    this.emit("message-response", {
      teamName: this.teamName,
      response: this.textAccumulator,
    });

    // Reset state
    this.currentMessage = null;
    this.status = "idle";
    this.textAccumulator = "";

    // Process next queued message
    this.processNextMessage();
  }
}
```

### 4. `assistant` - Complete Response (Non-Streaming)

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "Complete response here"}
    ],
    "stop_reason": "end_turn"
  }
}
```

**Handler**: Extract text content and resolve promise (fallback if streaming not enabled)

### 5. `result` - Final Statistics
```json
{
  "type": "result",
  "total_cost_usd": 0.0015,
  "duration_ms": 1234,
  "is_error": false
}
```

**Handler**: Log metrics, check for errors

### 6. `error` - Error Response
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Message too long"
  }
}
```

**Handler**: Reject current message promise with error

### Response Buffer Management

**Challenge**: Stdout data arrives in chunks, not necessarily aligned with JSON message boundaries.

**Solution**: Maintain a buffer and parse complete lines:
```typescript
private responseBuffer: string = "";

private handleStdout(data: Buffer): void {
  const rawData = data.toString();
  this.responseBuffer += rawData;

  // Split on newlines
  const lines = this.responseBuffer.split("\n");

  // Keep last incomplete line in buffer
  this.responseBuffer = lines.pop() || "";

  // Parse complete lines
  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const jsonResponse = JSON.parse(line);
      // Handle message type...
    } catch (error) {
      logger.debug("Failed to parse JSON", { line });
    }
  }
}
```

**Example**:
```
Chunk 1: '{"type":"stream_event","event":{"type":"message_start'
Chunk 2: '"}}\n{"type":"stream_event","event":{"type":"cont'
Chunk 3: 'ent_block_delta","delta":{"text":"Hi"}}}\n'

After Chunk 1: buffer = '{"type":"stream_event","event":{"type":"message_start'
After Chunk 2: Parse '{"type":"stream_event","event":{"type":"message_start"}}'
               buffer = '{"type":"stream_event","event":{"type":"cont'
After Chunk 3: Parse '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"Hi"}}}'
               buffer = ''
```

---

## Idle Timeout Management

**Purpose**: Terminate processes that haven't been used recently to conserve resources.

**Default**: 5 minutes (configurable per team in `teams.json`)

**Implementation**:
```typescript
private idleTimer: NodeJS.Timeout | null = null;

private resetIdleTimer(): void {
  this.clearIdleTimer();

  this.idleTimer = setTimeout(() => {
    logger.info("Process idle timeout reached, terminating");
    this.terminate();
  }, this.idleTimeout);
}

private clearIdleTimer(): void {
  if (this.idleTimer) {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
```

**Reset Triggers**:
- After spawning
- Before processing each message
- After message completion

**Result**: Process stays alive as long as messages keep coming, terminates after `idleTimeout` of inactivity.

### Method: `terminate()`

**Purpose**: Gracefully shut down Claude process.

**Flow**:
```typescript
async terminate(): Promise<void> {
  this.status = "terminating";
  this.clearIdleTimer();

  return new Promise((resolve) => {
    if (!this.process) {
      resolve();
      return;
    }

    // Force kill after 5 seconds
    const killTimer = setTimeout(() => {
      if (this.process) {
        logger.warn("Force killing process");
        this.process.kill("SIGKILL");
      }
    }, 5000);

    // Clean up on exit
    this.process.once("exit", () => {
      clearTimeout(killTimer);
      this.process = null;
      this.status = "stopped";
      this.emit("terminated", { teamName: this.teamName });
      resolve();
    });

    // Try graceful shutdown first
    this.process.kill("SIGTERM");
  });
}
```

**Two-Stage Shutdown**:
1. **SIGTERM** (15): Graceful shutdown signal
2. **SIGKILL** (9): Force kill after 5s timeout

---

## Event-Driven Architecture

**Extends EventEmitter**: ClaudeProcess emits events throughout its lifecycle for observability and coordination.

### Event: `spawned`

**Emitted**: After process successfully spawns and receives init message

**Payload**:
```typescript
{
  teamName: string;
  pid: number;
}
```

**Listeners**: `ClaudeProcessPool` - Track spawned processes

### Event: `message-sent`

**Emitted**: After message written to stdin

**Payload**:
```typescript
{
  teamName: string;
  message: string;
}
```

**Use Case**: Audit log of all messages sent to Claude instances

### Event: `message-response`

**Emitted**: After receiving complete response from Claude

**Payload**:
```typescript
{
  teamName: string;
  response: string;
}
```

**Use Case**: Response logging, metrics (response length, timing)

### Event: `terminated`

**Emitted**: After process exits cleanly via `terminate()`

**Payload**:
```typescript
{
  teamName: string;
}
```

**Listeners**: `ClaudeProcessPool` removes from pool

### Event: `exited`

**Emitted**: When process exits unexpectedly (crash, SIGKILL, etc.)

**Payload**:
```typescript
{
  teamName: string;
  code: number | null;
  signal: string | null;
}
```

**Listeners**: `ClaudeProcessPool` marks process as unhealthy and respawns if needed

### Event: `error`

**Emitted**: On process spawn errors, crashes, etc.

**Payload**:
```typescript
{
  teamName: string;
  error: Error;
}
```

**Use Case**: Error monitoring, alerting

---

## Error Handling

### Spawn Failures

**Causes**:
- Claude CLI not installed or not in PATH
- Invalid flags/arguments
- Permission denied in project directory
- Session file corrupt or invalid

**Handling**:
```typescript
try {
  await process.spawn();
} catch (error) {
  logger.error("Failed to spawn process", { error });

  // Propagate to caller (PoolManager)
  throw new ProcessError(
    `Failed to spawn process: ${error.message}`,
    teamName
  );
}
```

### Message Send Failures

**Causes**:
- Process exited before message could be sent
- stdin stream closed
- Timeout exceeded

**Handling**:
```typescript
if (!this.process || !this.process.stdin) {
  // Reject ALL queued messages
  while (this.messageQueue.length > 0) {
    const msg = this.messageQueue.shift()!;
    msg.reject(new ProcessError("Process stdin not available", this.teamName));
  }
  return;
}
```

### Timeout Errors

**Configuration**: Per-message timeout (default 30s)

**Trigger**:
```typescript
const timeoutId = setTimeout(() => {
  if (this.currentMessage === messageObj) {
    // Message is actively being processed
    this.currentMessage = null;
    reject(new TimeoutError("Message send", timeout));
    this.processNextMessage();
  } else {
    // Message still in queue
    const index = this.messageQueue.indexOf(messageObj);
    if (index > -1) {
      this.messageQueue.splice(index, 1);
      reject(new TimeoutError("Message queued", timeout));
    }
  }
}, timeout);
```

**Recovery**: Process moves to next message in queue (process still healthy)

### Process Crashes

**Detection**:
```typescript
this.process.on("exit", (code, signal) => {
  logger.info("Process exited", { code, signal });

  // Reject pending messages
  if (this.currentMessage) {
    this.currentMessage.reject(new ProcessError("Process exited", this.teamName));
  }

  while (this.messageQueue.length > 0) {
    const msg = this.messageQueue.shift()!;
    msg.reject(new ProcessError("Process exited", this.teamName));
  }

  this.emit("exited", { teamName: this.teamName, code, signal });
});
```

---

## Integration with Pool Manager

### Process Creation Flow

**PoolManager.getOrCreateProcess()**:
```typescript
async getOrCreateProcess(
  teamName: string,
  sessionId: string,
  fromTeam: string | null
): Promise<ClaudeProcess> {
  // Check pool first
  if (this.pool.has(teamName)) {
    const process = this.pool.get(teamName)!;

    // Verify still healthy
    const metrics = process.getMetrics();
    if (metrics.status !== "stopped") {
      return process;
    }
  }

  // Create new process
  const teamConfig = this.configManager.getTeamConfig(teamName);
  const idleTimeout = teamConfig.idleTimeout ?? this.config.idleTimeout;

  const process = new ClaudeProcess(
    teamName,
    teamConfig,
    idleTimeout,
    sessionId  // Resume this session
  );

  // Set up event listeners
  process.on("terminated", () => {
    this.pool.delete(teamName);
  });

  // Spawn process
  await process.spawn();

  // Add to pool
  this.pool.set(teamName, process);

  return process;
}
```

---

## Performance Characteristics

### Cold Start (New Process)

**Steps**:
1. Spawn Claude CLI (~500ms)
2. Wait for init message (~500ms)
3. Send ping message (~100ms)
4. Receive pong response (~100ms)

**Total**: ~1.2s

### Warm Start (Pooled Process)

**Steps**:
1. Look up process in pool (~1ms)
2. Check if idle (~1ms)
3. Send message directly (~100ms)
4. Receive response (variable, ~500ms average)

**Total**: ~600ms

**Speedup**: 2x faster than cold start

### Memory Usage

**Per Process**:
- Node.js overhead: ~10-20 MB
- Claude CLI process: ~50-100 MB
- Response buffers: ~1-5 MB

**Total Per Process**: ~60-125 MB

**Pool of 10 Processes**: ~600 MB - 1.25 GB

---

## Security Considerations

### Process Isolation

**Working Directory**: Each process runs in its team's project directory

```typescript
spawn("claude", args, {
  cwd: projectPath, // Isolated to team's directory
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});
```

**Effect**: Claude's file access is restricted to the team's project directory

### Permission Flags

**Default**: Claude prompts for permission on file writes, tool use, etc.

**Skip Permissions** (optional, per team):
```typescript
if (this.teamConfig.skipPermissions) {
  args.push("--dangerously-skip-permissions");
}
```

**Security Risk**: Claude can modify files without confirmation

**Recommendation**: Only enable for teams you fully trust

---

## Debugging Capabilities

### Debug Logs

**Activation**: Set `DEBUG=1` or `NODE_ENV=test`

**Flag Added**:
```typescript
if (process.env.NODE_ENV === "test" || process.env.DEBUG) {
  args.push("--debug");
}
```

**Claude Output**:
```
Logging to: /var/folders/.../debug-20250110-abc123.txt
```

### Metrics Exposure

**Real-Time Metrics**:
```typescript
const metrics = process.getMetrics();
```

**Output**:
```typescript
interface ProcessMetrics {
  pid?: number;
  status: ProcessStatus;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  idleTimeRemaining: number;
  queueLength: number;
}
```

---

## Testing Strategy

### Unit Tests

**Mock Process Spawning**:
```typescript
vi.spyOn(ClaudeProcess, "initializeSessionFile").mockResolvedValue(undefined);
```

**Test Coverage**:
- ✅ Static method path computation
- ✅ Message queue logic
- ✅ Timeout handling
- ✅ State transitions
- ✅ Event emission

### Integration Tests

**Real Process Spawning**:
```typescript
describe("ClaudeProcess Integration", () => {
  beforeAll(async () => {
    await ClaudeProcess.initializeSessionFile(
      teamConfig,
      sessionId,
      30000
    );
  }, 60000);

  it("should spawn and respond to messages", async () => {
    const process = new ClaudeProcess(
      "test-team",
      teamConfig,
      300000,
      sessionId
    );

    await process.spawn();
    const response = await process.sendMessage("ping", 10000);
    expect(response).toBeTruthy();
    await process.terminate();
  }, 30000);
});
```

---

## Common Issues and Solutions

### Issue: "Session file was not created"

**Symptom**: `ProcessError: Session file was not created at {path}`

**Solutions**:
1. Verify `~/.claude/projects/` exists: `mkdir -p ~/.claude/projects`
2. Check permissions: `ls -la ~/.claude`
3. Update Claude CLI: `npm install -g @anthropic-ai/claude-code`

### Issue: "Process stdin not available"

**Symptom**: Messages rejected with "Process stdin not available"

**Solutions**:
1. Check process health before sending: `metrics.status !== "stopped"`
2. Implement retry logic in caller
3. Review debug logs for process crash details

### Issue: Timeout errors after successful completion

**Symptom**: Timeout error appears 20+ seconds after process exits successfully

**Cause**: Timeout handler not cleared on process exit

**Solution**: CRITICAL - Clear timeout FIRST in exit handler:
```typescript
claudeProcess.on("exit", (code) => {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);  // MUST be first!
    timeoutHandle = null;
  }
  // Now handle exit logic...
});
```

---

## Future Enhancements

### 1. Streaming Response Callbacks

**Current**: Wait for complete response, then resolve promise

**Enhancement**: Stream chunks to caller in real-time

**API**:
```typescript
await process.sendMessage("Generate essay", {
  timeout: 60000,
  onChunk: (chunk: string) => {
    console.log("Chunk received:", chunk);
  },
});
```

### 2. Response Caching

**Current**: Every message is sent to Claude API

**Enhancement**: Cache responses for identical messages

---

## Conclusion

ClaudeProcess is the **core abstraction** for Claude CLI interaction that:

✅ **Dual-role**: Static initialization + instance management
✅ **Queue-based**: Sequential message processing prevents race conditions
✅ **Event-driven**: Observability throughout lifecycle
✅ **Timeout-safe**: Proper cleanup prevents spurious errors
✅ **Stream-JSON**: Structured protocol for reliable communication
✅ **Isolated**: Each process runs in its team's directory

This clean architecture makes the system:
- **Testable**: Mock static method for fast unit tests
- **Reliable**: Timeout handling, error recovery
- **Observable**: Events for monitoring and debugging
- **Scalable**: Process pooling with LRU eviction

---

**Last Updated**: 2025-10-10
**Architecture Version**: Phase 1 (Post-Refactor)
**Next Review**: When implementing streaming callbacks (Phase 2+)
