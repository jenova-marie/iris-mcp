# Remote Team Execution Documentation (Future)

**Status:** Design Phase / Future Enhancement
**Target Release:** Phase 5 or standalone Phase 6
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

**Current Limitation:** All Claude Code processes execute locally on the machine running Iris MCP.

**Proposed Enhancement:** Allow team configurations to specify **remote execution commands** (typically SSH) to run Claude Code on distributed hosts.

**Example Configuration:**
```json
{
  "teams": {
    "team-gpu": {
      "remote": "ssh gpu.prod.company.com",
      "path": "/home/ai/projects/ml-pipeline",
      "description": "ML team running on GPU cluster"
    },
    "team-cloud": {
      "remote": "ssh -i ~/.ssh/codespace_key dev@codespace-abc.github.dev",
      "path": "/workspaces/backend",
      "description": "Backend team in GitHub Codespace"
    }
  }
}
```

**Key Innovation:** Transparent remote execution - Iris treats remote teams identically to local teams, with all complexity hidden in the transport layer.

---

## Vision

### The Problem: Distributed Development

Modern development environments are increasingly distributed:

- **Cloud Workspaces**: GitHub Codespaces, AWS Cloud9, Gitpod
- **Specialized Hardware**: GPU clusters, high-memory machines, ARM servers
- **Security Requirements**: Sensitive codebases on isolated hosts
- **Geographic Distribution**: Teams in different data centers/regions
- **Development Containers**: Docker/Kubernetes environments
- **Hybrid Work**: Some developers local, some remote

**Current Iris MCP:** Only coordinates local projects on a single machine.

**Enhanced Iris MCP:** Coordinates AI agents across any SSH-accessible host.

### The Solution: Remote Team Execution

Enable Iris to:

1. **Spawn Claude Code processes on remote hosts via SSH**
2. **Maintain stdio streaming across SSH connections**
3. **Handle connection failures gracefully with auto-reconnect**
4. **Cache credentials and connections for performance**
5. **Provide transparent experience - remote looks like local**

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
│  │    - if (config.remote): RemoteSSHTransport          │  │
│  │    - else: LocalTransport                            │  │
│  └────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
┌──────────────────┐          ┌──────────────────┐
│ LocalTransport   │          │ RemoteSSHTransport│
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

1. **LocalTransport** (existing ClaudeProcess logic)
2. **RemoteSSHTransport** (new - SSH tunneling)
3. **Future**: DockerTransport, KubernetesTransport, WSLTransport

---

## Configuration Schema

### Team Configuration with Remote

```typescript
interface IrisConfig {
  path: string;                   // Path on target host (local or remote)
  description: string;

  // NEW: Remote execution command
  remote?: string;                // e.g., "ssh user@host.com"

  // Optional SSH-specific configuration
  remoteOptions?: {
    identity?: string;            // Path to SSH private key
    port?: number;                // SSH port (default: 22)
    strictHostKeyChecking?: boolean; // Default: true
    connectTimeout?: number;      // Connection timeout (ms)
    serverAliveInterval?: number; // Keepalive interval (default: 30s)
    serverAliveCountMax?: number; // Max keepalive failures (default: 3)
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

```json
{
  "team-backend": {
    "remote": "ssh -o StrictHostKeyChecking=no codespace-abc@123.github.dev",
    "path": "/workspaces/backend",
    "description": "Backend team running in GitHub Codespace",
    "remoteOptions": {
      "connectTimeout": 10000,
      "serverAliveInterval": 30000
    }
  }
}
```

**2. AWS Cloud9**

```json
{
  "team-data": {
    "remote": "ssh ec2-user@ec2-54-123-45-67.compute-1.amazonaws.com",
    "path": "/home/ec2-user/environment/data-pipeline",
    "description": "Data team on AWS Cloud9",
    "remoteOptions": {
      "identity": "~/.ssh/aws-cloud9.pem",
      "port": 22
    }
  }
}
```

**3. GPU Cluster**

```json
{
  "team-ml": {
    "remote": "ssh ml@gpu-cluster.company.com",
    "path": "/mnt/shared/ml-models",
    "description": "ML team with GPU access",
    "remoteOptions": {
      "identity": "~/.ssh/gpu_cluster_rsa",
      "serverAliveInterval": 60000
    }
  }
}
```

**4. Docker Container**

```json
{
  "team-test": {
    "remote": "docker exec -i test-container",
    "path": "/app",
    "description": "Testing team in Docker container"
  }
}
```

**5. Kubernetes Pod**

```json
{
  "team-frontend": {
    "remote": "kubectl exec -i frontend-pod-abc123 --",
    "path": "/usr/src/app",
    "description": "Frontend team in Kubernetes"
  }
}
```

---

## Technical Challenges

### 1. SSH Connection Management

**Challenge:** SSH connections can drop, timeout, or become stale.

**Solution:**

- **Connection Pooling**: Reuse SSH connections across multiple operations
- **Keepalive**: Send periodic keepalive packets (`ServerAliveInterval=30`)
- **Auto-Reconnect**: Detect disconnections and automatically reconnect
- **Graceful Degradation**: Queue commands during reconnection attempts

**Implementation:**

```typescript
class SSHConnectionPool {
  private connections = new Map<string, SSHConnection>();

  async getConnection(remote: string, options: RemoteOptions): Promise<SSHConnection> {
    const existing = this.connections.get(remote);

    if (existing && existing.isAlive()) {
      return existing;
    }

    // Create new connection with keepalive
    const conn = new SSHConnection(remote, {
      ...options,
      serverAliveInterval: 30000,
      serverAliveCountMax: 3,
    });

    await conn.connect();
    this.connections.set(remote, conn);

    return conn;
  }
}
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
class RemoteSSHTransport implements Transport {
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
   ```json
   {
     "remote": "ssh -A user@host"
   }
   ```

2. **Explicit Identity File**
   ```json
   {
     "remoteOptions": {
       "identity": "~/.ssh/company_rsa"
     }
   }
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
   ```json
   {
     "remote": "ssh gpu-cluster"
   }
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

### 6. Error Handling

**SSH-Specific Errors:**

- **Connection Refused** - Host unreachable or SSH daemon down
- **Authentication Failed** - Invalid credentials or keys
- **Host Key Verification Failed** - Known_hosts mismatch
- **Connection Timeout** - Network issues or firewall
- **Connection Dropped** - Mid-operation disconnect

**Error Recovery Strategy:**

```typescript
class RemoteSSHTransport {
  private retryConfig = {
    maxRetries: 3,
    backoff: [1000, 5000, 10000], // Exponential backoff
  };

  async spawnWithRetry(spawnCacheEntry: CacheEntry): Promise<void> {
    for (let attempt = 0; attempt < this.retryConfig.maxRetries; attempt++) {
      try {
        await this.spawn(spawnCacheEntry);
        return; // Success
      } catch (error) {
        if (this.isRetryable(error) && attempt < this.retryConfig.maxRetries - 1) {
          const delay = this.retryConfig.backoff[attempt];
          this.logger.warn('SSH connection failed, retrying...', { attempt, delay });
          await sleep(delay);
        } else {
          throw error; // Give up
        }
      }
    }
  }

  private isRetryable(error: Error): boolean {
    // Retry network issues, not authentication failures
    return (
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('Connection closed')
    );
  }
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

### Phase 2: RemoteSSHTransport Implementation

**Goal:** Implement SSH tunneling transport.

**Files:**

```
src/transport/
├── transport.interface.ts       # Transport interface
├── local-transport.ts           # LocalTransport (existing logic)
├── remote-ssh-transport.ts      # RemoteSSHTransport (new)
├── transport-factory.ts         # Factory to select transport
└── ssh-connection-pool.ts       # SSH connection management
```

**RemoteSSHTransport Implementation:**

```typescript
class RemoteSSHTransport implements Transport {
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

### Phase 3: Configuration & Validation

**Goal:** Update config schema and validation.

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

**Validation:**

```typescript
// Validate SSH command exists if remote specified
if (config.remote && !config.remote.includes('ssh') && !config.remote.includes('docker') && !config.remote.includes('kubectl')) {
  logger.warn('Remote command does not look like SSH/Docker/kubectl', { remote: config.remote });
}
```

### Phase 4: SSH Connection Pooling

**Goal:** Reuse SSH connections for performance.

**Implementation:**

```typescript
class SSHConnectionPool {
  private connections = new Map<string, SSHConnection>();

  async getConnection(
    remote: string,
    options: RemoteOptions
  ): Promise<SSHConnection> {
    const cacheKey = `${remote}:${JSON.stringify(options)}`;
    const existing = this.connections.get(cacheKey);

    if (existing && existing.isAlive()) {
      return existing;
    }

    // Create new connection
    const conn = new SSHConnection(remote, options);
    await conn.connect();

    this.connections.set(cacheKey, conn);

    // Cleanup on disconnect
    conn.on('close', () => {
      this.connections.delete(cacheKey);
    });

    return conn;
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
  }
}
```

### Phase 5: Testing & Validation

**Test Matrix:**

| Local | Remote (LAN) | Remote (WAN) | Docker | Kubernetes |
|-------|--------------|--------------|--------|------------|
| ✅ Baseline | ✅ Primary target | ✅ Test latency | 🔮 Future | 🔮 Future |

**Integration Tests:**

```typescript
describe('RemoteSSHTransport', () => {
  it('should spawn Claude on remote host', async () => {
    const config = {
      remote: 'ssh test@localhost',
      path: '/tmp/test-project',
    };

    const transport = new RemoteSSHTransport('test', config, null);
    const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, 'ping');

    await transport.spawn(spawnEntry);

    expect(transport.isReady()).toBe(true);
  });

  it('should handle connection failures gracefully', async () => {
    const config = {
      remote: 'ssh test@nonexistent-host.local',
      path: '/tmp/test',
    };

    const transport = new RemoteSSHTransport('test', config, null);

    await expect(transport.spawn(spawnEntry)).rejects.toThrow('Connection refused');
  });
});
```

---

## Use Cases

### 1. Hybrid Local + Cloud Development

**Scenario:** Frontend local, backend in AWS Cloud9

```json
{
  "teams": {
    "team-frontend": {
      "path": "/Users/dev/projects/frontend",
      "description": "Local frontend development"
    },
    "team-backend": {
      "remote": "ssh ec2-user@cloud9.amazonaws.com",
      "path": "/home/ec2-user/backend",
      "description": "Backend on AWS Cloud9"
    }
  }
}
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

```json
{
  "teams": {
    "team-ml": {
      "remote": "ssh ml@gpu-cluster.company.com",
      "path": "/mnt/shared/ml-models",
      "description": "ML team with 8x A100 GPUs"
    }
  }
}
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

```json
{
  "teams": {
    "team-us": {
      "remote": "ssh dev@us-east-1.company.com",
      "path": "/app/us-region",
      "description": "US-based team"
    },
    "team-eu": {
      "remote": "ssh dev@eu-west-1.company.com",
      "path": "/app/eu-region",
      "description": "EU-based team (GDPR compliance)"
    },
    "team-asia": {
      "remote": "ssh dev@ap-southeast-1.company.com",
      "path": "/app/asia-region",
      "description": "Asia-Pacific team"
    }
  }
}
```

**Workflow:** Global coordination from single Iris instance.

### 4. Security Isolation

**Scenario:** Sensitive codebase on isolated bastion host

```json
{
  "team-security": {
    "remote": "ssh -J bastion.company.com security@vault.internal",
    "path": "/secure/audit-system",
    "description": "Security team on air-gapped network"
  }
}
```

**SSH Jump Host (`-J`):** Iris → Bastion → Vault (multi-hop SSH)

### 5. Docker/Kubernetes Development

**Scenario:** Teams working in containerized environments

```json
{
  "team-containerized": {
    "remote": "docker exec -i dev-container",
    "path": "/app",
    "description": "Team in Docker dev container"
  },
  "team-k8s": {
    "remote": "kubectl exec -i frontend-pod-abc --",
    "path": "/usr/src/app",
    "description": "Team in Kubernetes pod"
  }
}
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
  ```json
  // ❌ BAD
  {
    "remoteOptions": {
      "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n..."
    }
  }

  // ✅ GOOD
  {
    "remoteOptions": {
      "identity": "~/.ssh/company_rsa"
    }
  }
  ```

- **Use SSH Agent**:
  ```bash
  eval $(ssh-agent)
  ssh-add ~/.ssh/company_rsa
  ```

  Then:
  ```json
  {
    "remote": "ssh -A user@host"
  }
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
  ```json
  {
    "remoteOptions": {
      "strictHostKeyChecking": true  // Reject unknown hosts
    }
  }
  ```

- **Pre-populate known_hosts**:
  ```bash
  ssh-keyscan gpu.company.com >> ~/.ssh/known_hosts
  ```

- **Only disable for trusted networks**:
  ```json
  {
    "remote": "ssh -o StrictHostKeyChecking=no user@localhost"
    // Only for development/testing!
  }
  ```

### 3. Credential Leakage

**Risk:** SSH credentials logged or exposed

**Mitigations:**

- **Sanitize logs**: Never log full SSH commands with credentials
- **Audit config files**: Restrict permissions on `config.json` (600)
- **Use environment variables** for sensitive data:
  ```json
  {
    "remote": "ssh ${SSH_USER}@${SSH_HOST}"
  }
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

1. **Connection Reuse**: Amortize SSH connect cost across multiple operations
2. **SSH Compression**: `ssh -C` for large payloads
3. **Multiplexing**: Share single SSH connection for multiple processes
   ```bash
   # ~/.ssh/config
   Host *
     ControlMaster auto
     ControlPath ~/.ssh/sockets/%r@%h-%p
     ControlPersist 600
   ```
4. **Async Mode**: Use fire-and-forget for non-critical operations

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
         return new RemoteSSHTransport(irisConfig);
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

```json
// Step 1: Start with local teams
{
  "teams": {
    "team-alpha": {
      "path": "/Users/dev/alpha"
    }
  }
}

// Step 2: Gradually add remote teams
{
  "teams": {
    "team-alpha": {
      "path": "/Users/dev/alpha"
    },
    "team-beta": {
      "remote": "ssh dev@cloud.com",
      "path": "/app/beta"
    }
  }
}

// Step 3: Fully distributed
{
  "teams": {
    "team-alpha": {
      "remote": "ssh dev@host-a.com",
      "path": "/app/alpha"
    },
    "team-beta": {
      "remote": "ssh dev@host-b.com",
      "path": "/app/beta"
    }
  }
}
```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Define Transport interface
- [ ] Extract LocalTransport from ClaudeProcess
- [ ] Implement TransportFactory
- [ ] Update config schema with `remote` field
- [ ] Unit tests for transport abstraction

### Phase 2: SSH Transport
- [ ] Implement RemoteSSHTransport
- [ ] SSH connection management
- [ ] Stdio tunneling over SSH
- [ ] Error handling and retries
- [ ] Integration tests with localhost SSH

### Phase 3: Connection Pooling
- [ ] SSH connection pool implementation
- [ ] Keepalive management
- [ ] Auto-reconnect logic
- [ ] Health checks for SSH connections

### Phase 4: Configuration & Validation
- [ ] Update Zod schema
- [ ] SSH command validation
- [ ] Remote options handling
- [ ] Documentation for remote config

### Phase 5: Testing & Hardening
- [ ] E2E tests with real SSH hosts
- [ ] Performance benchmarks (local vs remote)
- [ ] Security audit
- [ ] Load testing with 10+ remote teams

### Phase 6: Advanced Features
- [ ] Docker transport (`docker exec`)
- [ ] Kubernetes transport (`kubectl exec`)
- [ ] WSL transport (Windows Subsystem for Linux)
- [ ] SSH multiplexing optimization

---

## Future Enhancements

### 1. WebSocket/HTTP Transport

**Instead of SSH, use HTTP/WebSocket for remote execution:**

```json
{
  "team-cloud": {
    "remote": "https://api.iris-cloud.com/teams/backend",
    "remoteType": "http",
    "authentication": {
      "type": "bearer",
      "token": "${IRIS_CLOUD_TOKEN}"
    }
  }
}
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

**Implementation Complexity:** Medium
- Transport abstraction: ~500 LOC
- SSH transport: ~800 LOC
- Connection pooling: ~300 LOC
- Configuration: ~200 LOC
- **Total:** ~1800 LOC

**Benefits:**
- ✅ Distributed AI orchestration
- ✅ Hybrid local/cloud workflows
- ✅ Specialized hardware access (GPUs)
- ✅ Geographic distribution
- ✅ Security isolation
- ✅ 100% backward compatible

**The future of Iris is distributed.**

---

**Document Version:** 1.0 (Proposal)
**Last Updated:** October 2025
**Status:** Design Phase - Pending Implementation
