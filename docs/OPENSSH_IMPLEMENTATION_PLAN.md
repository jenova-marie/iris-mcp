# OpenSSH Client Transport Implementation Plan

**Status:** Ready for Implementation
**Target:** Phase 2.1 - Remote Execution (OpenSSH Client)
**Estimated Effort:** 3-5 days
**Dependencies:** Phase 1 (Transport Abstraction) - COMPLETED ✅

---

## Overview

This document outlines the implementation plan for `SSHTransport`, which uses the local OpenSSH client (`ssh` command) to execute Claude Code on remote hosts. This is the **default** and **recommended** implementation for remote execution.

**Key Principle:** Keep it simple - delegate SSH complexity to OpenSSH, Iris just spawns and pipes stdio.

---

## Architecture

### High-Level Flow

```
ClaudeProcessPool
    ↓
TransportFactory.create(irisConfig)
    ↓ (if remote && !ssh2)
SSHTransport
    ↓
child_process.spawn('ssh', [...args])
    ↓
stdio pipes ← → SSH tunnel ← → Remote Claude
```

### Component Responsibilities

**SSHTransport:**
- Build SSH command from `irisConfig.remote` + remote Claude command
- Spawn SSH process via `child_process.spawn()`
- Pipe stdin/stdout/stderr bidirectionally
- Parse JSON output from remote Claude
- Handle process lifecycle (spawn, tell, terminate)

**OpenSSH Client:**
- Handle SSH connection, authentication, encryption
- Tunnel stdio streams to/from remote host
- Apply `~/.ssh/config` automatically
- Manage keepalive, reconnect (built-in)

---

## Implementation Steps

### Step 1: Create SSHTransport Class

**File:** `src/transport/remote-ssh-client-transport.ts`

**Class Structure:**

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { CacheEntry } from '../cache/types.js';
import type { Transport, TransportMetrics } from './transport.interface.js';
import type { IrisConfig } from '../process-pool/types.js';
import { getChildLogger } from '../utils/logger.js';
import { ProcessError } from '../utils/errors.js';

/**
 * SSHTransport - Execute Claude remotely via local SSH client
 *
 * Uses the local ssh command (OpenSSH) to establish connection and execute Claude.
 * Leverages existing ~/.ssh/config, agent, ProxyJump, etc.
 */
export class SSHTransport extends EventEmitter implements Transport {
  private sshProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private ready = false;
  private startTime = 0;
  private responseBuffer = '';
  private logger: ReturnType<typeof getChildLogger>;
  private remoteHost: string;

  // Init promise for spawn()
  private initResolve: (() => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;

  // Metrics tracking
  private messagesProcessed = 0;
  private lastResponseAt: number | null = null;

  constructor(
    private teamName: string,
    private irisConfig: IrisConfig,
    private sessionId: string,
  ) {
    super();
    this.logger = getChildLogger(`transport:ssh-client:${teamName}`);

    if (!irisConfig.remote) {
      throw new ProcessError(
        'Remote host not specified in config',
        this.teamName,
      );
    }

    this.remoteHost = irisConfig.remote;
  }

  async spawn(spawnCacheEntry: CacheEntry, spawnTimeout = 20000): Promise<void> {
    // Implementation here
  }

  executeTell(cacheEntry: CacheEntry): void {
    // Implementation here
  }

  async terminate(): Promise<void> {
    // Implementation here
  }

  isReady(): boolean {
    return this.ready && this.currentCacheEntry === null;
  }

  isBusy(): boolean {
    return this.currentCacheEntry !== null;
  }

  getMetrics(): TransportMetrics {
    return {
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      messagesProcessed: this.messagesProcessed,
      lastResponseAt: this.lastResponseAt,
    };
  }

  cancel(): void {
    // Send Ctrl+C to remote process
  }

  private buildSSHCommand(): string[] {
    // Build ssh command array
  }

  private buildClaudeCommand(): string {
    // Build remote Claude command
  }

  private setupStdioHandlers(process: ChildProcess): void {
    // Setup stdout/stderr handlers
  }

  private handleStdoutData(data: Buffer): void {
    // Parse JSON from stdout
  }

  private async waitForInit(timeout: number): Promise<void> {
    // Wait for init message
  }

  private escapeShellArg(arg: string): string {
    // Escape shell arguments
  }
}
```

---

### Step 2: Build SSH Command

**Goal:** Construct the `ssh` command array from config

**Input:**
- `irisConfig.remote`: `"ssh inanna"` or `"ssh user@host"`
- `irisConfig.remoteOptions`: Optional SSH parameters

**Output:**
```typescript
['ssh', '-T', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', 'inanna', 'cd /opt/containers && claude --print ...']
```

**Implementation:**

```typescript
private buildSSHCommand(): string[] {
  const sshArgs: string[] = [];

  // Parse remote string to extract ssh command and arguments
  // Examples:
  //   "ssh inanna" → ssh executable, "inanna" host
  //   "ssh -J bastion user@host" → ssh executable, "-J bastion user@host"
  const remoteParts = this.remoteHost.split(/\s+/);
  const sshExecutable = remoteParts[0]; // Should be "ssh"

  if (sshExecutable !== 'ssh') {
    throw new ProcessError(
      `Remote command must start with "ssh", got: ${sshExecutable}`,
      this.teamName,
    );
  }

  // Add user-provided SSH args (everything after "ssh")
  const userSshArgs = remoteParts.slice(1); // e.g., ["-J", "bastion", "user@host"]

  // Add Iris-managed SSH options
  sshArgs.push(
    '-T',                                  // Disable PTY allocation (cleaner stdio)
    '-o', 'ServerAliveInterval=30',        // Keepalive every 30s
    '-o', 'ServerAliveCountMax=3',         // Max 3 missed keepalives
    '-o', 'BatchMode=yes',                 // Disable interactive prompts
    '-o', 'StrictHostKeyChecking=yes',    // Strict host key checking (default)
  );

  // Apply remoteOptions overrides
  if (this.irisConfig.remoteOptions) {
    const opts = this.irisConfig.remoteOptions;

    if (opts.identity) {
      sshArgs.push('-i', opts.identity);
    }

    if (opts.port) {
      sshArgs.push('-p', String(opts.port));
    }

    if (opts.strictHostKeyChecking === false) {
      // Override strict checking (not recommended for production)
      sshArgs.splice(
        sshArgs.indexOf('StrictHostKeyChecking=yes'),
        1,
        'StrictHostKeyChecking=no',
      );
      this.logger.warn('StrictHostKeyChecking disabled', {
        teamName: this.teamName,
      });
    }

    if (opts.compression) {
      sshArgs.push('-C'); // Enable compression
    }

    if (opts.forwardAgent) {
      sshArgs.push('-A'); // Forward SSH agent
    }

    if (opts.serverAliveInterval) {
      // Override default keepalive interval
      const idx = sshArgs.indexOf('ServerAliveInterval=30');
      if (idx !== -1) {
        sshArgs[idx] = `ServerAliveInterval=${Math.floor(opts.serverAliveInterval / 1000)}`;
      }
    }

    if (opts.serverAliveCountMax) {
      const idx = sshArgs.indexOf('ServerAliveCountMax=3');
      if (idx !== -1) {
        sshArgs[idx] = `ServerAliveCountMax=${opts.serverAliveCountMax}`;
      }
    }
  }

  // Append user SSH args (host, -J flags, etc.)
  sshArgs.push(...userSshArgs);

  // Append remote command
  const remoteCommand = this.buildClaudeCommand();
  sshArgs.push(remoteCommand);

  this.logger.debug('Built SSH command', {
    teamName: this.teamName,
    sshArgs: sshArgs.join(' '),
  });

  return ['ssh', ...sshArgs];
}
```

---

### Step 3: Build Remote Claude Command

**Goal:** Construct the Claude CLI command to execute on remote host

**Output:**
```bash
cd /opt/containers && claude --print --verbose --input-format stream-json --output-format stream-json --resume session-id
```

**Implementation:**

```typescript
private buildClaudeCommand(): string {
  const args: string[] = ['claude'];

  // Resume existing session (unless in test mode)
  if (process.env.NODE_ENV !== 'test') {
    args.push('--resume', this.sessionId);
  }

  // Enable debug mode in test/debug environment
  if (process.env.NODE_ENV === 'test' || process.env.DEBUG) {
    args.push('--debug');
  }

  args.push(
    '--print',                    // Non-interactive headless mode
    '--verbose',                  // Required for stream-json output
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
  );

  if (this.irisConfig.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  // Change to project directory, then execute Claude
  const cdCmd = `cd ${this.escapeShellArg(this.irisConfig.path)}`;
  const claudeCmd = args.join(' ');

  return `${cdCmd} && ${claudeCmd}`;
}

private escapeShellArg(arg: string): string {
  // Single-quote the argument and escape any single quotes within
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
```

---

### Step 4: Spawn SSH Process

**Goal:** Spawn SSH process with stdio pipes

**Implementation:**

```typescript
async spawn(spawnCacheEntry: CacheEntry, spawnTimeout = 20000): Promise<void> {
  if (this.sshProcess) {
    throw new ProcessError('SSH process already spawned', this.teamName);
  }

  this.logger.info('Spawning remote Claude via SSH client', {
    teamName: this.teamName,
    sessionId: this.sessionId,
    remoteHost: this.remoteHost,
    cacheEntryType: spawnCacheEntry.cacheEntryType,
  });

  // Set current cache entry for init messages
  this.currentCacheEntry = spawnCacheEntry;
  this.startTime = Date.now();

  // Build SSH command
  const sshCommand = this.buildSSHCommand();

  this.logger.debug('Spawning SSH process', {
    teamName: this.teamName,
    command: sshCommand.join(' '),
  });

  // Spawn SSH process
  this.sshProcess = spawn(sshCommand[0], sshCommand.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],  // stdin, stdout, stderr
    shell: false,                       // Direct execution, no shell wrapper
  });

  // Setup stdio handlers
  this.setupStdioHandlers(this.sshProcess);

  // Emit spawned event
  this.emit('process-spawned', {
    teamName: this.teamName,
    pid: this.sshProcess.pid,
    remoteHost: this.remoteHost,
  });

  // Send spawn ping
  this.writeToStdin(spawnCacheEntry.tellString);

  // Wait for init message
  await this.waitForInit(spawnTimeout);

  this.ready = true;
  this.logger.info('Remote SSH client transport ready', {
    teamName: this.teamName,
    pid: this.sshProcess.pid,
    spawnDuration: Date.now() - this.startTime,
  });
}
```

---

### Step 5: Setup Stdio Handlers

**Goal:** Pipe stdout/stderr from SSH process, parse JSON output

**Key Challenge:** SSH may inject its own messages to stderr (warnings, debug info). We need to:
1. Only parse JSON from stdout
2. Log stderr separately (may contain SSH warnings or remote Claude errors)

**Implementation:**

```typescript
private setupStdioHandlers(process: ChildProcess): void {
  // Stdout handler - parse JSON
  process.stdout!.on('data', (data: Buffer) => {
    this.handleStdoutData(data);
  });

  // Stderr handler - log warnings/errors
  process.stderr!.on('data', (data: Buffer) => {
    const stderrOutput = data.toString();

    // Log stderr output
    this.logger.debug('Remote SSH stderr', {
      teamName: this.teamName,
      output: stderrOutput.substring(0, 500), // Truncate for logging
    });

    // Check for SSH-specific errors
    if (stderrOutput.includes('Permission denied')) {
      this.logger.error('SSH authentication failed', {
        teamName: this.teamName,
        remoteHost: this.remoteHost,
        stderr: stderrOutput,
      });
    }

    if (stderrOutput.includes('Host key verification failed')) {
      this.logger.error('SSH host key verification failed', {
        teamName: this.teamName,
        remoteHost: this.remoteHost,
        stderr: stderrOutput,
      });
    }
  });

  // Exit handler
  process.on('exit', (code: number | null, signal: string | null) => {
    this.logger.info('SSH process exited', {
      teamName: this.teamName,
      remoteHost: this.remoteHost,
      code,
      signal,
    });

    this.emit('process-exited', {
      teamName: this.teamName,
      code,
      signal,
    });

    this.sshProcess = null;
    this.ready = false;
    this.currentCacheEntry = null;
  });

  // Error handler
  process.on('error', (error: Error) => {
    this.logger.error(
      {
        err: error,
        teamName: this.teamName,
        remoteHost: this.remoteHost,
      },
      'SSH process error',
    );

    this.emit('process-error', {
      teamName: this.teamName,
      error,
    });
  });

  // Close handler
  process.on('close', (code: number | null, signal: string | null) => {
    this.logger.debug('SSH process closed', {
      teamName: this.teamName,
      code,
      signal,
    });
  });
}
```

---

### Step 6: Parse Stdout JSON

**Goal:** Parse newline-delimited JSON from remote Claude stdout

**Key Points:**
- Remote Claude outputs stream-json format (one JSON object per line)
- SSH should NOT inject anything into stdout (we use `-T` flag)
- Handle partial lines (buffer until newline)

**Implementation:**

```typescript
private handleStdoutData(data: Buffer): void {
  const rawData = data.toString();
  this.responseBuffer += rawData;

  // Parse newline-delimited JSON
  const lines = this.responseBuffer.split('\n');
  this.responseBuffer = lines.pop() || ''; // Keep last incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue; // Skip empty lines

    try {
      const json = JSON.parse(line);

      this.logger.debug('Parsed JSON message from remote Claude', {
        teamName: this.teamName,
        type: json.type,
        subtype: json.subtype,
      });

      // DUMB PIPE: Just write to current cache entry
      if (this.currentCacheEntry) {
        this.currentCacheEntry.addMessage(json);
      }

      // Special handling for init (resolve spawn promise)
      if (json.type === 'system' && json.subtype === 'init') {
        if (this.initResolve) {
          this.initResolve();
          this.initResolve = null;
          this.initReject = null;
        }
      }

      // Clear current cache entry on result
      if (json.type === 'result') {
        this.logger.debug('Result message received, clearing cache entry', {
          teamName: this.teamName,
        });

        // Update metrics
        this.messagesProcessed++;
        this.lastResponseAt = Date.now();

        this.currentCacheEntry = null; // Ready for next tell
      }
    } catch (e) {
      // Not JSON, log warning
      this.logger.debug('Non-JSON stdout line from remote Claude', {
        teamName: this.teamName,
        line: line.substring(0, 200),
      });
    }
  }
}
```

---

### Step 7: Execute Tell

**Goal:** Send message to remote Claude via SSH stdin

**Implementation:**

```typescript
executeTell(cacheEntry: CacheEntry): void {
  if (!this.ready) {
    throw new ProcessError('SSH transport not ready', this.teamName);
  }

  if (!this.sshProcess || !this.sshProcess.stdin) {
    throw new ProcessError('SSH process stdin not available', this.teamName);
  }

  if (this.currentCacheEntry) {
    throw new ProcessBusyError('SSH transport already processing a request');
  }

  this.logger.debug('Executing tell on remote SSH transport', {
    teamName: this.teamName,
    cacheEntryType: cacheEntry.cacheEntryType,
    tellStringLength: cacheEntry.tellString.length,
  });

  // Set current cache entry
  this.currentCacheEntry = cacheEntry;

  // Write to stdin
  this.writeToStdin(cacheEntry.tellString);
}

private writeToStdin(message: string): void {
  if (!this.sshProcess || !this.sshProcess.stdin || !this.sshProcess.stdin.writable) {
    throw new ProcessError('SSH process stdin not writable', this.teamName);
  }

  // Format as Claude stream-json input
  const userMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: message }],
    },
  };

  this.sshProcess.stdin.write(JSON.stringify(userMessage) + '\n');

  this.logger.debug('Wrote message to remote stdin', {
    teamName: this.teamName,
    messageLength: message.length,
  });
}
```

---

### Step 8: Terminate SSH Process

**Goal:** Gracefully terminate SSH connection

**Implementation:**

```typescript
async terminate(): Promise<void> {
  if (!this.sshProcess) return;

  this.logger.info('Terminating SSH client process', {
    teamName: this.teamName,
    remoteHost: this.remoteHost,
    pid: this.sshProcess.pid,
  });

  return new Promise<void>((resolve) => {
    if (!this.sshProcess) {
      resolve();
      return;
    }

    // Force kill after 5 seconds
    const killTimer = setTimeout(() => {
      if (this.sshProcess) {
        this.logger.warn('Force killing SSH process', {
          teamName: this.teamName,
        });
        this.sshProcess.kill('SIGKILL');
      }
    }, 5000);

    // Clean up on exit
    this.sshProcess.once('exit', () => {
      clearTimeout(killTimer);
      this.sshProcess = null;
      this.ready = false;
      this.currentCacheEntry = null;

      this.emit('process-terminated', {
        teamName: this.teamName,
        remoteHost: this.remoteHost,
      });

      resolve();
    });

    // Try graceful shutdown first - SIGTERM
    this.sshProcess.kill('SIGTERM');
  });
}
```

---

### Step 9: Cancel Operation

**Goal:** Send Ctrl+C (SIGINT) to remote Claude process

**Implementation:**

```typescript
cancel(): void {
  if (!this.sshProcess || !this.sshProcess.stdin || !this.sshProcess.stdin.writable) {
    this.logger.warn('Cancel called but SSH stdin not available', {
      teamName: this.teamName,
      hasSshProcess: !!this.sshProcess,
      remoteHost: this.remoteHost,
    });
    return; // Gracefully handle
  }

  this.logger.info('Sending cancel (Ctrl+C) to remote process', {
    teamName: this.teamName,
    remoteHost: this.remoteHost,
    isBusy: this.currentCacheEntry !== null,
  });

  // Send Ctrl+C character
  this.sshProcess.stdin.write('\x03');

  this.logger.debug('Cancel signal sent to remote stdin');
}
```

---

### Step 10: Wait for Init

**Goal:** Wait for remote Claude to send init message after spawn

**Implementation:**

```typescript
private async waitForInit(timeout = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    this.initResolve = resolve;
    this.initReject = reject;

    const timeoutId = setTimeout(() => {
      this.initReject = null;
      this.initResolve = null;
      reject(
        new ProcessError('Init timeout on remote SSH transport', this.teamName),
      );
    }, timeout);

    // Wrap resolve to clear timeout
    const originalResolve = this.initResolve;
    this.initResolve = () => {
      clearTimeout(timeoutId);
      originalResolve();
    };
  });
}
```

---

## Testing Strategy

### Unit Tests

**File:** `tests/unit/transport/remote-ssh-client-transport.test.ts`

**Test Cases:**

1. ✅ **Constructor validation**
   - Throws error if `remote` not specified
   - Extracts remote host correctly

2. ✅ **buildSSHCommand()**
   - Handles simple host: `"ssh inanna"` → `['ssh', '-T', ..., 'inanna', 'cd ...']`
   - Handles user@host: `"ssh user@host"` → includes user
   - Handles ProxyJump: `"ssh -J bastion user@host"` → preserves `-J`
   - Applies remoteOptions (identity, port, compression, etc.)
   - Overrides strictHostKeyChecking when false

3. ✅ **buildClaudeCommand()**
   - Includes `--resume sessionId` in production
   - Excludes `--resume` in test mode
   - Includes `--dangerously-skip-permissions` if configured
   - Escapes shell arguments properly

4. ✅ **escapeShellArg()**
   - Handles paths with spaces: `/opt/my path` → `'/opt/my path'`
   - Handles paths with quotes: `/opt/mom's files` → `'/opt/mom'\''s files'`

5. ✅ **handleStdoutData()**
   - Parses valid JSON lines
   - Handles partial lines (buffering)
   - Ignores non-JSON output
   - Detects init message
   - Detects result message (clears cache entry)

6. ✅ **Error handling**
   - Detects SSH auth failures in stderr
   - Detects host key verification failures
   - Handles process exit codes

### Integration Tests

**File:** `tests/integration/remote/remote-ssh-client.test.ts`

**Prerequisites:**
- SSH server accessible (localhost or remote)
- Claude installed on remote host
- SSH keys configured

**Test Cases:**

1. ✅ **Spawn remote Claude via localhost SSH**
   ```typescript
   it('should spawn Claude on localhost via SSH', async () => {
     const config: IrisConfig = {
       remote: 'ssh localhost',
       path: '/tmp/test-project',
       description: 'Test team',
     };

     const transport = new SSHTransport('test', config, 'session-1');
     const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

     await transport.spawn(spawnEntry);

     expect(transport.isReady()).toBe(true);
   });
   ```

2. ✅ **Execute tell command**
   ```typescript
   it('should execute tell command via SSH', async () => {
     // ... spawn first
     const tellEntry = new CacheEntryImpl(CacheEntryType.TELL, 'What is 2+2?');

     transport.executeTell(tellEntry);

     // Wait for result
     await waitForResult(tellEntry, 30000);

     expect(tellEntry.messages.length).toBeGreaterThan(0);
   });
   ```

3. ✅ **Handle SSH failures**
   ```typescript
   it('should fail gracefully on bad host', async () => {
     const config: IrisConfig = {
       remote: 'ssh nonexistent.invalid',
       path: '/tmp/test',
       description: 'Bad host',
     };

     const transport = new SSHTransport('test', config, 'session-1');
     const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

     await expect(transport.spawn(spawnEntry)).rejects.toThrow();
   });
   ```

4. ✅ **Terminate gracefully**
   ```typescript
   it('should terminate SSH process gracefully', async () => {
     // ... spawn first
     await transport.terminate();

     expect(transport.isReady()).toBe(false);
   });
   ```

---

## Error Handling

### SSH Client Errors

**Common Errors:**

1. **Authentication Failure**
   - **Stderr:** `Permission denied (publickey)`
   - **Action:** Log error, fail spawn, suggest checking SSH keys

2. **Host Key Verification Failed**
   - **Stderr:** `Host key verification failed`
   - **Action:** Log error, fail spawn, suggest `ssh-keyscan`

3. **Connection Refused**
   - **Stderr:** `Connection refused`
   - **Action:** Log error, fail spawn, suggest checking host/port

4. **Timeout**
   - **Stderr:** `Connection timed out`
   - **Action:** Log error, fail spawn, suggest checking network

5. **Command Not Found**
   - **Stderr:** `claude: command not found`
   - **Action:** Log error, fail spawn, suggest installing Claude on remote

**Error Detection:**

```typescript
private detectSSHError(stderr: string): void {
  if (stderr.includes('Permission denied')) {
    throw new ProcessError(
      'SSH authentication failed - check SSH keys or agent',
      this.teamName,
    );
  }

  if (stderr.includes('Host key verification failed')) {
    throw new ProcessError(
      'SSH host key verification failed - run: ssh-keyscan <host> >> ~/.ssh/known_hosts',
      this.teamName,
    );
  }

  if (stderr.includes('Connection refused')) {
    throw new ProcessError(
      'SSH connection refused - check host and port',
      this.teamName,
    );
  }

  if (stderr.includes('command not found') && stderr.includes('claude')) {
    throw new ProcessError(
      'Claude not installed on remote host - install Claude CLI',
      this.teamName,
    );
  }
}
```

---

## PTY vs No-PTY Trade-offs

### No PTY (`-T` flag) - RECOMMENDED

**Advantages:**
- ✅ Clean stdout (no ANSI codes, no terminal control sequences)
- ✅ Easier to parse JSON
- ✅ No echo of stdin input
- ✅ More predictable behavior

**Disadvantages:**
- ❌ Remote program can't detect terminal size
- ❌ Interactive prompts won't work
- ❌ No job control (Ctrl+Z won't work)

**Use case:** Perfect for Claude Code headless mode (non-interactive)

### With PTY (`-tt` flag)

**Advantages:**
- ✅ Terminal features work (colors, cursor control)
- ✅ Interactive prompts work
- ✅ Job control works

**Disadvantages:**
- ❌ Stdout polluted with ANSI codes
- ❌ Harder to parse JSON
- ❌ Echo of stdin input
- ❌ Less predictable output

**Use case:** Interactive SSH sessions, not suitable for stream-json

**Decision:** Use `-T` (no PTY) for cleaner stdio streaming.

---

## Stdin/Stdout/Stderr Streaming

### Bidirectional Streaming Architecture

```
Local Iris                     SSH Tunnel                 Remote Host
──────────                     ──────────                 ───────────

stdin.write(json) ──────────────→ encrypted ──────────→ remote stdin
                                  SSH
stdout.on('data') ←────────────── tunnel ←────────────── remote stdout

stderr.on('data') ←───────────────────────────────────── remote stderr
```

### Key Principles

1. **Stdin is for user messages only**
   - Write newline-delimited JSON
   - One message per line
   - Claude expects stream-json format

2. **Stdout is for Claude responses only**
   - Read newline-delimited JSON
   - Parse each line as separate JSON object
   - Handle partial lines (buffer until `\n`)

3. **Stderr is for errors/warnings**
   - SSH may inject warnings here
   - Remote Claude errors appear here
   - Log separately, don't mix with stdout

4. **No PTY means clean stdio**
   - No ANSI escape codes in stdout
   - No echoing of stdin
   - No terminal control sequences

---

## Configuration Updates

### Add `ssh2` flag to IrisConfig

**File:** `src/process-pool/types.ts`

```typescript
export interface IrisConfig {
  // ... existing fields

  // NEW: SSH implementation selection
  ssh2?: boolean; // Use ssh2 library instead of OpenSSH client (default: false)
}
```

### Update TransportFactory

**File:** `src/transport/transport-factory.ts`

```typescript
export class TransportFactory {
  static create(teamName: string, irisConfig: IrisConfig, sessionId: string): Transport {
    if (!irisConfig.remote) {
      // Local execution
      return new LocalTransport(teamName, irisConfig, sessionId);
    }

    // Remote execution - choose SSH implementation
    if (irisConfig.ssh2) {
      // Opt-in: Use ssh2 library with ssh-config parsing
      return new RemoteSSH2Transport(teamName, irisConfig, sessionId);
    } else {
      // Default: Use local OpenSSH client
      return new SSHTransport(teamName, irisConfig, sessionId);
    }
  }
}
```

---

## Implementation Checklist

### Phase 2.1: OpenSSH Client Transport (3-5 days)

**Day 1:**
- [x] Create `SSHTransport` class skeleton
- [ ] Implement `buildSSHCommand()`
- [ ] Implement `buildClaudeCommand()`
- [ ] Implement `escapeShellArg()`
- [ ] Write unit tests for command building

**Day 2:**
- [ ] Implement `spawn()` method
- [ ] Implement `setupStdioHandlers()`
- [ ] Implement `handleStdoutData()` with JSON parsing
- [ ] Implement `waitForInit()`
- [ ] Write unit tests for stdio handling

**Day 3:**
- [ ] Implement `executeTell()`
- [ ] Implement `writeToStdin()`
- [ ] Implement `terminate()`
- [ ] Implement `cancel()`
- [ ] Write unit tests for tell/terminate

**Day 4:**
- [ ] Add SSH error detection in stderr handler
- [ ] Implement error handling and logging
- [ ] Update `TransportFactory` to use OpenSSH transport
- [ ] Update `IrisConfig` with `ssh2` flag
- [ ] Write integration tests (localhost SSH)

**Day 5:**
- [ ] Test with real remote host (team-inanna)
- [ ] Performance benchmarking (local vs remote)
- [ ] Documentation updates
- [ ] Code review and refinement

---

## Success Criteria

✅ **Functional Requirements:**
1. Spawn Claude on remote host via SSH
2. Execute tell commands and receive responses
3. Handle graceful termination
4. Support SSH config files automatically
5. Support ProxyJump and complex SSH setups

✅ **Performance Requirements:**
1. Remote spawn ≤ 5s (local + network latency)
2. Remote tell ≤ 3s (local + network latency)
3. No memory leaks in stdio streaming

✅ **Reliability Requirements:**
1. Detect SSH auth failures
2. Detect connection failures
3. Graceful error messages with remediation hints
4. No data loss in stdio streaming

---

## Next Steps

After OpenSSH Client Transport is complete:

1. **Phase 2.2:** Implement `RemoteSSH2Transport` (ssh2 library + ssh-config)
2. **Phase 3:** Add reconnect logic and session state tracking
3. **Phase 4:** E2E testing and performance optimization

---

**Document Version:** 1.0
**Last Updated:** October 2025
**Status:** Ready for Implementation
