# Print Execution Subsystem

**Status:** Implementation Phase
**Created:** 2025-10-15
**Feature:** Execute one-off `claude --print` commands for slash commands and utilities

---

## Problem Statement

Iris manages long-lived Claude processes in `--headless --stream-json` mode for interactive conversations. However, some operations require one-off command execution:

1. **Session initialization**: `claude --session-id <id> --print ping` (creates session file)
2. **Slash commands**: `claude --resume <id> --print /compact` (compact conversation history)
3. **Utility commands**: Future support for `/help`, `/clear`, custom commands

These operations are **fundamentally different** from streaming mode:
- No persistent stdin/stdout streams
- Command specified as CLI argument, not sent via stdin
- Process exits after single response
- No JSON streaming protocol

### Why Not Use Transport?

The `Transport` abstraction (Phase 1) is designed for **persistent streaming processes**:

```typescript
interface Transport {
  spawn(cacheEntry: CacheEntry): Promise<void>  // Start streaming
  executeTell(cacheEntry: CacheEntry): void     // Send via stdin
  terminate(): Promise<void>                     // Stop streaming
}
```

**Key differences for --print mode:**

| Aspect | Streaming (Transport) | Print (This Subsystem) |
|--------|----------------------|------------------------|
| Lifecycle | Long-lived, reused | Ephemeral, one-shot |
| Input | Via stdin (JSON) | Via CLI args (string) |
| Output | Continuous stream | Single response |
| Protocol | stream-json | Plain text |
| Caching | CacheEntry per message | No caching needed |

**Attempting to use Transport would require:**
- ❌ Adding `executeCommand()` method (pollutes interface)
- ❌ Creating fake CacheEntry objects (semantic mismatch)
- ❌ Handling two execution models in one abstraction (complexity)

**Better approach:** Separate subsystem that mirrors Transport pattern but with print-specific semantics.

---

## Solution Architecture

### Design Principle

Mirror the Transport pattern (local/remote abstraction) without the Transport interface:

```
TransportFactory → Transport implementations (LocalTransport, SSHTransport)
      ↓
ClaudeProcess (streaming mode)

ClaudePrintExecutor → Print implementations (local/remote logic)
      ↓
Utility functions (compact, session init, future slash commands)
```

### Component Structure

```
src/utils/
├── claude-print.ts              # ClaudePrintExecutor class + factory
└── claude-print.test.ts         # Unit tests
```

---

## Implementation

### ClaudePrintExecutor Class

**File:** `src/utils/claude-print.ts`

```typescript
/**
 * Claude Print Executor - Execute one-off commands via claude --print
 *
 * This subsystem handles ephemeral command execution (slash commands, utilities)
 * as opposed to persistent streaming processes (Transport).
 *
 * Mirrors Transport pattern (local/remote abstraction) but implements
 * print-specific semantics:
 * - Command in CLI args (not stdin)
 * - Single response (not streaming)
 * - Process exits after completion
 */

import { spawn, ChildProcess } from 'child_process';
import { getChildLogger } from './logger.js';
import { ProcessError, TimeoutError } from './errors.js';
import type { IrisConfig } from '../process-pool/types.js';

const logger = getChildLogger('utils:claude-print');

export interface ClaudePrintOptions {
  /** Command to execute (e.g., "ping", "/compact", "/help") */
  command: string;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Whether to use --resume (true) or --session-id (false) */
  resume?: boolean;
}

export interface ClaudePrintResult {
  /** Exit code from claude process */
  exitCode: number;

  /** stdout output */
  stdout: string;

  /** stderr output */
  stderr: string;

  /** Duration in milliseconds */
  duration: number;

  /** Whether command completed successfully */
  success: boolean;

  /** Debug log path (if available) */
  debugLogPath?: string;
}

/**
 * ClaudePrintExecutor - Executes one-off commands via claude --print
 *
 * Factory pattern:
 * ```typescript
 * const executor = ClaudePrintExecutor.create(teamConfig, sessionId);
 * const result = await executor.execute({ command: '/compact', resume: true });
 * ```
 */
export class ClaudePrintExecutor {
  private constructor(
    private irisConfig: IrisConfig,
    private sessionId: string
  ) {}

  /**
   * Factory method - creates executor for team config
   */
  static create(irisConfig: IrisConfig, sessionId: string): ClaudePrintExecutor {
    return new ClaudePrintExecutor(irisConfig, sessionId);
  }

  /**
   * Execute command via claude --print
   * Delegates to local or remote implementation based on config
   */
  async execute(options: ClaudePrintOptions): Promise<ClaudePrintResult> {
    const { command, timeout = 30000, resume = true } = options;

    logger.info('Executing claude --print command', {
      command,
      sessionId: this.sessionId,
      remote: !!this.irisConfig.remote,
      resume,
      timeout
    });

    if (this.irisConfig.remote) {
      return this.executeRemote(command, timeout, resume);
    } else {
      return this.executeLocal(command, timeout, resume);
    }
  }

  /**
   * Execute locally via child_process.spawn
   * Command: claude --resume <sessionId> --print <command>
   */
  private async executeLocal(
    command: string,
    timeout: number,
    resume: boolean
  ): Promise<ClaudePrintResult> {
    const startTime = Date.now();

    // Use custom claudePath if provided, otherwise default to 'claude'
    const claudeExecutable = this.irisConfig.claudePath || 'claude';

    // Build command args
    const args = [
      resume ? '--resume' : '--session-id',
      this.sessionId,
      '--print',
      command
    ];

    logger.debug('Spawning local claude process', {
      command: `${claudeExecutable} ${args.join(' ')}`,
      cwd: this.irisConfig.path
    });

    // Spawn Claude
    const claudeProcess = spawn(claudeExecutable, args, {
      cwd: this.irisConfig.path,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    // Close stdin immediately - we're not sending input
    claudeProcess.stdin!.end();

    return this.waitForCompletion(claudeProcess, timeout, startTime);
  }

  /**
   * Execute remotely via SSH
   * Command: ssh <host> "cd <path> && claude --resume <sessionId> --print <command>"
   */
  private async executeRemote(
    command: string,
    timeout: number,
    resume: boolean
  ): Promise<ClaudePrintResult> {
    const startTime = Date.now();

    // Use custom claudePath if provided, otherwise default to 'claude'
    const claudeExecutable = this.irisConfig.claudePath || 'claude';

    // Build remote command
    const claudeArgs = [
      resume ? '--resume' : '--session-id',
      this.sessionId,
      '--print',
      command
    ];

    const remoteCommand = `cd ${this.escapeShellArg(this.irisConfig.path)} && ${claudeExecutable} ${claudeArgs.join(' ')}`;

    // Parse SSH connection string (e.g., "ssh inanna" → ["ssh", "inanna"])
    const remoteParts = this.irisConfig.remote!.split(/\s+/);
    const sshExecutable = remoteParts[0]; // Should be "ssh"
    const sshArgs = remoteParts.slice(1); // Host and any SSH flags

    // Build SSH command: ssh <host> "cd <path> && claude ..."
    const fullArgs = [...sshArgs, remoteCommand];

    logger.debug('Spawning remote claude process via SSH', {
      command: `${sshExecutable} ${fullArgs.join(' ')}`,
      remote: this.irisConfig.remote
    });

    // Spawn SSH process
    const sshProcess = spawn(sshExecutable, fullArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    });

    // Close stdin immediately
    sshProcess.stdin!.end();

    return this.waitForCompletion(sshProcess, timeout, startTime);
  }

  /**
   * Wait for process to complete and collect output
   * Used by both local and remote execution
   */
  private async waitForCompletion(
    process: ChildProcess,
    timeout: number,
    startTime: number
  ): Promise<ClaudePrintResult> {
    return new Promise((resolve, reject) => {
      let stdoutData = '';
      let stderrData = '';
      let debugLogPath: string | null = null;
      let spawnError: Error | null = null;
      let responseReceived = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Capture stdout
      process.stdout!.on('data', (data: Buffer) => {
        const output = data.toString();
        stdoutData += output;

        logger.debug('Print command stdout', {
          sessionId: this.sessionId,
          output: output.substring(0, 500)
        });

        if (output.length > 0) {
          responseReceived = true;
        }
      });

      // Capture stderr
      process.stderr!.on('data', (data: Buffer) => {
        const errorOutput = data.toString();
        stderrData += errorOutput;

        // Extract debug log path if present
        const logPathMatch = errorOutput.match(/Logging to: (.+)/);
        if (logPathMatch && !debugLogPath) {
          debugLogPath = logPathMatch[1].trim();
          logger.debug('Debug logs available', {
            sessionId: this.sessionId,
            debugLogPath
          });
        }

        logger.debug('Print command stderr', {
          sessionId: this.sessionId,
          stderr: errorOutput
        });
      });

      // Handle spawn errors
      process.on('error', (err) => {
        logger.error({ err, sessionId: this.sessionId }, 'Process spawn error');
        spawnError = err;
      });

      // Handle process exit
      process.on('exit', (code) => {
        // Clear timeout immediately
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        const duration = Date.now() - startTime;
        const exitCode = code ?? -1;

        if (spawnError) {
          logger.error({
            err: spawnError,
            sessionId: this.sessionId,
            exitCode,
            stdoutLength: stdoutData.length,
            stderrLength: stderrData.length
          }, 'Process exited with spawn error');

          reject(spawnError);
        } else if (exitCode !== 0 && exitCode !== 143) {
          // 143 is SIGTERM (ok)
          logger.warn({
            sessionId: this.sessionId,
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            debugLogPath
          }, 'Command failed with non-zero exit code');

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: false,
            debugLogPath: debugLogPath ?? undefined
          });
        } else if (!responseReceived) {
          logger.warn({
            sessionId: this.sessionId,
            exitCode,
            stdout: stdoutData,
            stderr: stderrData
          }, 'Command completed but no response received');

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: false,
            debugLogPath: debugLogPath ?? undefined
          });
        } else {
          // Success
          logger.info('Command completed successfully', {
            sessionId: this.sessionId,
            exitCode,
            stdoutLength: stdoutData.length,
            duration
          });

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: true,
            debugLogPath: debugLogPath ?? undefined
          });
        }
      });

      // Timeout handler
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        logger.error({
          sessionId: this.sessionId,
          timeout,
          responseReceived,
          stdout: stdoutData,
          stderr: stderrData
        }, 'Command execution timed out');

        process.kill();

        const errorMsg = [
          `Command execution timed out after ${timeout}ms`,
          `Response received: ${responseReceived}`,
          debugLogPath ? `Debug logs: ${debugLogPath}` : null
        ]
          .filter(Boolean)
          .join('\n');

        reject(new TimeoutError(errorMsg, timeout));
      }, timeout);
    });
  }

  /**
   * Escape shell argument for safe command execution
   * Used for remote SSH commands
   */
  private escapeShellArg(arg: string): string {
    // Single-quote the argument and escape any single quotes within
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
```

---

## Usage Examples

### Session Initialization (Existing Use Case)

**Current:** `ClaudeProcess.initializeSessionFile()` has inline implementation
**Future:** Migrate to ClaudePrintExecutor for consistency

```typescript
// Current (inline implementation)
static async initializeSessionFile(irisConfig: IrisConfig, sessionId: string) {
  // ... spawn logic inline ...
}

// Future (using ClaudePrintExecutor)
static async initializeSessionFile(irisConfig: IrisConfig, sessionId: string) {
  const executor = ClaudePrintExecutor.create(irisConfig, sessionId);
  const result = await executor.execute({
    command: 'ping',
    resume: false,  // Use --session-id (create new session)
    timeout: 30000
  });

  if (!result.success) {
    throw new ProcessError(`Session initialization failed: ${result.stderr}`);
  }
}
```

### Compact Action (New Use Case)

```typescript
// src/actions/compact.ts
export async function compact(
  input: CompactInput,
  iris: IrisOrchestrator,
  sessionManager: SessionManager,
  configManager: TeamsConfigManager
): Promise<CompactOutput> {
  const { team, fromTeam, timeout = 30000 } = input;

  // Get team configuration
  const teamConfig = configManager.getConfig().teams[team];
  const session = sessionManager.getSession(fromTeam, team);

  if (!session) {
    return {
      team,
      success: false,
      response: `No active session found`,
      duration: 0,
      timestamp: Date.now()
    };
  }

  // Execute /compact via print mode
  const executor = ClaudePrintExecutor.create(teamConfig, session.sessionId);
  const result = await executor.execute({
    command: '/compact',
    resume: true,  // Use --resume (existing session)
    timeout
  });

  return {
    team,
    success: result.success,
    response: result.stdout.trim() || result.stderr,
    duration: result.duration,
    timestamp: Date.now(),
    debugLogPath: result.debugLogPath
  };
}
```

### Future: Help Command

```typescript
// src/actions/help.ts
export async function help(
  teamConfig: IrisConfig,
  sessionId: string
): Promise<HelpOutput> {
  const executor = ClaudePrintExecutor.create(teamConfig, sessionId);
  const result = await executor.execute({
    command: '/help',
    resume: true,
    timeout: 10000
  });

  return {
    helpText: result.stdout,
    success: result.success
  };
}
```

---

## Remote Execution Support

ClaudePrintExecutor automatically handles remote execution via SSH when `irisConfig.remote` is specified:

**Local execution:**
```bash
cd /path/to/project && claude --resume session-123 --print /compact
```

**Remote execution:**
```bash
ssh inanna "cd /opt/containers && claude --resume session-123 --print /compact"
```

**Key behaviors:**
- Uses `irisConfig.remote` connection string (e.g., "ssh inanna")
- Respects `irisConfig.claudePath` for custom Claude locations
- Applies shell escaping for remote commands
- Works with SSH config aliases and ProxyJump

---

## Comparison with Transport

| Feature | Transport (Streaming) | ClaudePrintExecutor (One-off) |
|---------|----------------------|-------------------------------|
| **Purpose** | Long-lived processes | Ephemeral commands |
| **Lifecycle** | spawn() → executeTell() × N → terminate() | execute() once |
| **Input** | Via stdin (JSON) | Via CLI args (string) |
| **Output** | Continuous stream | Single response |
| **Caching** | CacheEntry per message | No caching |
| **Process reuse** | Yes (pooled) | No (one-shot) |
| **Used by** | ClaudeProcess, ClaudeProcessPool | Utility actions (compact, init) |
| **Remote support** | ✅ Via SSH transports | ✅ Via SSH command wrapping |

---

## Testing Strategy

### Unit Tests

**File:** `tests/unit/utils/claude-print.test.ts`

```typescript
describe('ClaudePrintExecutor', () => {
  describe('Local execution', () => {
    it('should execute command successfully', async () => {
      const executor = ClaudePrintExecutor.create(localConfig, 'session-123');
      const result = await executor.execute({
        command: '/compact',
        resume: true,
        timeout: 10000
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    });

    it('should handle timeout', async () => {
      const executor = ClaudePrintExecutor.create(localConfig, 'session-123');

      await expect(
        executor.execute({
          command: '/compact',
          timeout: 1  // 1ms timeout
        })
      ).rejects.toThrow(TimeoutError);
    });

    it('should capture debug log path', async () => {
      const executor = ClaudePrintExecutor.create(localConfig, 'session-123');
      const result = await executor.execute({ command: 'ping' });

      if (result.debugLogPath) {
        expect(result.debugLogPath).toContain('.claude');
      }
    });

    it('should use custom claudePath', async () => {
      const config = {
        ...localConfig,
        claudePath: '~/.local/bin/claude'
      };

      const executor = ClaudePrintExecutor.create(config, 'session-123');
      const result = await executor.execute({ command: 'ping' });

      expect(result.success).toBe(true);
    });
  });

  describe('Remote execution', () => {
    it('should execute command via SSH', async () => {
      const remoteConfig = {
        ...localConfig,
        remote: 'ssh inanna',
        claudePath: '~/.local/bin/claude'
      };

      const executor = ClaudePrintExecutor.create(remoteConfig, 'session-123');
      const result = await executor.execute({
        command: '/compact',
        resume: true
      });

      expect(result.success).toBe(true);
    });

    it('should escape shell arguments for remote', async () => {
      const remoteConfig = {
        path: "/path with spaces/project",
        remote: 'ssh host',
        description: 'Test'
      };

      const executor = ClaudePrintExecutor.create(remoteConfig, 'session-123');
      // Should not fail due to unescaped spaces
      await executor.execute({ command: 'ping' });
    });
  });

  describe('--resume vs --session-id', () => {
    it('should use --resume when resume=true', async () => {
      const executor = ClaudePrintExecutor.create(localConfig, 'session-123');
      const result = await executor.execute({
        command: 'ping',
        resume: true
      });

      expect(result.success).toBe(true);
    });

    it('should use --session-id when resume=false', async () => {
      const executor = ClaudePrintExecutor.create(localConfig, 'session-new');
      const result = await executor.execute({
        command: 'ping',
        resume: false
      });

      expect(result.success).toBe(true);
    });
  });
});
```

### Integration Tests

**File:** `tests/integration/claude-print.test.ts`

```typescript
describe('ClaudePrintExecutor integration', () => {
  it('should execute /compact on active session', async () => {
    // Setup: Create session and send messages
    const sessionId = await createTestSession();
    await sendTestMessages(sessionId, 5);

    // Execute compact
    const executor = ClaudePrintExecutor.create(testConfig, sessionId);
    const result = await executor.execute({
      command: '/compact',
      resume: true,
      timeout: 30000
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('compacted');
  });

  it('should handle non-existent session gracefully', async () => {
    const executor = ClaudePrintExecutor.create(testConfig, 'nonexistent-session');
    const result = await executor.execute({
      command: '/compact',
      resume: true
    });

    // Should fail gracefully
    expect(result.success).toBe(false);
    expect(result.stderr).toBeTruthy();
  });
});
```

---

## Future Enhancements

### 1. Migrate initializeSessionFile()

Replace inline implementation in `ClaudeProcess.initializeSessionFile()` with ClaudePrintExecutor:

```typescript
// Before: 150+ lines of inline spawn logic
static async initializeSessionFile(irisConfig: IrisConfig, sessionId: string) {
  const args = ['--session-id', sessionId, '--print', 'ping'];
  const claudeProcess = spawn('claude', args, { ... });
  // ... 150 lines ...
}

// After: Clean delegation to ClaudePrintExecutor
static async initializeSessionFile(irisConfig: IrisConfig, sessionId: string) {
  const executor = ClaudePrintExecutor.create(irisConfig, sessionId);
  const result = await executor.execute({
    command: 'ping',
    resume: false,
    timeout: 30000
  });

  if (!result.success) {
    throw new ProcessError(`Session init failed: ${result.stderr}`);
  }

  // Verify session file exists
  const sessionPath = ClaudeProcess.getSessionFilePath(irisConfig.path, sessionId);
  if (!existsSync(sessionPath)) {
    throw new ProcessError(`Session file not created: ${sessionPath}`);
  }
}
```

**Benefits:**
- ✅ DRY - No code duplication
- ✅ Consistent - Same execution logic for all print commands
- ✅ Remote support - Automatically works with remote teams

### 2. Support Additional Slash Commands

When Claude Code adds support:

```typescript
// /help command
const result = await executor.execute({ command: '/help', resume: true });

// /clear command
const result = await executor.execute({ command: '/clear', resume: true });

// Custom project commands
const result = await executor.execute({ command: '/analyze-logs', resume: true });
```

### 3. Add Retry Logic

For transient failures:

```typescript
class ClaudePrintExecutor {
  async execute(options: ClaudePrintOptions): Promise<ClaudePrintResult> {
    const maxRetries = options.retries ?? 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeInternal(options);
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          await this.delay(1000 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    throw lastError;
  }
}
```

### 4. Add Metrics Tracking

Track print command performance:

```typescript
interface ClaudePrintMetrics {
  command: string;
  duration: number;
  success: boolean;
  remote: boolean;
  timestamp: number;
}

// Emit metrics for monitoring
this.emit('command-completed', metrics);
```

---

## Design Rationale

### Why Not Extend Transport?

**Option 1: Extend Transport interface** ❌
```typescript
interface Transport {
  spawn(cacheEntry): Promise<void>
  executeTell(cacheEntry): void
  executeCommand(command: string): Promise<result>  // NEW
}
```

**Problems:**
- Violates single responsibility (two execution models)
- Pollutes Transport with print semantics
- Forces all transports to implement print mode
- Complicates testing and maintenance

**Option 2: Separate subsystem** ✅
```typescript
ClaudePrintExecutor.create(config, sessionId).execute({ command })
```

**Benefits:**
- Clean separation of concerns
- Mirrors Transport pattern without interface pollution
- Independent testing and evolution
- Clear semantic distinction

### Why Factory Pattern?

**Mirrors ClaudeProcess usage:**
```typescript
// ClaudeProcess uses TransportFactory
const process = new ClaudeProcess(teamName, config, sessionId);
// (internally calls TransportFactory.create())

// ClaudePrintExecutor uses factory method
const executor = ClaudePrintExecutor.create(config, sessionId);
```

**Benefits:**
- Consistent API across codebase
- Encapsulates construction complexity
- Easy to extend with subclasses if needed

### Why Not Child Classes?

**Could do:**
```typescript
class LocalPrintExecutor extends ClaudePrintExecutor { }
class RemotePrintExecutor extends ClaudePrintExecutor { }
```

**But:**
- Overkill for simple local/remote branching
- Private methods are sufficient
- Easier to maintain single class
- Future SSH transport variations handled by config

---

## Migration Path

### Phase 1: Core Implementation (Week 1)
- ✅ Create `src/utils/claude-print.ts` with ClaudePrintExecutor
- ✅ Implement local execution (executeLocal)
- ✅ Implement remote execution (executeRemote)
- ✅ Add unit tests

### Phase 2: Compact Action (NOT IMPLEMENTED - Removed)
- ~~Create `src/actions/compact.ts`~~
- ~~Use ClaudePrintExecutor for /compact~~
- ~~Register team_compact MCP tool~~ (Feature removed - incomplete implementation)
- ~~Add integration tests~~

### Phase 3: Refactor initializeSessionFile (Week 2)
- Replace inline implementation with ClaudePrintExecutor
- Verify session initialization still works
- Update tests

### Phase 4: Additional Commands (Future)
- Support /help, /clear when available
- Add retry logic
- Add metrics tracking

---

## Open Questions

1. **Should initializeSessionFile migrate immediately or later?**
   - **Answer**: Later (Phase 3) - prove ClaudePrintExecutor works first with compact action

2. **How to handle command-specific validation?**
   - **Answer**: ClaudePrintExecutor is dumb executor, validation happens in actions (compact, help, etc.)

3. **Should we support command chaining (multiple commands)?**
   - **Answer**: No - one command per execution, chain at action level if needed

4. **Logging level for stdout/stderr?**
   - **Answer**: Debug level for full output, info level for truncated (first 500 chars)

---

**Document Version:** 1.0
**Last Updated:** 2025-01-15
**Status:** Ready for Implementation
**Next Steps:** Implement `src/utils/claude-print.ts`
