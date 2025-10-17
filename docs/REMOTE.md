# Remote Team Execution Documentation

**Status:** ✅ IMPLEMENTED (Live Feature)
**Version:** 0.0.1+
**Purpose:** Enable distributed AI orchestration across remote hosts via SSH

---

## Table of Contents

1. [Overview](#overview)
2. [Vision](#vision)
3. [Architecture Design](#architecture-design)
4. [Configuration Schema](#configuration-schema)
5. [Technical Challenges](#technical-challenges)
6. [Implementation Approach](#implementation-approach)
7. [Use Cases](#use-cases)
8. [Security Considerations](#security-considerations)
9. [Performance Analysis](#performance-analysis)
10. [Integration with Existing Architecture](#integration-with-existing-architecture)

---

## Overview

**Feature:** Remote team execution allows Claude Code processes to run on distributed hosts via SSH.

**Implementation:** Team configurations can specify **remote execution commands** to run Claude Code on any SSH-accessible host.

**Example Configuration:**
```yaml
teams:
  team-gpu:
    remote: ssh gpu.prod.company.com
    path: /home/ai/projects/ml-pipeline
    description: ML team running on GPU cluster

  team-cloud:
    remote: ssh -i ~/.ssh/codespace_key dev@codespace-abc.github.dev
    path: /workspaces/backend
    description: Backend team in GitHub Codespace
```

**Key Innovation:** Transparent remote execution - Iris treats remote teams identically to local teams, with all complexity hidden in the transport layer.

## Implementation Status

**✅ Implemented Features:**
- SSH transport via OpenSSH client (default)
- SSH config integration (`~/.ssh/config` support)
- Remote process spawning and stdio streaming
- Session lifecycle tied to SSH connections
- Keepalive and connection management
- Error handling and graceful failures
- ProxyJump/bastion support via SSH config
- `claudePath` configuration for custom Claude CLI paths
- **Reverse MCP** - Remote Claude instances can call back to local Iris via SSH tunnel

**🔮 Future Enhancements:**
- ssh2 library transport (pure JavaScript, opt-in)
- Auto-reconnect logic for transient network failures
- Connection state tracking (online/offline/error)
- Docker transport (`docker exec`)
- Kubernetes transport (`kubectl exec`)
- WebSocket/HTTP transport

---

## Use Cases

### Supported Environments

Remote execution enables coordination across distributed environments:

- **Cloud Workspaces**: GitHub Codespaces, AWS Cloud9, Gitpod
- **Specialized Hardware**: GPU clusters, high-memory machines, ARM servers
- **Security Requirements**: Sensitive codebases on isolated hosts
- **Geographic Distribution**: Teams in different data centers/regions
- **Development Containers**: Docker/Kubernetes environments (future)
- **Hybrid Work**: Some developers local, some remote

### What Remote Execution Provides

Iris can now:

1. ✅ **Spawn Claude Code processes on remote hosts via SSH**
2. ✅ **Maintain stdio streaming across SSH connections**
3. ✅ **Handle connection failures gracefully**
4. 🔮 **Track connection state (online/offline/error)** - Planned
5. ✅ **Provide transparent experience - remote looks like local**

---

## Architecture Design

### High-Level Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Iris MCP Server (Local)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Iris Orchestrator                        │  │
│  │  sendMessage(fromTeam, toTeam, message)              │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│                       ▼                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           ClaudeProcessPool                           │  │
│  │  getOrCreateProcess(team, sessionId, fromTeam)       │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│                       ▼                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         TransportFactory (NEW)                        │  │
│  │  createTransport(irisConfig) → Transport             │  │
│  │    - if (config.remote): SSH2Transport          │  │
│  │    - else: LocalTransport                            │  │
│  └────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
┌──────────────────┐          ┌──────────────────┐
│ LocalTransport   │          │ SSH2Transport│
│                  │          │                  │
│ spawn():         │          │ spawn():         │
│   child_process  │          │   ssh connection │
│   .spawn(...)    │          │   stdio tunneling│
│                  │          │   keepalive      │
│ stdin/stdout:    │          │                  │
│   Direct pipes   │          │ stdin/stdout:    │
│                  │          │   SSH tunnel     │
└──────────────────┘          └──────────────────┘
         │                             │
         │                             │ SSH connection
         ▼                             ▼
┌──────────────────┐          ┌──────────────────┐
│ Local Claude CLI │          │ Remote Host      │
│ (same machine)   │          │ (SSH accessible) │
│                  │          │                  │
│ /usr/local/bin/  │          │ ssh user@host    │
│ claude           │          │ cd /path         │
│                  │          │ claude ...       │
└──────────────────┘          └──────────────────┘
```

### Transport Abstraction Layer

**Interface:**

```typescript
interface Transport {
  // Spawn Claude process with cache entry for init
  spawn(spawnCacheEntry: CacheEntry): Promise<void>;

  // Execute tell by writing to stdin
  executeTell(cacheEntry: CacheEntry): void;

  // Terminate process
  terminate(): Promise<void>;

  // Check if transport is ready
  isReady(): boolean;

  // Check if currently processing
  isBusy(): boolean;

  // Get basic metrics
  getMetrics(): TransportMetrics;
}
```

**Implementations:**

1. ✅ **LocalTransport** - Local process execution (existing)
2. ✅ **SSHTransport** - OpenSSH client (IMPLEMENTED - default for remote execution)
3. 🔮 **RemoteSSH2Transport** - ssh2 library (PLANNED - opt-in via `ssh2: true`)
4. 🔮 **Future**: DockerTransport, KubernetesTransport, WSLTransport

### Dual SSH Implementation Strategy

Iris supports **two SSH implementations** for remote execution, each with distinct trade-offs:

#### Option 1: OpenSSH Client Transport (✅ IMPLEMENTED - Default)

**Uses:** Local `ssh` command-line client (OpenSSH)

**Status:** Fully implemented and production-ready

**Advantages:**
- ✅ Leverages existing `~/.ssh/config` automatically
- ✅ SSH agent integration works out-of-the-box
- ✅ ProxyJump/bastions work seamlessly
- ✅ All SSH features supported (ControlMaster, compression, etc.)
- ✅ Simpler implementation (~300 LOC)
- ✅ Battle-tested SSH client behavior
- ✅ No additional dependencies

**Disadvantages:**
- ❌ Requires OpenSSH installed on system
- ❌ Less control over connection lifecycle
- ❌ Harder to detect specific error types
- ❌ Platform-dependent behavior (OpenSSH vs other SSH clients)

**When to use:**
- Default choice for most use cases
- When leveraging complex SSH config (ProxyJump, ControlMaster, etc.)
- When SSH agent authentication is required
- When portability across SSH clients is needed

#### Option 2: ssh2 Library Transport (🔮 PLANNED - Opt-in)

**Uses:** Node.js `ssh2` library with `ssh-config` parser

**Status:** Planned for future release

**Advantages:**
- ✅ Pure JavaScript, no external dependencies
- ✅ Full control over connection lifecycle
- ✅ Granular error detection and handling
- ✅ Programmatic SSH config parsing
- ✅ Better for reconnect logic
- ✅ Works without SSH client installed
- ✅ Consistent cross-platform behavior

**Disadvantages:**
- ❌ Must manually parse `~/.ssh/config`
- ❌ Limited SSH feature support (no ControlMaster, etc.)
- ❌ Encrypted keys require passphrase in config
- ❌ More complex implementation (~800 LOC)
- ❌ Additional npm dependencies

**When to use:**
- Environments without OpenSSH (Windows, containers)
- When fine-grained connection control is needed
- When programmatic error handling is critical
- When consistent cross-platform behavior is required

#### Configuration

**OpenSSH Client (Default):**
```yaml
team-backend:
  remote: ssh inanna
  path: /opt/containers
  description: Backend team on remote host
```

**ssh2 Library (Opt-in):**
```yaml
team-backend:
  remote: ssh inanna
  ssh2: true
  path: /opt/containers
  description: Backend team on remote host
  remoteOptions:
    passphrase: ${SSH_KEY_PASSPHRASE}
```

#### SSH Config Integration

Both implementations leverage `~/.ssh/config`, but differently:

**OpenSSH Client:**
- Automatically reads and applies SSH config
- No additional parsing needed
- Iris passes host alias to `ssh` command

**ssh2 Library:**
- Manually parses `~/.ssh/config` using `ssh-config` package
- Computes host configuration with `.compute(hostAlias)`
- Resolves HostName, User, Port, IdentityFile, etc.
- Applies configuration programmatically to ssh2 connection

**Example SSH Config:**
```bash
Host inanna
  HostName inanna.cmd.rso
  User jenova
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

**OpenSSH execution:**
```bash
ssh inanna "cd /opt/containers && claude --print ..."
# OpenSSH reads config automatically
```

**ssh2 execution:**
```typescript
// Parse config file
const config = SSHConfig.parse(readFileSync('~/.ssh/config', 'utf8'));

// Compute host config
const hostConfig = config.compute('inanna');
// Returns: { HostName: 'inanna.cmd.rso', User: 'jenova', ... }

// Apply to ssh2 connection
client.connect({
  host: hostConfig.HostName,
  username: hostConfig.User,
  privateKey: readFileSync(expandTilde(hostConfig.IdentityFile[0])),
  keepaliveInterval: 30000,
});
```

#### Implementation Selection

**TransportFactory logic:**
```typescript
class TransportFactory {
  static create(teamName: string, irisConfig: IrisConfig, sessionId: string): Transport {
    if (!irisConfig.remote) {
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

## Configuration Schema

### Team Configuration with Remote

```typescript
interface IrisConfig {
  path: string;                   // Path on target host (local or remote)
  description: string;

  // NEW: Remote execution command
  remote?: string;                // e.g., "ssh user@host.com" or "ssh inanna"

  // NEW: SSH implementation selection
  ssh2?: boolean;                 // Use ssh2 library instead of OpenSSH client (default: false)

  // Optional SSH-specific configuration
  remoteOptions?: {
    identity?: string;            // Path to SSH private key
    passphrase?: string;          // Passphrase for encrypted key (ssh2 only)
    port?: number;                // SSH port (default: 22)
    strictHostKeyChecking?: boolean; // Default: true
    connectTimeout?: number;      // Connection timeout (ms)
    serverAliveInterval?: number; // Keepalive interval (default: 30s)
    serverAliveCountMax?: number; // Max keepalive failures (default: 3)
    compression?: boolean;        // Enable SSH compression
    forwardAgent?: boolean;       // Forward SSH agent (OpenSSH only)
  };

  // Existing optional fields
  idleTimeout?: number;
  sessionInitTimeout?: number;
  skipPermissions?: boolean;
  color?: string;
}
```

### Example Configurations

**1. GitHub Codespace**

```yaml
team-backend:
  remote: ssh -o StrictHostKeyChecking=no codespace-abc@123.github.dev
  path: /workspaces/backend
  description: Backend team running in GitHub Codespace
  remoteOptions:
    connectTimeout: 10000
    serverAliveInterval: 30000
```

**2. AWS Cloud9**

```yaml
team-data:
  remote: ssh ec2-user@ec2-54-123-45-67.compute-1.amazonaws.com
  path: /home/ec2-user/environment/data-pipeline
  description: Data team on AWS Cloud9
  remoteOptions:
    identity: ~/.ssh/aws-cloud9.pem
    port: 22
```

**3. GPU Cluster**

```yaml
team-ml:
  remote: ssh ml@gpu-cluster.company.com
  path: /mnt/shared/ml-models
  description: ML team with GPU access
  remoteOptions:
    identity: ~/.ssh/gpu_cluster_rsa
    serverAliveInterval: 60000
```

**4. Docker Container**

```yaml
team-test:
  remote: docker exec -i test-container
  path: /app
  description: Testing team in Docker container
```

**5. Kubernetes Pod**

```yaml
team-frontend:
  remote: kubectl exec -i frontend-pod-abc123 --
  path: /usr/src/app
  description: Frontend team in Kubernetes
```

---

## Technical Challenges

### 1. SSH Connection Management

**Challenge:** SSH connections can drop, timeout, or become stale.

**Solution: SSH Lifecycle = Session Lifecycle**

The key architectural insight is that **each SSH connection is tied to a session** (fromTeam→toTeam pair). There is no separate connection pooling layer - the SSH process IS the session process.

**Implementation:**

```typescript
// One SSH connection per session, managed by existing ProcessPool
const poolKey = `${fromTeam}->${toTeam}`;  // e.g., "iris->alpha"
const process = await processPool.getOrCreateProcess(teamName, sessionId, fromTeam);

// The SSH connection lives as long as the session lives
// When session is evicted (LRU), SSH connection terminates
// When session goes idle, SSH connection idles (with keepalive)
```

**Connection Lifecycle:**

```
Session Created → SSH spawned with keepalive (ServerAliveInterval=30s)
Session Active  → SSH connection maintained
Session Idle    → SSH connection kept alive (existing idle timeout applies)
Session Evicted → SSH connection terminated (SIGTERM)
Network Failure → Session goes OFFLINE, auto-reconnect attempts
```

**Benefits:**

- ✅ No separate pooling layer needed (~300 LOC saved)
- ✅ Existing process pool handles SSH connection limits
- ✅ Existing idle timeout evicts stale SSH connections
- ✅ Existing LRU eviction manages SSH connection count
- ✅ Session state tracks connection health (online/offline/error)

**Keepalive Configuration:**

```typescript
// SSH2Transport automatically includes keepalive
const sshCmd = [
  this.config.remote,
  '-o', 'ServerAliveInterval=30',      // Send keepalive every 30s
  '-o', 'ServerAliveCountMax=3',       // 3 failed keepalives = disconnect
  '-T',                                 // No PTY allocation
  `"cd ${remotePath} && ${claudeCmd}"`
].join(' ');
```

### 2. Stdio Streaming Over SSH

**Challenge:** Need to maintain bidirectional stdio stream through SSH tunnel.

**Solution:**

- Use SSH `-tt` flag for pseudo-terminal allocation
- Use `ssh -T` to disable PTY for cleaner stdio
- Test both approaches for compatibility

**Command Structure:**

```bash
# Option 1: No PTY (cleaner stdio)
ssh -T user@host "cd /path && claude --input-format stream-json --output-format stream-json"

# Option 2: Force PTY (better for interactive)
ssh -tt user@host "cd /path && claude --input-format stream-json --output-format stream-json"
```

**Stdio Handling:**

```typescript
class SSH2Transport implements Transport {
  private sshProcess: ChildProcess;

  async spawn(spawnCacheEntry: CacheEntry): Promise<void> {
    const sshCmd = this.config.remote!;
    const remotePath = this.config.path;

    // Build remote command
    const remoteCommand = `cd ${remotePath} && claude --input-format stream-json --output-format stream-json`;

    // Spawn SSH with stdio piping
    this.sshProcess = spawn('sh', ['-c', `${sshCmd} "${remoteCommand}"`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe stdout/stderr to cache (same as LocalTransport)
    this.sshProcess.stdout.on('data', (data) => {
      this.handleStdoutData(data, spawnCacheEntry);
    });

    this.sshProcess.stderr.on('data', (data) => {
      this.logger.debug('Remote stderr', { data: data.toString() });
    });

    // Wait for init message
    await this.waitForInit(spawnCacheEntry, timeout);
  }
}
```

### 3. Session File Location

**Challenge:** Claude session files (`.jsonl`) - where do they live?

**Options:**

**Option A: Remote Session Files (Recommended)**

- Session files stored on remote host: `~/.claude/projects/{path}/{sessionId}.jsonl`
- Iris never touches session files directly
- Session initialization happens on remote host

**Pros:**
- True remote isolation
- No file synchronization needed
- Works with existing Claude Code session management

**Cons:**
- Cannot inspect session files locally
- Debugging requires SSH access

**Option B: Local Session Files with Sync**

- Session files stored locally
- Sync to remote host via `rsync` or `scp`

**Pros:**
- Local access for debugging

**Cons:**
- Complex synchronization logic
- Race conditions
- Network overhead

**Recommendation:** Use **Option A** - remote session files. Simpler, more robust.

### 4. Authentication

**Challenge:** SSH key management, passwords, 2FA.

**Solutions:**

1. **SSH Agent Forwarding**
   ```yaml
   remote: ssh -A user@host
   ```

2. **Explicit Identity File**
   ```yaml
   remoteOptions:
     identity: ~/.ssh/company_rsa
   ```

3. **SSH Config File**
   ```bash
   # ~/.ssh/config
   Host gpu-cluster
     HostName gpu.company.com
     User ml-user
     IdentityFile ~/.ssh/gpu_key
     ServerAliveInterval 60
   ```

   Then in Iris config:
   ```yaml
   remote: ssh gpu-cluster
   ```

**Recommendation:** Leverage existing SSH config for complex setups. Iris just executes the `remote` command string.

### 5. Network Latency

**Challenge:** SSH adds latency (~10-100ms per round trip).

**Mitigation:**

- **Connection Reuse**: Keep SSH connections alive between operations
- **Batching**: Send multiple messages in one SSH session
- **Compression**: Enable SSH compression for large payloads (`ssh -C`)
- **Asynchronous Operations**: Use async mode for fire-and-forget

**Performance Comparison:**

| Scenario | Local | Remote (LAN) | Remote (WAN) |
|----------|-------|--------------|--------------|
| Cold start | 3s | 3.5s | 5s |
| Warm tell | 2s | 2.1s | 2.3s |
| 10 sequential tells | 20s | 21s | 25s |

**Impact:** 5-25% slower depending on network conditions. Acceptable trade-off for distributed orchestration.

### 6. Error Handling & Session State

**Error Classification:**

SSH errors fall into two categories that determine recovery strategy:

**1. Transient Failures (Auto-Reconnect)**

Network issues that typically resolve themselves:

- `ETIMEDOUT` - Connection timeout
- `ECONNREFUSED` - Connection refused (temporarily)
- `Connection closed` - Mid-session disconnect
- `Network is unreachable` - Routing issues

**Action:** Session transitions to `OFFLINE` state, attempts auto-reconnect with exponential backoff.

**2. Permanent Failures (User Intervention Required)**

Configuration or authentication errors that won't resolve automatically:

- `Permission denied (publickey)` - SSH auth failed
- `Authentication failed` - Invalid credentials
- `Host key verification failed` - Known_hosts mismatch
- `REMOTE HOST IDENTIFICATION HAS CHANGED` - Security warning
- `command not found` - Claude not installed remotely
- `No such file or directory` - Invalid path

**Action:** Session transitions to `ERROR` state, auto-reconnect stops, user must fix configuration.

**Session State Machine:**

```
                  ┌──────────┐
                  │  ONLINE  │ ← Default state, SSH connected
                  └────┬─────┘
                       │
     Network failure   │
           ┌───────────┘
           │
           ▼
     ┌──────────┐
     │ OFFLINE  │ ← Transient failure, attempting reconnect
     └────┬─────┘
          │
          ├─── Reconnect success ───> ONLINE
          │
          └─── Max retries OR permanent failure ───> ERROR
                                                      │
                                                      │
                                               ┌──────────┐
                                               │  ERROR   │ ← User must intervene
                                               └──────────┘
```

**User Experience:**

```typescript
// Transient failure - automatic recovery
User: "Tell team-remote to run tests"
Response: "Team remote is currently OFFLINE (network issue, reconnecting... attempt 2/5)"
[5 seconds later]
Response: "Team remote is back ONLINE. Executing your message..."

// Permanent failure - requires action
User: "Tell team-remote to run tests"
Response: "Team remote is in ERROR state: SSH authentication failed (Permission denied)"
Suggestion: "Check SSH key at ~/.ssh/company_rsa or run: ssh-add ~/.ssh/company_rsa"
```

**MCP Tool Integration:**

```typescript
// team_isAwake returns connection state
{
  "team": "team-remote",
  "awake": true,
  "connectionState": "offline",     // NEW: online | offline | error
  "reconnectAttempts": 2,            // NEW: current attempt number
  "maxReconnectAttempts": 5,         // NEW: configured maximum
  "lastOfflineAt": 1697567890123,    // NEW: timestamp
  "message": "Network issue, attempting reconnect (attempt 2/5)"
}

// Error state example
{
  "team": "team-remote",
  "awake": true,
  "connectionState": "error",
  "errorMessage": "SSH authentication failed: Permission denied (publickey)",
  "remediation": "Check SSH key: ssh-add ~/.ssh/company_rsa",
  "lastOfflineAt": 1697567890123
}
```

---

## Implementation Approach

### Phase 1: Transport Abstraction

**Goal:** Refactor ClaudeProcess to use Transport interface.

**Steps:**

1. Extract interface from ClaudeProcess:
   ```typescript
   interface Transport {
     spawn(cacheEntry: CacheEntry): Promise<void>;
     executeTell(cacheEntry: CacheEntry): void;
     terminate(): Promise<void>;
     isReady(): boolean;
     isBusy(): boolean;
   }
   ```

2. Implement LocalTransport (existing logic):
   ```typescript
   class LocalTransport implements Transport {
     // Move all existing ClaudeProcess logic here
   }
   ```

3. Update ClaudeProcess to delegate to Transport:
   ```typescript
   class ClaudeProcess {
     private transport: Transport;

     constructor(teamName: string, irisConfig: IrisConfig, sessionId: string) {
       this.transport = TransportFactory.create(irisConfig);
     }

     async spawn(cacheEntry: CacheEntry): Promise<void> {
       return this.transport.spawn(cacheEntry);
     }
   }
   ```

### Phase 2: SSH2Transport Implementation

**Goal:** Implement SSH tunneling transport.

**Files:**

```
src/transport/
├── transport.interface.ts       # Transport interface
├── local-transport.ts           # LocalTransport (existing logic)
├── remote-ssh-transport.ts      # SSH2Transport (new)
└── transport-factory.ts         # Factory to select transport
```

**SSH2Transport Implementation:**

```typescript
class SSH2Transport implements Transport {
  private sshProcess: ChildProcess | null = null;
  private currentCacheEntry: CacheEntry | null = null;
  private isReady = false;

  constructor(
    private teamName: string,
    private irisConfig: IrisConfig,
    private sessionId: string | null
  ) {}

  async spawn(spawnCacheEntry: CacheEntry): Promise<void> {
    const sshCmd = this.irisConfig.remote!;
    const remotePath = this.irisConfig.path;

    // Build Claude command for remote execution
    const claudeCmd = [
      'claude',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      this.sessionId ? `--resume ${this.sessionId}` : '',
    ].filter(Boolean).join(' ');

    // Full remote command
    const remoteCommand = `cd ${remotePath} && ${claudeCmd}`;

    // Spawn SSH process
    this.sshProcess = spawn('sh', ['-c', `${sshCmd} "${remoteCommand}"`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.currentCacheEntry = spawnCacheEntry;

    // Set up stdio handlers (identical to LocalTransport)
    this.sshProcess.stdout.on('data', (data) => {
      this.handleStdoutData(data);
    });

    this.sshProcess.stderr.on('data', (data) => {
      this.logger.debug('SSH stderr', { data: data.toString() });
    });

    this.sshProcess.on('exit', (code, signal) => {
      this.handleExit(code, signal);
    });

    // Wait for Claude init message
    await this.waitForInit(spawnCacheEntry, 30000);

    this.isReady = true;
    this.currentCacheEntry = null; // Ready for tells
  }

  executeTell(cacheEntry: CacheEntry): void {
    if (!this.sshProcess || !this.isReady) {
      throw new Error('SSH transport not ready');
    }

    if (this.currentCacheEntry !== null) {
      throw new ProcessBusyError('SSH transport already processing');
    }

    this.currentCacheEntry = cacheEntry;

    // Write to SSH stdin (same as LocalTransport)
    const message = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: cacheEntry.tellString,
      },
    }) + '\n';

    this.sshProcess.stdin!.write(message);
  }

  async terminate(): Promise<void> {
    if (!this.sshProcess) return;

    return new Promise((resolve) => {
      this.sshProcess!.once('exit', () => resolve());
      this.sshProcess!.kill('SIGTERM');

      // Force kill after 5s
      setTimeout(() => {
        if (this.sshProcess) {
          this.sshProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  private handleStdoutData(data: Buffer): void {
    // Identical to LocalTransport
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (this.currentCacheEntry) {
          this.currentCacheEntry.addMessage(parsed);
        }
        if (parsed.type === 'result') {
          this.currentCacheEntry = null; // Ready for next tell
        }
      } catch (e) {
        this.logger.warn('Failed to parse SSH stdout', { line });
      }
    }
  }
}
```

### Phase 3: Reconnect Logic & Session State

**Goal:** Handle transient network failures with auto-reconnect and session state tracking.

**Session State Enhancement:**

The SSH connection lifecycle is tied to the session lifecycle. When connections drop, the session transitions to `offline` state and automatically attempts to reconnect.

**Session States:**

```typescript
type ConnectionState = 'online' | 'offline' | 'error';

// SQLite schema updates
ALTER TABLE team_sessions ADD COLUMN connection_state TEXT DEFAULT 'online';
ALTER TABLE team_sessions ADD COLUMN error_message TEXT;
ALTER TABLE team_sessions ADD COLUMN last_offline_at INTEGER;
ALTER TABLE team_sessions ADD COLUMN reconnect_attempts INTEGER DEFAULT 0;
```

**Auto-Reconnect Implementation:**

```typescript
class SSH2Transport {
  private reconnectConfig = {
    maxAttempts: 5,
    backoffMs: [1000, 2000, 4000, 8000, 16000], // Exponential backoff
  };

  private handleDisconnect(): void {
    // SSH connection dropped mid-session
    this.emit('offline'); // Iris updates session to OFFLINE
    this.sessionManager.updateConnectionState(this.sessionId, 'offline');

    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    for (let attempt = 0; attempt < this.reconnectConfig.maxAttempts; attempt++) {
      try {
        await sleep(this.reconnectConfig.backoffMs[attempt]);
        await this.reconnect();

        // Success!
        this.emit('online');
        this.sessionManager.updateConnectionState(this.sessionId, 'online');
        this.sessionManager.resetReconnectAttempts(this.sessionId);
        return;

      } catch (error) {
        this.sessionManager.incrementReconnectAttempts(this.sessionId);

        if (this.isPermanentFailure(error)) {
          // Give up - permanent failure
          this.emit('error', error);
          this.sessionManager.updateConnectionState(
            this.sessionId,
            'error',
            error.message
          );
          return;
        }

        // Continue retrying transient failures
        this.logger.warn('Reconnect attempt failed, retrying...', {
          attempt: attempt + 1,
          maxAttempts: this.reconnectConfig.maxAttempts,
          error: error.message,
        });
      }
    }

    // Exhausted all retries - mark as error
    this.emit('error', new Error('Max reconnect attempts exceeded'));
    this.sessionManager.updateConnectionState(
      this.sessionId,
      'error',
      'Failed to reconnect after maximum attempts'
    );
  }

  private isPermanentFailure(error: Error): boolean {
    // Authentication failures - permanent
    if (error.message.includes('Permission denied')) return true;
    if (error.message.includes('Authentication failed')) return true;

    // Host key issues - permanent
    if (error.message.includes('Host key verification failed')) return true;
    if (error.message.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')) return true;

    // Command not found - permanent
    if (error.message.includes('command not found')) return true;
    if (error.message.includes('No such file or directory')) return true;

    // Network issues - transient (keep retrying)
    return false;
  }
}
```

**Zod Schema Update:**

```typescript
const IrisConfigSchema = z.object({
  path: z.string().min(1),
  description: z.string(),

  // NEW: Remote execution
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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
```

### Phase 4: Testing & Validation

**Test Matrix:**

| Local | Remote (LAN) | Remote (WAN) | Docker | Kubernetes |
|-------|--------------|--------------|--------|------------|
| ✅ Baseline | ✅ Primary target | ✅ Test latency | 🔮 Future | 🔮 Future |

**Integration Tests:**

```typescript
describe('SSH2Transport', () => {
  it('should spawn Claude on remote host', async () => {
    const config = {
      remote: 'ssh test@localhost',
      path: '/tmp/test-project',
    };

    const transport = new SSH2Transport('test', config, null);
    const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

    await transport.spawn(spawnEntry);

    expect(transport.isReady()).toBe(true);
  });

  it('should handle connection failures gracefully', async () => {
    const config = {
      remote: 'ssh test@nonexistent-host.local',
      path: '/tmp/test',
    };

    const transport = new SSH2Transport('test', config, null);

    await expect(transport.spawn(spawnEntry)).rejects.toThrow('Connection refused');
  });
});
```

---

## Use Cases

### 1. Hybrid Local + Cloud Development

**Scenario:** Frontend local, backend in AWS Cloud9

```yaml
teams:
  team-frontend:
    path: /Users/dev/projects/frontend
    description: Local frontend development
  team-backend:
    remote: ssh ec2-user@cloud9.amazonaws.com
    path: /home/ec2-user/backend
    description: Backend on AWS Cloud9
```

**Workflow:**

```
User (Local Frontend Claude):
  "Using Iris, ask Team Backend what the API rate limit is"

Iris:
  - Local: Gets team-frontend process (local)
  - Remote: SSH to AWS Cloud9, spawns team-backend Claude
  - Streams question via SSH tunnel
  - Returns answer to local Claude

User receives answer without ever touching AWS console
```

### 2. GPU Cluster for ML Teams

**Scenario:** ML model training on dedicated GPU servers

```yaml
teams:
  team-ml:
    remote: ssh ml@gpu-cluster.company.com
    path: /mnt/shared/ml-models
    description: ML team with 8x A100 GPUs
```

**Workflow:**

```
User (Local):
  "Using Iris, ask Team ML to train the latest model on the new dataset"

Iris → SSH to GPU cluster → Team ML Claude:
  - Analyzes dataset
  - Configures training job
  - Submits to SLURM/Kubernetes
  - Reports back progress

User gets status updates without SSH'ing to GPU cluster
```

### 3. Multi-Region Development

**Scenario:** Teams distributed across continents

```yaml
teams:
  team-us:
    remote: ssh dev@us-east-1.company.com
    path: /app/us-region
    description: US-based team
  team-eu:
    remote: ssh dev@eu-west-1.company.com
    path: /app/eu-region
    description: EU-based team (GDPR compliance)
  team-asia:
    remote: ssh dev@ap-southeast-1.company.com
    path: /app/asia-region
    description: Asia-Pacific team
```

**Workflow:** Global coordination from single Iris instance.

### 4. Security Isolation

**Scenario:** Sensitive codebase on isolated bastion host

```yaml
team-security:
  remote: ssh -J bastion.company.com security@vault.internal
  path: /secure/audit-system
  description: Security team on air-gapped network
```

**SSH Jump Host (`-J`):** Iris → Bastion → Vault (multi-hop SSH)

### 5. Docker/Kubernetes Development

**Scenario:** Teams working in containerized environments

```yaml
team-containerized:
  remote: docker exec -i dev-container
  path: /app
  description: Team in Docker dev container
team-k8s:
  remote: kubectl exec -i frontend-pod-abc --
  path: /usr/src/app
  description: Team in Kubernetes pod
```

**Workflow:** Same Iris interface, different execution environments.

---

## Security Considerations

### 1. SSH Key Management

**Risks:**
- Private keys exposed in config
- Keys without passphrases
- Overly permissive key access

**Mitigations:**

- **Never embed keys in config**:
  ```yaml
  # ❌ BAD
  remoteOptions:
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\n..."

  # ✅ GOOD
  remoteOptions:
    identity: ~/.ssh/company_rsa
  ```

- **Use SSH Agent**:
  ```bash
  eval $(ssh-agent)
  ssh-add ~/.ssh/company_rsa
  ```

  Then:
  ```yaml
  remote: ssh -A user@host
  ```

- **Leverage SSH Config**:
  ```bash
  # ~/.ssh/config
  Host gpu-cluster
    HostName gpu.company.com
    User ml-user
    IdentityFile ~/.ssh/gpu_key
    IdentitiesOnly yes
  ```

### 2. Known Hosts Verification

**Risk:** Man-in-the-middle attacks

**Mitigation:**

- **Strict checking (default)**:
  ```yaml
  remoteOptions:
    strictHostKeyChecking: true  # Reject unknown hosts
  ```

- **Pre-populate known_hosts**:
  ```bash
  ssh-keyscan gpu.company.com >> ~/.ssh/known_hosts
  ```

- **Only disable for trusted networks**:
  ```yaml
  remote: ssh -o StrictHostKeyChecking=no user@localhost
  # Only for development/testing!
  ```

### 3. Credential Leakage

**Risk:** SSH credentials logged or exposed

**Mitigations:**

- **Sanitize logs**: Never log full SSH commands with credentials
- **Audit config files**: Restrict permissions on `config.yaml` (600)
- **Use environment variables** for sensitive data:
  ```yaml
  remote: ssh ${SSH_USER}@${SSH_HOST}
  ```

### 4. Remote Code Execution

**Risk:** Malicious remote commands

**Mitigations:**

- **Validate remote commands**: Whitelist allowed commands
- **Restrict sudo access**: Remote user should NOT have sudo
- **Sandbox Claude**: Run Claude with limited permissions on remote host

### 5. Network Security

**Risk:** Unencrypted traffic, exposed SSH ports

**Mitigations:**

- **Use VPN/Bastion**: `ssh -J bastion.company.com`
- **Port knocking**: Firewall rules to hide SSH port
- **Fail2ban**: Block brute-force attempts

---

## Performance Analysis

### Latency Breakdown

**Local Execution:**
```
Spawn:   3000ms
Tell:    2000ms
Total:   5000ms
```

**Remote Execution (LAN, <5ms RTT):**
```
SSH connect:    100ms
Spawn:          3100ms  (+100ms)
Tell:           2100ms  (+100ms)
Total:          5200ms  (+4% overhead)
```

**Remote Execution (WAN, 50ms RTT):**
```
SSH connect:    500ms
Spawn:          3500ms  (+500ms)
Tell:           2200ms  (+200ms)
Total:          6200ms  (+24% overhead)
```

### Optimization Strategies

**Key Insight:** No separate connection pooling needed - SSH lifecycle = session lifecycle.

1. **Session-Based Connection Reuse**
   - Each session maintains one persistent SSH connection
   - Existing process pool LRU handles connection limits
   - Existing idle timeout evicts stale connections
   - **Savings:** ~300 LOC complexity eliminated

2. **SSH Multiplexing** (Optional - User Configuration)
   ```bash
   # ~/.ssh/config
   Host remote-team-*
     ControlMaster auto
     ControlPath ~/.ssh/sockets/%r@%h-%p
     ControlPersist 600
   ```
   - Enables sharing underlying TCP connection across multiple sessions
   - Reduces latency for subsequent connections
   - Configured by user, not Iris

3. **SSH Compression**: `ssh -C` for large payloads
   - Useful for transferring large code snippets or diffs
   - Add to `remote` command: `"remote": "ssh -C user@host"`

4. **Async Mode**: Use `timeout=-1` for fire-and-forget operations
   - Non-critical notifications don't wait for response
   - Returns immediately after queuing

---

## Integration with Existing Architecture

### Minimal Changes Required

**Good News:** The refactored architecture already supports this!

**Why:** ClaudeProcess is already a "dumb pipe" - it just spawns a process and pipes stdio. The transport mechanism (local vs SSH) is an implementation detail.

**Changes Needed:**

1. **TransportFactory** (new file):
   ```typescript
   class TransportFactory {
     static create(irisConfig: IrisConfig): Transport {
       if (irisConfig.remote) {
         return new SSH2Transport(irisConfig);
       }
       return new LocalTransport(irisConfig);
     }
   }
   ```

2. **ClaudeProcess** (minimal change):
   ```typescript
   class ClaudeProcess {
     private transport: Transport;

     constructor(...) {
       this.transport = TransportFactory.create(irisConfig);
     }
   }
   ```

3. **Config validation** (add remote field to Zod schema)

**Everything else works as-is:**
- ✅ Iris orchestration logic unchanged
- ✅ Cache system unchanged
- ✅ Session management unchanged
- ✅ Process pool unchanged
- ✅ MCP tools unchanged

### Backward Compatibility

**100% backward compatible:**

- Existing configs without `remote` field → LocalTransport (existing behavior)
- Existing teams continue to work
- No breaking changes

**Migration path:**

```yaml
# Step 1: Start with local teams
teams:
  team-alpha:
    path: /Users/dev/alpha

# Step 2: Gradually add remote teams
teams:
  team-alpha:
    path: /Users/dev/alpha
  team-beta:
    remote: ssh dev@cloud.com
    path: /app/beta

# Step 3: Fully distributed
teams:
  team-alpha:
    remote: ssh dev@host-a.com
    path: /app/alpha
  team-beta:
    remote: ssh dev@host-b.com
    path: /app/beta
```

---

## Implementation Checklist

### Phase 1: Transport Abstraction (1 week)
- [ ] Define Transport interface
- [ ] Extract LocalTransport from ClaudeProcess
- [ ] Implement TransportFactory
- [ ] Update config schema with `remote` field
- [ ] Unit tests for transport abstraction

### Phase 2: SSH2Transport (2 weeks)
- [ ] Implement SSH2Transport class
- [ ] SSH stdio tunneling (stdin/stdout piping)
- [ ] Keepalive configuration (ServerAliveInterval)
- [ ] Session file initialization on remote host
- [ ] Integration tests with localhost SSH

### Phase 3: Reconnect Logic & Session State (1 week)
- [ ] Add connection_state column to team_sessions table
- [ ] Implement offline/error state transitions
- [ ] Auto-reconnect with exponential backoff
- [ ] Permanent vs transient failure detection
- [ ] Update team_isAwake MCP tool with connection state
- [ ] User-facing error messages with remediation hints

### Phase 4: Testing & Hardening (1 week)
- [ ] E2E tests with real SSH hosts (localhost, LAN, WAN)
- [ ] Network failure simulation tests
- [ ] Performance benchmarks (local vs remote)
- [ ] Security audit (key management, host verification)
- [ ] Load testing with 10+ remote teams
- [ ] Documentation and examples

**Total Timeline:** ~5 weeks (vs original 8 weeks)

### Future: Advanced Features
- [ ] Docker transport (`docker exec -i`)
- [ ] Kubernetes transport (`kubectl exec -i`)
- [ ] WSL transport (Windows Subsystem for Linux)
- [ ] WebSocket/HTTP transport (cloud-native)

---

## Future Enhancements

### 1. WebSocket/HTTP Transport

**Instead of SSH, use HTTP/WebSocket for remote execution:**

```yaml
team-cloud:
  remote: https://api.iris-cloud.com/teams/backend
  remoteType: http
  authentication:
    type: bearer
    token: ${IRIS_CLOUD_TOKEN}
```

**Benefits:**
- No SSH setup required
- Works through firewalls
- Easier to secure (HTTPS + API keys)

### 2. Mesh Network Topology

**Allow teams to discover and communicate peer-to-peer:**

```
Team Alpha ←→ Team Beta
    ↕            ↕
Team Gamma ←→ Team Delta
```

Instead of star topology (all through central Iris).

### 3. Remote Iris Instances

**Federated Iris servers:**

```
Iris (Local) ←→ Iris (Cloud) ←→ Iris (GPU Cluster)
```

Each Iris manages its own local teams, but can proxy to other Iris instances.

### 4. Remote Session Debugging

**SSH into remote host and inspect sessions:**

```bash
iris remote debug team-backend --ssh
# Opens SSH session to backend host
# Shows session files, logs, process status
```

---

## Conclusion

Remote team execution transforms Iris MCP from a **local orchestrator** into a **distributed AI cloud platform**. By abstracting transport mechanisms and leveraging SSH, Iris can coordinate AI agents across:

- Cloud development environments
- GPU clusters
- Containerized workloads
- Multi-region deployments
- Security-isolated networks

**Implementation Complexity:** Medium-Low
- Transport abstraction: ~500 LOC
- SSH transport: ~800 LOC
- Reconnect logic & session state: ~400 LOC
- Configuration & validation: ~200 LOC
- **Total:** ~1900 LOC

**Architectural Simplifications:**
- ❌ No connection pooling layer (~300 LOC saved)
- ✅ SSH lifecycle tied to session lifecycle
- ✅ Existing process pool manages connections
- ✅ Existing health checks detect failures
- ✅ Session state provides user visibility

**Benefits:**
- ✅ Distributed AI orchestration
- ✅ Hybrid local/cloud workflows
- ✅ Specialized hardware access (GPUs)
- ✅ Geographic distribution
- ✅ Security isolation
- ✅ 100% backward compatible

**The future of Iris is distributed.**

---

**Document Version:** 2.0 (Implemented)
**Last Updated:** January 2025
**Status:** ✅ Live Feature - Production Ready

**Changes from v1.0:**
- OpenSSH client transport fully implemented
- Remote execution via SSH is production-ready
- Reverse MCP feature added for bidirectional communication
- SSH config integration working
- Process lifecycle management implemented
- Updated implementation sections to reflect live status
