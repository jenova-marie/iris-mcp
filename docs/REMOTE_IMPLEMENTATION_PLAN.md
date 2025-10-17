# Remote Team Execution - Implementation Plan

**Document Version:** 1.0
**Created:** 2025-10-14
**Status:** Ready for Implementation
**Estimated Timeline:** 5-6 weeks

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Transport Abstraction (Week 1)](#phase-1-transport-abstraction-week-1)
3. [Phase 2: SSH2Transport (Week 2-3)](#phase-2-SSH2Transport-week-2-3)
4. [Phase 3: Reconnect Logic & Session State (Week 4)](#phase-3-reconnect-logic--session-state-week-4)
5. [Phase 4: Dashboard Fork Enhancement (Week 5)](#phase-4-dashboard-fork-enhancement-week-5)
6. [Phase 5: Testing & Documentation (Week 6)](#phase-5-testing--documentation-week-6)
7. [Dependencies & Blockers](#dependencies--blockers)
8. [Success Criteria](#success-criteria)

---

## Overview

This implementation plan covers:

1. **Remote Team Execution** - Allow teams to specify SSH commands for remote Claude Code execution
2. **Dashboard Fork Enhancement** - Update the dashboard fork feature to support remote sessions
3. **Session State Management** - Track connection health (online/offline/error)
4. **Auto-Reconnect** - Handle transient network failures gracefully

**Key Files to Modify:**
```
src/
├── config/
│   ├── iris-config.ts                    # Add remote fields to schema
│   └── types.ts                          # Type definitions
├── process-pool/
│   ├── claude-process.ts                 # Delegate to transport
│   ├── pool-manager.ts                   # Connection state tracking
│   └── types.ts                          # Add connection state types
├── transport/                            # NEW DIRECTORY
│   ├── transport.interface.ts            # Transport interface
│   ├── local-transport.ts                # Extract from ClaudeProcess
│   ├── remote-ssh-transport.ts           # SSH implementation
│   └── transport-factory.ts              # Factory pattern
├── session/
│   └── session-manager.ts                # Add connection_state columns
├── dashboard/
│   ├── client/src/pages/ProcessMonitor.tsx    # Remote fork UI
│   ├── client/src/api/client.ts               # Remote fork API
│   └── server/routes/processes.ts             # Remote fork endpoint
└── actions/
    └── is-awake.ts                       # Add connection state to response
```

---

## Phase 1: Transport Abstraction (Week 1)

**Goal:** Refactor ClaudeProcess to use pluggable Transport interface, preparing for remote execution.

### Task 1.1: Define Transport Interface

**File:** `src/transport/transport.interface.ts` (NEW)

```typescript
/**
 * Transport Interface - Abstraction for local vs remote execution
 */
export interface Transport {
  /**
   * Spawn Claude process (local or remote)
   * @param spawnCacheEntry - Cache entry for initialization message
   */
  spawn(spawnCacheEntry: CacheEntry): Promise<void>;

  /**
   * Execute tell by writing to stdin
   * @param cacheEntry - Cache entry containing message
   */
  executeTell(cacheEntry: CacheEntry): void;

  /**
   * Terminate process gracefully
   */
  terminate(): Promise<void>;

  /**
   * Check if transport is ready to receive messages
   */
  isReady(): boolean;

  /**
   * Check if currently processing a message
   */
  isBusy(): boolean;

  /**
   * Get transport metrics (uptime, messages, etc.)
   */
  getMetrics(): TransportMetrics;
}

export interface TransportMetrics {
  uptime: number;
  messagesProcessed: number;
  lastResponseAt: number | null;
}
```

**Estimated Time:** 2 hours

---

### Task 1.2: Extract LocalTransport from ClaudeProcess

**File:** `src/transport/local-transport.ts` (NEW)

**Strategy:** Copy all existing spawn/executeTell/terminate logic from ClaudeProcess into LocalTransport.

```typescript
import { spawn, type ChildProcess } from 'child_process';
import type { CacheEntry } from '../cache/types.js';
import type { Transport, TransportMetrics } from './transport.interface.js';
import type { IrisConfig } from '../config/types.js';
import { getChildLogger } from '../utils/logger.js';
import { ProcessError } from '../utils/errors.js';

export class LocalTransport implements Transport {
  private childProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private ready = false;
  private startTime = 0;
  private messagesProcessed = 0;
  private lastResponseAt: number | null = null;
  private logger = getChildLogger(`transport:local:${this.teamName}`);

  constructor(
    private teamName: string,
    private irisConfig: IrisConfig,
    private sessionId: string | null
  ) {}

  async spawn(spawnCacheEntry: CacheEntry): Promise<void> {
    // Existing spawn logic from ClaudeProcess
    // - Build claude command
    // - Spawn child process
    // - Set up stdio handlers
    // - Wait for init message
  }

  executeTell(cacheEntry: CacheEntry): void {
    // Existing executeTell logic from ClaudeProcess
    // - Validate ready state
    // - Write JSON to stdin
    // - Track current cache entry
  }

  async terminate(): Promise<void> {
    // Existing terminate logic from ClaudeProcess
    // - SIGTERM with 5s timeout
    // - SIGKILL fallback
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

  // Private helpers (existing logic from ClaudeProcess)
  private handleStdoutData(data: Buffer): void { ... }
  private handleStderrData(data: Buffer): void { ... }
  private handleExit(code: number | null, signal: string | null): void { ... }
  private async waitForInit(cacheEntry: CacheEntry, timeout: number): Promise<void> { ... }
}
```

**Estimated Time:** 4 hours

---

### Task 1.3: Implement TransportFactory

**File:** `src/transport/transport-factory.ts` (NEW)

```typescript
import type { Transport } from './transport.interface.js';
import { LocalTransport } from './local-transport.js';
import type { IrisConfig } from '../config/types.js';

export class TransportFactory {
  static create(
    teamName: string,
    irisConfig: IrisConfig,
    sessionId: string | null
  ): Transport {
    // Phase 1: Only LocalTransport
    // Phase 2: Add SSH2Transport
    if (irisConfig.remote) {
      throw new Error('Remote execution not yet implemented');
    }

    return new LocalTransport(teamName, irisConfig, sessionId);
  }
}
```

**Estimated Time:** 1 hour

---

### Task 1.4: Refactor ClaudeProcess to Use Transport

**File:** `src/process-pool/claude-process.ts` (MODIFY)

**Changes:**

```typescript
import { TransportFactory } from '../transport/transport-factory.js';
import type { Transport } from '../transport/transport.interface.js';

export class ClaudeProcess extends EventEmitter {
  private transport: Transport;  // NEW

  constructor(teamName: string, irisConfig: IrisConfig, sessionId: string | null) {
    super();
    this.teamName = teamName;
    this.irisConfig = irisConfig;
    this.sessionId = sessionId;

    // NEW: Use factory to create transport
    this.transport = TransportFactory.create(teamName, irisConfig, sessionId);

    // Remove all old childProcess, spawn, executeTell logic
    // Delegate to transport instead
  }

  async spawn(spawnCacheEntry: CacheEntry): Promise<void> {
    this.state = ProcessState.SPAWNING;
    await this.transport.spawn(spawnCacheEntry);
    this.state = ProcessState.IDLE;
    this.emit('process-spawned', { teamName: this.teamName, pid: this.getPid() });
  }

  executeTell(cacheEntry: CacheEntry): void {
    this.state = ProcessState.PROCESSING;
    this.transport.executeTell(cacheEntry);
  }

  async terminate(): Promise<void> {
    this.state = ProcessState.TERMINATING;
    await this.transport.terminate();
    this.state = ProcessState.STOPPED;
    this.emit('process-terminated', { teamName: this.teamName });
  }

  isReady(): boolean {
    return this.transport.isReady();
  }

  isBusy(): boolean {
    return this.transport.isBusy();
  }

  getMetrics() {
    return this.transport.getMetrics();
  }
}
```

**Estimated Time:** 3 hours

---

### Task 1.5: Update Config Schema (Preparation)

**File:** `src/config/iris-config.ts` (MODIFY)

**Add remote fields to IrisConfigSchema (not yet functional, just schema):**

```typescript
const IrisConfigSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
  description: z.string(),

  // NEW: Remote execution (Phase 2)
  remote: z.string().optional(),
  remoteOptions: z.object({
    identity: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    strictHostKeyChecking: z.boolean().optional(),
    connectTimeout: z.number().positive().optional(),
    serverAliveInterval: z.number().positive().optional(),
    serverAliveCountMax: z.number().int().positive().optional(),
  }).optional(),

  // Existing fields
  idleTimeout: z.number().positive().optional(),
  sessionInitTimeout: z.number().positive().optional(),
  skipPermissions: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
    .optional(),
});
```

**Estimated Time:** 1 hour

---

### Task 1.6: Unit Tests for Transport Abstraction

**File:** `tests/unit/transport/local-transport.test.ts` (NEW)

```typescript
describe('LocalTransport', () => {
  it('should spawn Claude process locally', async () => {
    const config = { path: '/test', description: 'Test' };
    const transport = new LocalTransport('test', config, null);
    const cacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

    await transport.spawn(cacheEntry);

    expect(transport.isReady()).toBe(true);
    expect(transport.isBusy()).toBe(false);
  });

  it('should execute tell and track busy state', () => {
    const transport = new LocalTransport('test', config, null);
    // ... spawn first ...
    const tellEntry = new CacheEntryImpl(CacheEntryType.TELL, 'test message');

    transport.executeTell(tellEntry);

    expect(transport.isBusy()).toBe(true);
  });
});

describe('TransportFactory', () => {
  it('should create LocalTransport when no remote config', () => {
    const config = { path: '/test', description: 'Test' };
    const transport = TransportFactory.create('test', config, null);

    expect(transport).toBeInstanceOf(LocalTransport);
  });

  it('should throw error for remote config in Phase 1', () => {
    const config = { path: '/test', description: 'Test', remote: 'ssh host' };

    expect(() => {
      TransportFactory.create('test', config, null);
    }).toThrow('Remote execution not yet implemented');
  });
});
```

**Estimated Time:** 2 hours

---

### Phase 1 Deliverables

- ✅ Transport interface defined
- ✅ LocalTransport extracted from ClaudeProcess
- ✅ ClaudeProcess refactored to delegate to Transport
- ✅ TransportFactory implemented
- ✅ Config schema updated (remote fields added, not functional)
- ✅ Unit tests for transport abstraction
- ✅ All existing functionality still works (backward compatible)

**Total Phase 1 Time:** ~13 hours (~1 week with buffer)

---

## Phase 2: SSH2Transport (Week 2-3)

**Goal:** Implement SSH tunneling transport for remote Claude Code execution.

### Task 2.1: Implement SSH2Transport Class

**File:** `src/transport/remote-ssh-transport.ts` (NEW)

**Key Implementation Details:**

```typescript
import { spawn, type ChildProcess } from 'child_process';
import type { CacheEntry } from '../cache/types.js';
import type { Transport, TransportMetrics } from './transport.interface.js';
import type { IrisConfig } from '../config/types.js';
import { getChildLogger } from '../utils/logger.js';
import { ProcessError, TimeoutError } from '../utils/errors.js';

export class SSH2Transport implements Transport {
  private sshProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private ready = false;
  private startTime = 0;
  private messagesProcessed = 0;
  private lastResponseAt: number | null = null;
  private logger = getChildLogger(`transport:ssh:${this.teamName}`);

  constructor(
    private teamName: string,
    private irisConfig: IrisConfig,
    private sessionId: string | null
  ) {}

  async spawn(spawnCacheEntry: CacheEntry): Promise<void> {
    const sshCmd = this.irisConfig.remote!;
    const remotePath = this.irisConfig.path;

    // Build Claude command for remote execution
    const claudeArgs = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
    ];
    if (this.sessionId) {
      claudeArgs.push('--resume', this.sessionId);
    }

    const claudeCmd = `claude ${claudeArgs.join(' ')}`;

    // Build SSH command with keepalive
    const sshArgs = [
      this.irisConfig.remote,
      '-o', 'ServerAliveInterval=30',      // Keepalive every 30s
      '-o', 'ServerAliveCountMax=3',       // 3 failed keepalives = disconnect
      '-T',                                 // No PTY allocation
    ];

    // Add optional SSH options
    if (this.irisConfig.remoteOptions) {
      const opts = this.irisConfig.remoteOptions;
      if (opts.identity) {
        sshArgs.push('-i', opts.identity);
      }
      if (opts.port) {
        sshArgs.push('-p', String(opts.port));
      }
      if (opts.strictHostKeyChecking === false) {
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
      }
      if (opts.connectTimeout) {
        sshArgs.push('-o', `ConnectTimeout=${Math.floor(opts.connectTimeout / 1000)}`);
      }
    }

    // Full remote command: cd to path && run claude
    const remoteCommand = `cd ${remotePath} && ${claudeCmd}`;
    sshArgs.push(remoteCommand);

    this.logger.info({ sshCmd: sshArgs.join(' ') }, 'Spawning SSH process');

    // Spawn SSH process
    this.sshProcess = spawn('ssh', sshArgs.slice(1), {  // Skip first arg (it's the host)
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.currentCacheEntry = spawnCacheEntry;
    this.startTime = Date.now();

    // Set up stdio handlers (identical to LocalTransport)
    this.sshProcess.stdout!.on('data', (data) => {
      this.handleStdoutData(data);
    });

    this.sshProcess.stderr!.on('data', (data) => {
      this.logger.debug({ stderr: data.toString() }, 'SSH stderr');
    });

    this.sshProcess.on('exit', (code, signal) => {
      this.handleExit(code, signal);
    });

    this.sshProcess.on('error', (error) => {
      this.logger.error({ err: error }, 'SSH process error');
      this.handleError(error);
    });

    // Wait for Claude init message
    const timeout = this.irisConfig.sessionInitTimeout || 30000;
    await this.waitForInit(spawnCacheEntry, timeout);

    this.ready = true;
    this.currentCacheEntry = null; // Ready for tells
    this.logger.info('SSH transport ready');
  }

  executeTell(cacheEntry: CacheEntry): void {
    if (!this.sshProcess || !this.ready) {
      throw new ProcessError('SSH transport not ready');
    }

    if (this.currentCacheEntry !== null) {
      throw new ProcessError('SSH transport already processing');
    }

    this.currentCacheEntry = cacheEntry;

    // Write to SSH stdin (same format as LocalTransport)
    const message = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: cacheEntry.tellString,
      },
    }) + '\n';

    this.sshProcess.stdin!.write(message);
    this.logger.debug({ message: cacheEntry.tellString }, 'Sent message via SSH');
  }

  async terminate(): Promise<void> {
    if (!this.sshProcess) return;

    this.logger.info('Terminating SSH process');

    return new Promise((resolve) => {
      this.sshProcess!.once('exit', () => {
        this.logger.info('SSH process terminated');
        resolve();
      });

      this.sshProcess!.kill('SIGTERM');

      // Force kill after 5s
      setTimeout(() => {
        if (this.sshProcess && !this.sshProcess.killed) {
          this.logger.warn('Force killing SSH process (SIGKILL)');
          this.sshProcess.kill('SIGKILL');
        }
      }, 5000);
    });
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

  // Private helpers (similar to LocalTransport)
  private handleStdoutData(data: Buffer): void {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        if (this.currentCacheEntry) {
          this.currentCacheEntry.addMessage(parsed);

          // Check for completion
          if (parsed.type === 'result') {
            this.lastResponseAt = Date.now();
            this.messagesProcessed++;
            this.currentCacheEntry = null; // Ready for next tell
          }
        }
      } catch (error) {
        this.logger.warn({ line, err: error }, 'Failed to parse SSH stdout');
      }
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.ready = false;
    this.logger.info({ code, signal }, 'SSH process exited');

    if (this.currentCacheEntry && code !== 0) {
      this.currentCacheEntry.setError(
        new ProcessError(`SSH process exited with code ${code}`)
      );
    }
  }

  private handleError(error: Error): void {
    this.ready = false;
    if (this.currentCacheEntry) {
      this.currentCacheEntry.setError(error);
    }
  }

  private async waitForInit(cacheEntry: CacheEntry, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`SSH init timeout after ${timeout}ms`));
      }, timeout);

      // Wait for first message in cache (init message)
      const checkInit = () => {
        if (cacheEntry.getMessages().length > 0) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(checkInit, 100);
        }
      };

      checkInit();
    });
  }
}
```

**Estimated Time:** 8 hours

---

### Task 2.2: Update TransportFactory for Remote

**File:** `src/transport/transport-factory.ts` (MODIFY)

```typescript
import type { Transport } from './transport.interface.js';
import { LocalTransport } from './local-transport.js';
import { SSH2Transport } from './remote-ssh-transport.js';  // NEW
import type { IrisConfig } from '../config/types.js';

export class TransportFactory {
  static create(
    teamName: string,
    irisConfig: IrisConfig,
    sessionId: string | null
  ): Transport {
    // Check for remote execution
    if (irisConfig.remote) {
      return new SSH2Transport(teamName, irisConfig, sessionId);
    }

    return new LocalTransport(teamName, irisConfig, sessionId);
  }
}
```

**Estimated Time:** 30 minutes

---

### Task 2.3: Integration Tests with SSH

**File:** `tests/integration/transport/remote-ssh.test.ts` (NEW)

```typescript
describe('SSH2Transport', () => {
  describe('localhost SSH', () => {
    it('should spawn Claude on localhost via SSH', async () => {
      const config = {
        remote: 'ssh localhost',
        path: '/tmp/test-project',
        description: 'Test remote execution',
      };

      const transport = new SSH2Transport('test', config, null);
      const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

      await transport.spawn(spawnEntry);

      expect(transport.isReady()).toBe(true);
    });

    it('should execute tell via SSH', async () => {
      // ... spawn first ...
      const tellEntry = new CacheEntryImpl(CacheEntryType.TELL, 'What is 2+2?');

      transport.executeTell(tellEntry);

      // Wait for response
      await waitForCacheCompletion(tellEntry, 30000);

      expect(tellEntry.getMessages()).toHaveLength > 0;
    });
  });

  describe('connection failures', () => {
    it('should reject on connection timeout', async () => {
      const config = {
        remote: 'ssh nonexistent-host.local',
        path: '/tmp/test',
        description: 'Test timeout',
      };

      const transport = new SSH2Transport('test', config, null);
      const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

      await expect(transport.spawn(spawnEntry)).rejects.toThrow();
    });

    it('should reject on authentication failure', async () => {
      const config = {
        remote: 'ssh invalid-user@localhost',
        path: '/tmp/test',
        description: 'Test auth failure',
      };

      const transport = new SSH2Transport('test', config, null);
      const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

      await expect(transport.spawn(spawnEntry)).rejects.toThrow();
    });
  });
});
```

**Estimated Time:** 4 hours

---

### Task 2.4: Update Example Config

**File:** `src/example.config.yaml` (MODIFY)

```json
{
  "settings": { ... },
  "dashboard": { ... },
  "database": { ... },
  "teams": {
    "team-frontend": {
      "path": "/Users/jenova/projects/myapp/frontend",
      "description": "React frontend application - local execution"
    },
    "team-backend": {
      "path": "/Users/jenova/projects/myapp/backend",
      "description": "Node.js backend API - local execution",
      "idleTimeout": 600000
    },
    "team-cloud": {
      "remote": "ssh dev@cloud-dev.example.com",
      "path": "/home/dev/projects/backend",
      "description": "Backend team on cloud dev server - remote execution via SSH",
      "remoteOptions": {
        "identity": "~/.ssh/cloud_dev_rsa",
        "serverAliveInterval": 30000,
        "connectTimeout": 10000
      }
    },
    "team-gpu": {
      "remote": "ssh ml@gpu-cluster.example.com",
      "path": "/mnt/shared/ml-models",
      "description": "ML team with GPU access - remote execution",
      "remoteOptions": {
        "identity": "~/.ssh/gpu_cluster_rsa",
        "serverAliveInterval": 60000
      }
    }
  }
}
```

**Estimated Time:** 1 hour

---

### Phase 2 Deliverables

- ✅ SSH2Transport implemented
- ✅ TransportFactory updated to select remote vs local
- ✅ Integration tests with localhost SSH
- ✅ Example config with remote teams
- ✅ Remote teams can spawn and execute tells via SSH
- ✅ Session files stored on remote host

**Total Phase 2 Time:** ~13.5 hours (~2 weeks with testing buffer)

---

## Phase 3: Reconnect Logic & Session State (Week 4)

**Goal:** Handle network failures gracefully with auto-reconnect and session state tracking.

### Task 3.1: Add Session State Columns to Database

**File:** `src/session/session-manager.ts` (MODIFY)

**Database Migration:**

```typescript
// Add to initializeDatabase()
private initializeDatabase(): void {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS team_sessions (
      -- Existing columns
      id TEXT PRIMARY KEY,
      pool_key TEXT NOT NULL,
      from_team TEXT NOT NULL,
      to_team TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active',

      -- NEW: Connection state columns (Phase 3)
      connection_state TEXT DEFAULT 'online',      -- 'online' | 'offline' | 'error'
      error_message TEXT,
      last_offline_at INTEGER,
      reconnect_attempts INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_connection_state ON team_sessions(connection_state);
  `);
}

// NEW: Update connection state
updateConnectionState(
  sessionId: string,
  state: 'online' | 'offline' | 'error',
  errorMessage?: string
): void {
  const stmt = this.db.prepare(`
    UPDATE team_sessions
    SET connection_state = ?,
        error_message = ?,
        last_offline_at = CASE WHEN ? != 'online' THEN ? ELSE last_offline_at END
    WHERE id = ?
  `);

  stmt.run(
    state,
    errorMessage || null,
    state,
    state !== 'online' ? Date.now() : null,
    sessionId
  );
}

// NEW: Increment reconnect attempts
incrementReconnectAttempts(sessionId: string): void {
  const stmt = this.db.prepare(`
    UPDATE team_sessions
    SET reconnect_attempts = reconnect_attempts + 1
    WHERE id = ?
  `);

  stmt.run(sessionId);
}

// NEW: Reset reconnect attempts
resetReconnectAttempts(sessionId: string): void {
  const stmt = this.db.prepare(`
    UPDATE team_sessions
    SET reconnect_attempts = 0
    WHERE id = ?
  `);

  stmt.run(sessionId);
}

// MODIFY: getSession() to include connection state
getSession(poolKey: string): SessionRecord | null {
  const stmt = this.db.prepare(`
    SELECT
      id, pool_key, from_team, to_team, message_count,
      created_at, last_used_at, status,
      connection_state, error_message, last_offline_at, reconnect_attempts
    FROM team_sessions
    WHERE pool_key = ?
  `);

  return stmt.get(poolKey) as SessionRecord | null;
}
```

**Estimated Time:** 3 hours

---

### Task 3.2: Implement Auto-Reconnect in SSH2Transport

**File:** `src/transport/remote-ssh-transport.ts` (MODIFY)

**Add reconnect logic:**

```typescript
export class SSH2Transport implements Transport {
  // ... existing fields ...

  // NEW: Reconnect configuration
  private reconnectConfig = {
    maxAttempts: 5,
    backoffMs: [1000, 2000, 4000, 8000, 16000], // Exponential backoff
  };
  private reconnecting = false;

  // NEW: Session manager reference (injected via constructor)
  constructor(
    private teamName: string,
    private irisConfig: IrisConfig,
    private sessionId: string | null,
    private sessionManager: SessionManager  // NEW
  ) {}

  // MODIFY: handleExit to trigger reconnect
  private handleExit(code: number | null, signal: string | null): void {
    this.ready = false;
    this.logger.warn({ code, signal }, 'SSH connection dropped');

    // Trigger reconnect for transient failures
    if (!this.reconnecting && this.sessionId) {
      this.handleDisconnect();
    }
  }

  // NEW: Handle disconnect and attempt reconnect
  private handleDisconnect(): void {
    this.logger.info('SSH connection lost, attempting reconnect');

    // Update session state to OFFLINE
    if (this.sessionId) {
      this.sessionManager.updateConnectionState(this.sessionId, 'offline');
    }

    // Emit event for pool manager
    this.emit('offline', { teamName: this.teamName, sessionId: this.sessionId });

    // Start reconnect attempts
    this.attemptReconnect();
  }

  // NEW: Attempt reconnect with exponential backoff
  private async attemptReconnect(): Promise<void> {
    this.reconnecting = true;

    for (let attempt = 0; attempt < this.reconnectConfig.maxAttempts; attempt++) {
      this.logger.info(
        { attempt: attempt + 1, max: this.reconnectConfig.maxAttempts },
        'Reconnect attempt'
      );

      if (this.sessionId) {
        this.sessionManager.incrementReconnectAttempts(this.sessionId);
      }

      try {
        // Wait with exponential backoff
        await this.sleep(this.reconnectConfig.backoffMs[attempt]);

        // Attempt to reconnect
        await this.reconnect();

        // Success!
        this.logger.info('Reconnect successful');
        this.reconnecting = false;

        if (this.sessionId) {
          this.sessionManager.updateConnectionState(this.sessionId, 'online');
          this.sessionManager.resetReconnectAttempts(this.sessionId);
        }

        this.emit('online', { teamName: this.teamName, sessionId: this.sessionId });
        return;

      } catch (error) {
        this.logger.warn(
          { attempt: attempt + 1, error: error instanceof Error ? error.message : String(error) },
          'Reconnect attempt failed'
        );

        // Check if permanent failure
        if (this.isPermanentFailure(error)) {
          this.logger.error({ error }, 'Permanent failure detected, giving up');
          this.handlePermanentFailure(error);
          return;
        }

        // Continue retrying transient failures
      }
    }

    // Exhausted all retries
    this.logger.error('Max reconnect attempts exceeded');
    const error = new Error('Failed to reconnect after maximum attempts');
    this.handlePermanentFailure(error);
  }

  // NEW: Reconnect SSH connection
  private async reconnect(): Promise<void> {
    // Terminate old process if still exists
    if (this.sshProcess) {
      this.sshProcess.kill('SIGKILL');
      this.sshProcess = null;
    }

    // Create new cache entry for spawn
    const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'reconnect');

    // Re-spawn SSH process (reuse existing spawn logic)
    await this.spawn(spawnEntry);
  }

  // NEW: Check if error is permanent or transient
  private isPermanentFailure(error: any): boolean {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Authentication failures - permanent
    if (errorMsg.includes('Permission denied')) return true;
    if (errorMsg.includes('Authentication failed')) return true;
    if (errorMsg.includes('publickey')) return true;

    // Host key issues - permanent
    if (errorMsg.includes('Host key verification failed')) return true;
    if (errorMsg.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')) return true;

    // Command not found - permanent
    if (errorMsg.includes('command not found')) return true;
    if (errorMsg.includes('No such file or directory')) return true;

    // Network issues - transient (keep retrying)
    return false;
  }

  // NEW: Handle permanent failure
  private handlePermanentFailure(error: any): void {
    this.reconnecting = false;
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (this.sessionId) {
      this.sessionManager.updateConnectionState(this.sessionId, 'error', errorMsg);
    }

    this.emit('error', { teamName: this.teamName, sessionId: this.sessionId, error: errorMsg });
  }

  // NEW: Sleep helper
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Estimated Time:** 5 hours

---

### Task 3.3: Update team_isAwake to Return Connection State

**File:** `src/actions/is-awake.ts` (MODIFY)

```typescript
export async function handleTeamIsAwake(args: any) {
  // ... existing validation ...

  if (args.team) {
    // Single team status
    const status = poolManager.getProcessStatus(args.team, args.fromTeam);
    const sessionInfo = sessionManager.getSession(`${args.fromTeam}->${args.team}`);

    return {
      team: args.team,
      awake: status !== null && status.state !== 'stopped',
      state: status?.state || 'stopped',
      pid: status?.pid,

      // NEW: Connection state for remote teams
      connectionState: sessionInfo?.connection_state || 'online',
      reconnectAttempts: sessionInfo?.reconnect_attempts || 0,
      maxReconnectAttempts: 5,
      lastOfflineAt: sessionInfo?.last_offline_at,
      errorMessage: sessionInfo?.error_message,
    };
  }

  // All teams status (similar changes)
  const teams = configManager.getTeamNames();
  const statuses = teams.map((team) => {
    const status = poolManager.getProcessStatus(team, args.fromTeam);
    const sessionInfo = sessionManager.getSession(`${args.fromTeam}->${team}`);

    return {
      team,
      awake: status !== null && status.state !== 'stopped',
      state: status?.state || 'stopped',
      pid: status?.pid,
      connectionState: sessionInfo?.connection_state || 'online',
      reconnectAttempts: sessionInfo?.reconnect_attempts || 0,
      lastOfflineAt: sessionInfo?.last_offline_at,
      errorMessage: sessionInfo?.error_message,
    };
  });

  return { teams: statuses };
}
```

**Estimated Time:** 2 hours

---

### Task 3.4: Update Dashboard to Show Connection State

**File:** `src/dashboard/client/src/pages/ProcessMonitor.tsx` (MODIFY)

**Add connection state indicator:**

```tsx
// Add connection state badge
function getConnectionStateBadge(connectionState: string) {
  switch (connectionState) {
    case 'online':
      return <span className="text-xs text-status-idle">🟢 Online</span>;
    case 'offline':
      return <span className="text-xs text-status-processing">🟡 Reconnecting...</span>;
    case 'error':
      return <span className="text-xs text-status-offline">🔴 Error</span>;
    default:
      return null;
  }
}

// In session card render
<div className="flex items-start justify-between mb-4">
  <div>
    <h3 className="text-lg font-bold">{session.poolKey}</h3>
    {session.connectionState && session.connectionState !== 'online' && (
      <div className="mt-1">
        {getConnectionStateBadge(session.connectionState)}
        {session.reconnectAttempts > 0 && (
          <span className="text-xs text-text-secondary ml-2">
            (Attempt {session.reconnectAttempts}/{session.maxReconnectAttempts})
          </span>
        )}
      </div>
    )}
    {session.errorMessage && (
      <div className="text-xs text-status-offline mt-1">
        {session.errorMessage}
      </div>
    )}
  </div>
</div>
```

**Estimated Time:** 2 hours

---

### Phase 3 Deliverables

- ✅ Session state columns added to database
- ✅ Auto-reconnect with exponential backoff implemented
- ✅ Permanent vs transient failure detection
- ✅ team_isAwake returns connection state
- ✅ Dashboard shows connection state and reconnect attempts
- ✅ User-facing error messages with context

**Total Phase 3 Time:** ~12 hours (~1 week with buffer)

---

## Phase 4: Dashboard Fork Enhancement (Week 5)

**Goal:** Update the dashboard fork feature to support remote SSH sessions.

### Current Fork Implementation

**Location:** `src/dashboard/client/src/pages/ProcessMonitor.tsx:179-223`

**Current Behavior:**
1. User clicks "Fork" button for a session
2. Dashboard calls `api.launchTerminal(sessionId, toTeam)`
3. Backend executes terminal script: `~/.iris/terminal.sh sessionId teamPath`
4. Terminal script opens new terminal window with `claude --resume sessionId`

**Limitation:** Works only for local teams (teamPath is local).

---

### Task 4.1: Detect Remote vs Local Teams in Config

**File:** `src/config/iris-config.ts` (MODIFY)

**Add helper method:**

```typescript
export class TeamsConfigManager {
  // ... existing methods ...

  /**
   * Check if a team is configured for remote execution
   */
  isRemoteTeam(teamName: string): boolean {
    const config = this.getConfig();
    const team = config.teams[teamName];
    return team ? !!team.remote : false;
  }

  /**
   * Get remote SSH command for a team
   */
  getRemoteCommand(teamName: string): string | null {
    const config = this.getConfig();
    const team = config.teams[teamName];
    return team?.remote || null;
  }
}
```

**Estimated Time:** 1 hour

---

### Task 4.2: Update Terminal Script to Support Remote Sessions

**File:** `~/.iris/terminal.sh` (USER-PROVIDED, document required changes)

**Updated Script Template:**

```bash
#!/bin/bash
# Iris MCP - Terminal Fork Script
# This script is called by the dashboard to open a new terminal with the session

SESSION_ID=$1
TEAM_PATH=$2
SSH_COMMAND=$3  # NEW: Optional SSH command for remote teams

if [ -z "$SESSION_ID" ]; then
  echo "Error: SESSION_ID not provided"
  exit 1
fi

if [ -z "$TEAM_PATH" ]; then
  echo "Error: TEAM_PATH not provided"
  exit 1
fi

# Check if remote execution
if [ -n "$SSH_COMMAND" ]; then
  # REMOTE SESSION: SSH to remote host and run claude --resume
  echo "Forking remote session: $SESSION_ID via $SSH_COMMAND"

  # macOS: iTerm2
  if command -v osascript &> /dev/null; then
    osascript <<EOF
      tell application "iTerm"
        create window with default profile
        tell current session of current window
          write text "echo 'Connecting to remote session: $SESSION_ID'"
          write text "$SSH_COMMAND 'cd $TEAM_PATH && claude --resume $SESSION_ID'"
        end tell
      end tell
EOF
  # Linux: gnome-terminal / xterm
  elif command -v gnome-terminal &> /dev/null; then
    gnome-terminal -- bash -c "echo 'Connecting to remote session: $SESSION_ID'; $SSH_COMMAND 'cd $TEAM_PATH && claude --resume $SESSION_ID'; exec bash"
  elif command -v xterm &> /dev/null; then
    xterm -e "echo 'Connecting to remote session: $SESSION_ID'; $SSH_COMMAND 'cd $TEAM_PATH && claude --resume $SESSION_ID'; bash" &
  else
    echo "Error: No supported terminal emulator found"
    exit 1
  fi
else
  # LOCAL SESSION: Run claude --resume directly
  echo "Forking local session: $SESSION_ID at $TEAM_PATH"

  # macOS: iTerm2
  if command -v osascript &> /dev/null; then
    osascript <<EOF
      tell application "iTerm"
        create window with default profile
        tell current session of current window
          write text "cd $TEAM_PATH && claude --resume $SESSION_ID"
        end tell
      end tell
EOF
  # Linux: gnome-terminal / xterm
  elif command -v gnome-terminal &> /dev/null; then
    gnome-terminal --working-directory="$TEAM_PATH" -- bash -c "claude --resume $SESSION_ID; exec bash"
  elif command -v xterm &> /dev/null; then
    xterm -e "cd $TEAM_PATH && claude --resume $SESSION_ID; bash" &
  else
    echo "Error: No supported terminal emulator found"
    exit 1
  fi
fi

echo "Terminal launched successfully"
```

**Estimated Time:** 2 hours (documentation + testing)

---

### Task 4.3: Update Backend Fork Endpoint

**File:** `src/dashboard/server/routes/processes.ts` (MODIFY)

```typescript
// POST /api/fork - Launch terminal with session
router.post('/fork', async (req, res) => {
  const { sessionId, toTeam } = req.body;

  if (!sessionId || !toTeam) {
    return res.status(400).json({ error: 'sessionId and toTeam are required' });
  }

  try {
    const configManager = getConfigManager();
    const config = configManager.getConfig();
    const terminalScriptPath = config.dashboard?.terminalScriptPath;

    if (!terminalScriptPath) {
      return res.status(404).json({
        error: 'Terminal script not found. Please create ~/.iris/terminal.sh',
        remediation: 'See documentation for terminal script setup.',
      });
    }

    const teamConfig = configManager.getIrisConfig(toTeam);
    if (!teamConfig) {
      return res.status(404).json({ error: `Team "${toTeam}" not found` });
    }

    // NEW: Check if remote team
    const isRemote = !!teamConfig.remote;
    const teamPath = teamConfig.path;

    // Build arguments for terminal script
    const args = [sessionId, teamPath];

    // NEW: Add SSH command for remote teams
    if (isRemote) {
      args.push(teamConfig.remote);
    }

    logger.info({ sessionId, toTeam, isRemote }, 'Launching terminal fork');

    // Execute terminal script
    const child = spawn(terminalScriptPath, args, {
      detached: true,
      stdio: 'ignore',
    });

    child.unref(); // Allow parent to exit independently

    res.json({
      success: true,
      sessionId,
      toTeam,
      isRemote,
      message: isRemote
        ? `Remote terminal launched via SSH: ${teamConfig.remote}`
        : 'Local terminal launched',
    });
  } catch (error) {
    logger.error({ err: error, sessionId, toTeam }, 'Failed to launch terminal');
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
```

**Estimated Time:** 2 hours

---

### Task 4.4: Update Dashboard UI for Remote Fork

**File:** `src/dashboard/client/src/pages/ProcessMonitor.tsx` (MODIFY)

**Add remote indicator:**

```tsx
// Add to SessionProcessInfo interface
interface SessionProcessInfo {
  // ... existing fields ...
  isRemote?: boolean;  // NEW
  remoteHost?: string; // NEW
}

// Update Fork button to show remote indicator
{terminalScriptAvailable && (
  <button
    onClick={() => handleLaunchTerminal(session.sessionId, session.toTeam)}
    disabled={terminalStatus[session.sessionId] === 'launching'}
    className="btn-primary flex-1 flex items-center justify-center gap-2"
    title={session.isRemote
      ? `Fork remote session via SSH: ${session.remoteHost}`
      : "Fork session in new terminal"
    }
  >
    {terminalStatus[session.sessionId] === 'launching' ? (
      <>
        <Loader2 size={16} className="animate-spin" />
        {session.isRemote ? 'Connecting...' : 'Launching...'}
      </>
    ) : terminalStatus[session.sessionId] === 'success' ? (
      <>
        <Check size={16} />
        {session.isRemote ? 'Connected!' : 'Launched!'}
      </>
    ) : (
      <>
        <Terminal size={16} />
        Fork {session.isRemote && '🌐'}
      </>
    )}
  </button>
)}

{/* Add remote badge */}
{session.isRemote && (
  <div className="mt-2 flex items-center gap-1 text-xs text-accent-purple">
    <span>🌐 Remote:</span>
    <code className="bg-bg-dark px-1 rounded">{session.remoteHost}</code>
  </div>
)}
```

**Estimated Time:** 2 hours

---

### Task 4.5: Update Sessions API to Include Remote Info

**File:** `src/dashboard/server/routes/processes.ts` (MODIFY)

```typescript
// GET /api/sessions
router.get('/sessions', (_req, res) => {
  try {
    const configManager = getConfigManager();
    const poolManager = getPoolManager();
    const sessionManager = getSessionManager();

    const sessions = sessionManager.getAllSessions();
    const sessionInfos: any[] = [];

    for (const session of sessions) {
      const processStatus = poolManager.getProcessStatus(session.to_team, session.from_team);
      const teamConfig = configManager.getIrisConfig(session.to_team);

      sessionInfos.push({
        poolKey: session.pool_key,
        fromTeam: session.from_team,
        toTeam: session.to_team,
        sessionId: session.id,
        messageCount: session.message_count,
        createdAt: session.created_at,
        lastUsedAt: session.last_used_at,
        sessionStatus: session.status,
        connectionState: session.connection_state,
        errorMessage: session.error_message,
        reconnectAttempts: session.reconnect_attempts,

        // Process data
        processState: processStatus?.state || 'stopped',
        pid: processStatus?.pid,
        messagesProcessed: processStatus?.messagesProcessed || 0,
        uptime: processStatus?.uptime || 0,
        queueLength: processStatus?.queueLength || 0,
        lastResponseAt: processStatus?.lastResponseAt,

        // NEW: Remote execution info
        isRemote: !!teamConfig?.remote,
        remoteHost: teamConfig?.remote || null,
      });
    }

    res.json({
      sessions: sessionInfos,
      poolStatus: poolManager.getPoolStatus(),
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get sessions');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Estimated Time:** 1 hour

---

### Task 4.6: Documentation for Remote Fork

**File:** `docs/future/REMOTE_FORK.md` (NEW)

```markdown
# Remote Session Fork

## Overview

The dashboard fork feature allows you to open a new terminal window connected to an existing session. This works for both **local** and **remote** teams.

## How It Works

### Local Teams

1. Click "Fork" button in dashboard
2. Terminal script opens new window
3. Runs: `claude --resume <sessionId>`

### Remote Teams

1. Click "Fork 🌐" button in dashboard
2. Terminal script opens new window
3. Runs: `ssh user@remote-host 'cd /path && claude --resume <sessionId>'`
4. You can interact with the remote session directly

## Terminal Script Setup

Create `~/.iris/terminal.sh`:

```bash
#!/bin/bash
SESSION_ID=$1
TEAM_PATH=$2
SSH_COMMAND=$3

if [ -n "$SSH_COMMAND" ]; then
  # Remote fork
  osascript <<EOF
    tell application "iTerm"
      create window with default profile
      tell current session of current window
        write text "$SSH_COMMAND 'cd $TEAM_PATH && claude --resume $SESSION_ID'"
      end tell
    end tell
EOF
else
  # Local fork
  osascript <<EOF
    tell application "iTerm"
      create window with default profile
      tell current session of current window
        write text "cd $TEAM_PATH && claude --resume $SESSION_ID"
      end tell
    end tell
EOF
fi
```

Make executable: `chmod +x ~/.iris/terminal.sh`

## Security

- Uses existing SSH config (`~/.ssh/config`)
- SSH agent forwarding supported
- No credentials stored in Iris config
```

**Estimated Time:** 1 hour

---

### Phase 4 Deliverables

- ✅ Remote team detection in config manager
- ✅ Terminal script updated to support SSH commands
- ✅ Backend fork endpoint passes SSH command
- ✅ Dashboard shows remote indicator (🌐)
- ✅ Sessions API includes isRemote/remoteHost
- ✅ Documentation for remote fork setup

**Total Phase 4 Time:** ~9 hours (~1 week with testing buffer)

---

## Phase 5: Testing & Documentation (Week 6)

**Goal:** Comprehensive testing, performance benchmarks, security audit, and user documentation.

### Task 5.1: End-to-End Integration Tests

**File:** `tests/integration/remote-execution.test.ts` (NEW)

```typescript
describe('Remote Execution E2E', () => {
  describe('SSH to localhost', () => {
    it('should spawn remote team via SSH', async () => {
      // Setup config with SSH localhost
      const config = {
        remote: 'ssh localhost',
        path: '/tmp/test-project',
        description: 'E2E test',
      };

      // Add team dynamically
      await configManager.addTeam('test-remote', config);

      // Wake team
      const result = await handleTeamWake({ team: 'test-remote', fromTeam: 'test' });
      expect(result.success).toBe(true);

      // Check awake status
      const status = await handleTeamIsAwake({ team: 'test-remote', fromTeam: 'test' });
      expect(status.awake).toBe(true);
      expect(status.connectionState).toBe('online');
    });

    it('should execute tell via SSH', async () => {
      // ... spawn first ...

      const result = await handleTeamTell({
        fromTeam: 'test',
        toTeam: 'test-remote',
        message: 'What is 2+2?',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('4');
    });
  });

  describe('connection failures', () => {
    it('should handle transient failures with reconnect', async () => {
      // ... spawn remote team ...

      // Kill SSH process to simulate network failure
      const process = poolManager.getProcess('test-remote', 'test');
      process.terminate();

      // Wait for reconnect
      await sleep(5000);

      // Check connection state
      const status = await handleTeamIsAwake({ team: 'test-remote', fromTeam: 'test' });
      expect(status.connectionState).toBe('online');
      expect(status.reconnectAttempts).toBe(0);
    });

    it('should handle permanent failures with error state', async () => {
      const config = {
        remote: 'ssh invalid-user@localhost',
        path: '/tmp/test',
        description: 'Auth failure test',
      };

      await configManager.addTeam('test-auth-fail', config);

      // Attempt to wake (should fail)
      await expect(
        handleTeamWake({ team: 'test-auth-fail', fromTeam: 'test' })
      ).rejects.toThrow();

      // Check error state
      const status = await handleTeamIsAwake({ team: 'test-auth-fail', fromTeam: 'test' });
      expect(status.connectionState).toBe('error');
      expect(status.errorMessage).toContain('Permission denied');
    });
  });

  describe('dashboard fork', () => {
    it('should fork local session', async () => {
      // ... spawn local team ...

      const response = await fetch('http://localhost:3100/api/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, toTeam: 'local-team' }),
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.isRemote).toBe(false);
    });

    it('should fork remote session via SSH', async () => {
      // ... spawn remote team ...

      const response = await fetch('http://localhost:3100/api/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, toTeam: 'test-remote' }),
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.isRemote).toBe(true);
      expect(result.message).toContain('SSH');
    });
  });
});
```

**Estimated Time:** 6 hours

---

### Task 5.2: Performance Benchmarks

**File:** `tests/benchmarks/remote-performance.test.ts` (NEW)

```typescript
describe('Remote Execution Performance', () => {
  it('should benchmark local vs remote spawn times', async () => {
    // Local spawn
    const localStart = Date.now();
    await handleTeamWake({ team: 'local-team', fromTeam: 'test' });
    const localSpawnTime = Date.now() - localStart;

    // Remote spawn (localhost SSH)
    const remoteStart = Date.now();
    await handleTeamWake({ team: 'remote-team', fromTeam: 'test' });
    const remoteSpawnTime = Date.now() - remoteStart;

    console.log(`Local spawn: ${localSpawnTime}ms`);
    console.log(`Remote spawn: ${remoteSpawnTime}ms`);
    console.log(`Overhead: ${remoteSpawnTime - localSpawnTime}ms (${Math.round((remoteSpawnTime / localSpawnTime - 1) * 100)}%)`);

    // Expect <20% overhead for localhost
    expect(remoteSpawnTime).toBeLessThan(localSpawnTime * 1.2);
  });

  it('should benchmark local vs remote tell latency', async () => {
    // Warm up both teams
    // ... spawn and execute one tell first ...

    const message = 'What is 2+2?';

    // Local tell
    const localStart = Date.now();
    await handleTeamTell({ fromTeam: 'test', toTeam: 'local-team', message });
    const localTellTime = Date.now() - localStart;

    // Remote tell
    const remoteStart = Date.now();
    await handleTeamTell({ fromTeam: 'test', toTeam: 'remote-team', message });
    const remoteTellTime = Date.now() - remoteStart;

    console.log(`Local tell: ${localTellTime}ms`);
    console.log(`Remote tell: ${remoteTellTime}ms`);
    console.log(`Overhead: ${remoteTellTime - localTellTime}ms (${Math.round((remoteTellTime / localTellTime - 1) * 100)}%)`);

    // Expect <10% overhead for localhost
    expect(remoteTellTime).toBeLessThan(localTellTime * 1.1);
  });
});
```

**Estimated Time:** 3 hours

---

### Task 5.3: Security Audit

**File:** `docs/future/REMOTE_SECURITY_AUDIT.md` (NEW)

**Checklist:**

- [ ] SSH command injection prevented (validate config)
- [ ] No credentials in config files
- [ ] SSH agent forwarding documented
- [ ] Host key verification enforced by default
- [ ] Remote path traversal prevented
- [ ] Session files isolated on remote host
- [ ] Error messages don't leak sensitive info
- [ ] Logs sanitized (no full SSH commands with credentials)

**Estimated Time:** 4 hours

---

### Task 5.4: User Documentation

**File:** `docs/USER_GUIDE_REMOTE.md` (NEW)

```markdown
# Remote Team Execution - User Guide

## Quick Start

### 1. Configure SSH Access

Ensure you can SSH to the remote host:

```bash
ssh dev@remote-host.example.com
```

### 2. Add Remote Team to Config

Edit `~/.iris/config.yaml`:

```json
{
  "teams": {
    "team-backend": {
      "remote": "ssh dev@remote-host.example.com",
      "path": "/home/dev/projects/backend",
      "description": "Backend team on cloud server",
      "remoteOptions": {
        "identity": "~/.ssh/cloud_key",
        "serverAliveInterval": 30000
      }
    }
  }
}
```

### 3. Wake Remote Team

```typescript
// Via MCP tool
await team_wake({ team: 'team-backend', fromTeam: 'team-iris' });

// Via dashboard
// Click "Wake" button in dashboard
```

### 4. Send Messages

```typescript
await team_tell({
  fromTeam: 'team-iris',
  toTeam: 'team-backend',
  message: 'What is the API rate limit?'
});
```

## Configuration Options

### Basic Remote Config

```json
{
  "remote": "ssh user@host.com",
  "path": "/path/on/remote/host"
}
```

### Advanced Remote Config

```json
{
  "remote": "ssh user@host.com",
  "path": "/path/on/remote/host",
  "remoteOptions": {
    "identity": "~/.ssh/private_key",
    "port": 2222,
    "strictHostKeyChecking": true,
    "connectTimeout": 10000,
    "serverAliveInterval": 30000,
    "serverAliveCountMax": 3
  }
}
```

## Connection States

### Online
- SSH connection active
- Ready to receive messages
- Green indicator in dashboard

### Offline
- Temporary network issue
- Auto-reconnect in progress
- Yellow indicator in dashboard

### Error
- Permanent failure (auth, host key, etc.)
- Requires user intervention
- Red indicator in dashboard

## Troubleshooting

### "Permission denied (publickey)"

**Solution:** Add SSH key to agent

```bash
ssh-add ~/.ssh/your_key
```

### "Host key verification failed"

**Solution:** Add host to known_hosts

```bash
ssh-keyscan remote-host.com >> ~/.ssh/known_hosts
```

### "command not found: claude"

**Solution:** Install Claude CLI on remote host

```bash
ssh remote-host
curl -fsSL https://claude.com/install.sh | sh
```

## Best Practices

1. **Use SSH Config** - Put complex SSH configs in `~/.ssh/config`
2. **SSH Agent** - Use `ssh-add` instead of embedding keys
3. **Keepalive** - Default 30s keepalive works for most networks
4. **Firewall** - Ensure SSH port (22) is accessible
5. **Permissions** - Remote user doesn't need sudo

## Examples

### GitHub Codespace

```json
{
  "remote": "ssh -o StrictHostKeyChecking=no codespace-abc@123.github.dev",
  "path": "/workspaces/backend"
}
```

### AWS Cloud9

```json
{
  "remote": "ssh ec2-user@ec2-54-123-45-67.compute-1.amazonaws.com",
  "path": "/home/ec2-user/environment/backend",
  "remoteOptions": {
    "identity": "~/.ssh/aws-cloud9.pem"
  }
}
```

### GPU Cluster

```json
{
  "remote": "ssh ml@gpu-cluster.company.com",
  "path": "/mnt/shared/ml-models",
  "remoteOptions": {
    "identity": "~/.ssh/gpu_cluster_rsa",
    "serverAliveInterval": 60000
  }
}
```
```

**Estimated Time:** 4 hours

---

### Task 5.5: Update Main README

**File:** `README.md` (MODIFY)

**Add section:**

```markdown
## Remote Team Execution

Iris supports remote team execution via SSH, enabling distributed AI orchestration across:

- **Cloud Workspaces** - GitHub Codespaces, AWS Cloud9, Gitpod
- **GPU Clusters** - Specialized hardware for ML workloads
- **Multi-Region** - Teams across different data centers
- **Docker/Kubernetes** - Containerized development environments

### Quick Example

```json
{
  "teams": {
    "team-backend": {
      "remote": "ssh dev@cloud.example.com",
      "path": "/home/dev/backend",
      "description": "Backend team on cloud server"
    }
  }
}
```

See [Remote Execution Documentation](docs/future/REMOTE.md) for full details.
```

**Estimated Time:** 1 hour

---

### Phase 5 Deliverables

- ✅ E2E integration tests with SSH
- ✅ Performance benchmarks (local vs remote)
- ✅ Security audit completed
- ✅ User documentation (guide, examples, troubleshooting)
- ✅ README updated

**Total Phase 5 Time:** ~18 hours (~1 week with polish)

---

## Dependencies & Blockers

### Dependencies

1. **Phase 1 → Phase 2**
   - Transport abstraction must be complete before implementing SSH2Transport

2. **Phase 2 → Phase 3**
   - SSH2Transport must work before adding reconnect logic

3. **Phase 3 → Phase 4**
   - Session state tracking required for remote fork UI

### External Dependencies

1. **SSH Access** - Users must have SSH access to remote hosts
2. **Claude CLI** - Must be installed on remote hosts
3. **Terminal Script** - Users must configure terminal fork script

### Potential Blockers

1. **SSH Compatibility** - Different SSH implementations (OpenSSH, Windows)
2. **Network Latency** - WAN connections may be slow (acceptable per design)
3. **Authentication** - SSH keys, agents, passphrases (user responsibility)

---

## Success Criteria

### Functional Requirements

- [ ] Remote teams spawn successfully via SSH
- [ ] Remote teams execute tells via SSH tunnel
- [ ] Session files stored on remote host
- [ ] Auto-reconnect works for transient failures
- [ ] Permanent failures show error state
- [ ] Dashboard fork works for remote teams
- [ ] All existing local functionality unchanged

### Performance Requirements

- [ ] Remote spawn <120% of local spawn time (localhost)
- [ ] Remote tell <110% of local tell time (localhost)
- [ ] WAN overhead <25% (50ms RTT acceptable)

### Security Requirements

- [ ] No credentials in config files
- [ ] Host key verification enforced
- [ ] SSH command injection prevented
- [ ] Logs sanitized (no credentials)

### User Experience Requirements

- [ ] Clear visual indicators for remote teams (🌐)
- [ ] Connection state visible in dashboard
- [ ] Reconnect progress shown to user
- [ ] Error messages include remediation hints
- [ ] Documentation covers common issues

---

## Implementation Timeline

| Week | Phase | Deliverables | Hours |
|------|-------|--------------|-------|
| 1 | Phase 1: Transport Abstraction | Interface, LocalTransport, Factory, Config schema | 13 |
| 2-3 | Phase 2: SSH2Transport | SSH transport, stdio tunneling, integration tests | 13.5 |
| 4 | Phase 3: Reconnect & Session State | Auto-reconnect, state machine, dashboard updates | 12 |
| 5 | Phase 4: Dashboard Fork | Remote fork support, UI updates, docs | 9 |
| 6 | Phase 5: Testing & Documentation | E2E tests, benchmarks, security audit, user guide | 18 |

**Total Estimated Time:** ~65.5 hours (~6 weeks with buffers)

---

## Risk Mitigation

### Risk 1: SSH Compatibility Issues

**Mitigation:**
- Test on macOS, Linux, Windows (WSL)
- Document platform-specific issues
- Provide fallback terminal scripts

### Risk 2: Network Failures

**Mitigation:**
- Exponential backoff prevents connection spam
- Session state provides visibility
- User can manually intervene

### Risk 3: Authentication Complexity

**Mitigation:**
- Delegate to SSH config (`~/.ssh/config`)
- Recommend SSH agent usage
- Provide troubleshooting guide

---

## Post-Implementation

### Future Enhancements

1. **Docker Transport** - `docker exec -i container`
2. **Kubernetes Transport** - `kubectl exec -i pod`
3. **WebSocket Transport** - Cloud-native alternative to SSH
4. **Federated Iris** - Multiple Iris instances communicating

### Monitoring & Metrics

1. **Connection Health** - Track online/offline/error rates
2. **Latency Metrics** - Measure SSH overhead
3. **Reconnect Statistics** - Success/failure rates

---

**End of Implementation Plan**
