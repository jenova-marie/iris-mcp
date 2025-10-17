# Iris MCP API Authentication Implementation Plan

**Status:** Planning Phase
**Created:** 2025-01-16
**Priority:** PREREQUISITE for Phase 3 (API Server)
**Target Release:** Phase 3.0 (Foundation)

---

## Executive Summary

Authentication is the **foundational layer** for Iris MCP's HTTP/WebSocket API. This plan establishes:

1. **API Key Management** - Generation, storage, rotation, revocation
2. **Permission Model** - Granular, role-based access control
3. **Security Architecture** - Defense in depth, audit logging, rate limiting
4. **MCP Integration** - Separate concerns: MCP tool approval ≠ API authentication

**Critical Principle**: Auth must be designed first, tested thoroughly, and hardened before any API endpoints are exposed.

---

## Architecture Philosophy

### Separation of Concerns

Iris has **two distinct security boundaries**:

1. **MCP Tool Approval** (`--permission-prompt-tool`)
   - Local trust: Does jenova trust this Claude instance to use Iris MCP tools?
   - Scope: MCP protocol within a single Claude Code session
   - Implementation: `src/actions/permissions-approve.ts`

2. **API Authentication** (this plan)
   - Remote trust: Does an external HTTP/WebSocket client have permission to control teams?
   - Scope: HTTP/WebSocket API exposed to network
   - Implementation: `src/api/auth/*` (to be created)

**These are orthogonal concerns and must not be conflated.**

### Defense in Depth

Authentication is layered:

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Network (Firewall, TLS)               │
├─────────────────────────────────────────────────┤
│ Layer 2: Rate Limiting (Express middleware)    │
├─────────────────────────────────────────────────┤
│ Layer 3: API Key Validation (Bearer token)     │
├─────────────────────────────────────────────────┤
│ Layer 4: Permission Check (RBAC)               │
├─────────────────────────────────────────────────┤
│ Layer 5: Input Validation (Existing utils)     │
├─────────────────────────────────────────────────┤
│ Layer 6: Audit Logging (SQLite + Wonder)       │
└─────────────────────────────────────────────────┘
```

---

## API Key Design

### Key Format

**Structure**: `iris_sk_{environment}_{random}`

- `iris_` - Fixed prefix for identification
- `sk` - "Secret Key" (distinguishes from future public keys)
- `{environment}` - Optional: `dev`, `prod`, `test` (omitted for default)
- `{random}` - 32-byte cryptographically random string (base62 encoded)

**Examples**:
```
iris_sk_abc123def456ghi789jkl012mno345pqr678stu
iris_sk_dev_xyz789abc012def345ghi678jkl901mno234
iris_sk_prod_abc123def456ghi789jkl012mno345pqr678
```

**Length**: 50-55 characters (prefix + random)

### Key Generation

**Implementation**: `src/api/auth/key-generator.ts`

```typescript
import { randomBytes } from 'crypto';

export interface ApiKeyMetadata {
  key: string;              // Full key: iris_sk_{env}_{random}
  hash: string;             // SHA-256 hash for storage
  name: string;             // Human-readable label
  permissions: Permission[];
  createdAt: number;        // Unix timestamp (ms)
  expiresAt?: number;       // Optional expiration
  revokedAt?: number;       // Revocation timestamp
  lastUsedAt?: number;      // Track last usage
  usageCount: number;       // Total requests
}

export function generateApiKey(
  name: string,
  permissions: Permission[],
  options?: {
    environment?: 'dev' | 'prod' | 'test';
    expiresInDays?: number;
  }
): ApiKeyMetadata {
  const random = randomBytes(32)
    .toString('base64')
    .replace(/[+/=]/g, '') // Base62: alphanumeric only
    .substring(0, 40);

  const env = options?.environment ? `_${options.environment}` : '';
  const key = `iris_sk${env}_${random}`;

  // Hash for storage (never store plaintext keys)
  const hash = createHash('sha256').update(key).digest('hex');

  const createdAt = Date.now();
  const expiresAt = options?.expiresInDays
    ? createdAt + (options.expiresInDays * 24 * 60 * 60 * 1000)
    : undefined;

  return {
    key,      // Return once, never shown again
    hash,     // Store this
    name,
    permissions,
    createdAt,
    expiresAt,
    usageCount: 0
  };
}
```

**CLI Command**:
```bash
pnpm iris generate-key "Dashboard Client" --permissions tell,wake,status --expires 90
# Output: iris_sk_abc123def456ghi789jkl012mno345pqr678stu
#         ⚠️  Save this key securely - it will not be shown again!
```

### Key Storage

**DO NOT store API keys in `config.yaml`**. Mixing configuration with secrets is a security anti-pattern.

**Storage Location**: `$IRIS_HOME/keys.db` (SQLite)

**Schema**:
```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,           -- SHA-256 of actual key
  name TEXT NOT NULL,                  -- Human-readable label
  permissions TEXT NOT NULL,            -- JSON array of permissions
  created_at INTEGER NOT NULL,          -- Unix timestamp (ms)
  expires_at INTEGER,                   -- Optional expiration
  revoked_at INTEGER,                   -- Revocation timestamp
  last_used_at INTEGER,                 -- Last usage timestamp
  usage_count INTEGER DEFAULT 0,        -- Total requests
  metadata TEXT                         -- JSON for future extensibility
);

CREATE INDEX idx_hash ON api_keys(hash);
CREATE INDEX idx_revoked ON api_keys(revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
```

**Implementation**: `src/api/auth/key-store.ts`

```typescript
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { ApiKeyMetadata, Permission } from '../types.js';

export class ApiKeyStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        last_used_at INTEGER,
        usage_count INTEGER DEFAULT 0,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_hash ON api_keys(hash);
      CREATE INDEX IF NOT EXISTS idx_revoked ON api_keys(revoked_at) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
    `);
  }

  /** Store a new API key (hash only, not plaintext) */
  store(metadata: ApiKeyMetadata): void {
    const stmt = this.db.prepare(`
      INSERT INTO api_keys (hash, name, permissions, created_at, expires_at, usage_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      metadata.hash,
      metadata.name,
      JSON.stringify(metadata.permissions),
      metadata.createdAt,
      metadata.expiresAt ?? null,
      0
    );
  }

  /** Validate API key and return metadata */
  validate(key: string): ApiKeyMetadata | null {
    const hash = createHash('sha256').update(key).digest('hex');

    const stmt = this.db.prepare(`
      SELECT * FROM api_keys
      WHERE hash = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `);

    const row = stmt.get(hash, Date.now()) as any;
    if (!row) return null;

    // Update last_used_at and usage_count
    this.db.prepare(`
      UPDATE api_keys
      SET last_used_at = ?, usage_count = usage_count + 1
      WHERE hash = ?
    `).run(Date.now(), hash);

    return {
      key: '',  // Never return plaintext key
      hash: row.hash,
      name: row.name,
      permissions: JSON.parse(row.permissions),
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
      usageCount: row.usage_count + 1
    };
  }

  /** Revoke an API key */
  revoke(hash: string): void {
    this.db.prepare(`
      UPDATE api_keys SET revoked_at = ? WHERE hash = ?
    `).run(Date.now(), hash);
  }

  /** List all API keys (for CLI management) */
  list(): ApiKeyMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys ORDER BY created_at DESC
    `);

    return stmt.all().map((row: any) => ({
      key: '',
      hash: row.hash,
      name: row.name,
      permissions: JSON.parse(row.permissions),
      createdAt: row.created_at,
      expiresAt: row.expired_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
      usageCount: row.usage_count
    }));
  }
}
```

---

## Permission Model

### Permission Types

**Granular, action-based permissions**:

| Permission | Description | MCP Tools | API Endpoints |
|------------|-------------|-----------|---------------|
| `team:tell` | Send messages to teams | `team_tell`, `team_quick_tell` | `POST /api/teams/tell` |
| `team:wake` | Start team processes | `team_wake`, `team_wake_all` | `POST /api/teams/:team/wake` |
| `team:sleep` | Stop team processes | `team_sleep` | `POST /api/teams/:team/sleep` |
| `team:cancel` | Cancel running operations | `team_cancel` | `POST /api/teams/:team/cancel` |
| `team:clear` | Clear sessions | `team_clear`, `team_delete` | `DELETE /api/teams/:team/clear` |
| `team:compact` | Compact sessions | `team_compact` | `POST /api/teams/:team/compact` |
| `team:fork` | Fork sessions | `team_fork` | `POST /api/teams/:team/fork` |
| `cache:read` | View cache contents | `team_report` | `GET /api/teams/:team/report` |
| `cache:write` | Modify cache | (future) | `DELETE /api/cache/:sessionId` |
| `status:read` | View system status | `team_isAwake`, `team_teams` | `GET /api/teams/status` |
| `debug:read` | Access debug logs | `team_debug` | `GET /api/debug/logs` |
| `admin` | All permissions | All tools | All endpoints |

### Permission Groups (Roles)

**Pre-defined roles for common use cases**:

```typescript
// src/api/auth/roles.ts
export const ROLES = {
  viewer: ['status:read', 'cache:read'],
  operator: ['status:read', 'cache:read', 'team:tell', 'team:wake'],
  developer: ['status:read', 'cache:read', 'team:tell', 'team:wake', 'team:sleep', 'team:clear', 'debug:read'],
  admin: ['admin']
} as const;
```

**CLI Usage**:
```bash
pnpm iris generate-key "Dashboard" --role operator
pnpm iris generate-key "CI/CD Pipeline" --permissions team:tell,team:wake
```

### Permission Validation

**Implementation**: `src/api/auth/permissions.ts`

```typescript
export type Permission =
  | 'team:tell'
  | 'team:wake'
  | 'team:sleep'
  | 'team:cancel'
  | 'team:clear'
  | 'team:compact'
  | 'team:fork'
  | 'cache:read'
  | 'cache:write'
  | 'status:read'
  | 'debug:read'
  | 'admin';

export function hasPermission(
  userPermissions: Permission[],
  required: Permission
): boolean {
  // Admin bypass
  if (userPermissions.includes('admin')) {
    return true;
  }

  // Wildcard support (future): 'team:*' matches 'team:tell', 'team:wake', etc.
  return userPermissions.includes(required);
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if auth disabled
    if (!req.apiKeyMetadata) {
      return next();
    }

    if (!hasPermission(req.apiKeyMetadata.permissions, permission)) {
      throw new ForbiddenError(
        `Insufficient permissions. Required: ${permission}`
      );
    }

    next();
  };
}
```

---

## Authentication Middleware

### Bearer Token Validation

**Implementation**: `src/api/middleware/auth.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import type { ApiKeyStore } from '../auth/key-store.js';
import { UnauthorizedError } from '../../utils/errors.js';

export function createAuthMiddleware(keyStore: ApiKeyStore, requireAuth: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip if auth not required
    if (!requireAuth) {
      req.apiKeyMetadata = null;
      return next();
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const key = authHeader.replace('Bearer ', '');

    // Validate key
    const metadata = keyStore.validate(key);
    if (!metadata) {
      throw new UnauthorizedError('Invalid or expired API key');
    }

    // Attach metadata to request
    req.apiKeyMetadata = metadata;
    next();
  };
}
```

### WebSocket Authentication

**Socket.io handshake authentication**:

```typescript
// src/api/websocket/auth.ts
import type { Socket } from 'socket.io';
import type { ApiKeyStore } from '../auth/key-store.js';

export function createSocketAuthMiddleware(keyStore: ApiKeyStore, requireAuth: boolean) {
  return (socket: Socket, next: (err?: Error) => void) => {
    // Skip if auth not required
    if (!requireAuth) {
      socket.data.apiKeyMetadata = null;
      return next();
    }

    // Extract token from handshake auth
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    // Validate key
    const metadata = keyStore.validate(token);
    if (!metadata) {
      return next(new Error('Invalid or expired API key'));
    }

    // Attach metadata to socket
    socket.data.apiKeyMetadata = metadata;
    next();
  };
}
```

---

## Rate Limiting

### Strategy

**Per-API-key rate limiting** (more granular than IP-based):

```typescript
// src/api/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

export function createApiRateLimiter(config: {
  windowMs: number;
  maxRequests: number;
}) {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.maxRequests,

    // Key by API key hash (or IP if no auth)
    keyGenerator: (req: Request) => {
      return req.apiKeyMetadata?.hash ?? req.ip;
    },

    // Custom error response
    handler: (req, res) => {
      res.status(429).json({
        error: 'TooManyRequestsError',
        message: 'Rate limit exceeded. Try again later.',
        statusCode: 429,
        timestamp: Date.now(),
        retryAfter: Math.ceil(config.windowMs / 1000)
      });
    },

    // Don't count successful requests against limit
    skipSuccessfulRequests: false,
    skipFailedRequests: false,

    // Standard headers
    standardHeaders: true,
    legacyHeaders: false
  });
}
```

### Configuration

**Per-key rate limits** (stored in `api_keys.metadata` JSON):

```typescript
// Future enhancement: per-key custom limits
{
  "hash": "abc123...",
  "name": "High-volume CI/CD",
  "permissions": ["team:tell"],
  "metadata": {
    "rateLimitOverride": {
      "windowMs": 60000,
      "maxRequests": 1000  // 1000 req/min instead of default 100
    }
  }
}
```

---

## Audit Logging

### Event Types

All authentication events are logged to **both SQLite and Wonder Logger**:

- `auth:key_generated` - New API key created
- `auth:key_revoked` - API key revoked
- `auth:validated` - Successful authentication
- `auth:failed` - Failed authentication attempt
- `auth:forbidden` - Permission denied
- `auth:rate_limited` - Rate limit exceeded

### SQLite Audit Log

**Schema** (separate from keys.db):

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,       -- 'auth:validated', 'auth:failed', etc.
  key_hash TEXT,                  -- API key hash (if applicable)
  key_name TEXT,                  -- Key name for readability
  ip_address TEXT,                -- Client IP
  endpoint TEXT,                  -- '/api/teams/tell'
  method TEXT,                    -- 'POST', 'GET', etc.
  status_code INTEGER,            -- HTTP status code
  error_message TEXT,             -- If failed
  metadata TEXT                   -- JSON for extensibility
);

CREATE INDEX idx_timestamp ON audit_log(timestamp);
CREATE INDEX idx_key_hash ON audit_log(key_hash);
CREATE INDEX idx_event_type ON audit_log(event_type);
```

### Wonder Logger Integration

```typescript
// src/api/middleware/audit.ts
import { getChildLogger } from '../../utils/logger.js';

const auditLogger = getChildLogger('iris:audit');

export function auditLog(
  event: string,
  metadata: Record<string, any>
): void {
  auditLogger.info({
    event,
    timestamp: Date.now(),
    ...metadata
  }, `Audit: ${event}`);
}

// Usage in auth middleware
auditLog('auth:validated', {
  keyHash: metadata.hash,
  keyName: metadata.name,
  ip: req.ip,
  endpoint: req.path
});
```

---

## Configuration Integration

### Update `example.config.yaml`

```json
{
  "settings": { /* existing */ },
  "dashboard": { /* existing */ },
  "database": { /* existing */ },
  "api": {
    "enabled": false,            // Default: disabled for security
    "port": 1615,
    "host": "127.0.0.1",         // Default: localhost only
    "requireAuth": true,         // Default: auth required
    "keyStorePath": "${IRIS_HOME}/keys.db",
    "auditLogPath": "${IRIS_HOME}/audit.db",
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3100"]  // Dashboard only by default
    },
    "rateLimit": {
      "enabled": true,
      "windowMs": 900000,        // 15 minutes
      "maxRequests": 100
    }
  },
  "teams": { /* existing */ }
}
```

**No `apiKeys` array in config.yaml** - keys are managed via CLI and stored in `keys.db`.

### Zod Schema

```typescript
// src/config/iris-config.ts
const ApiConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(1615),
  host: z.string().default('127.0.0.1'),
  requireAuth: z.boolean().default(true),
  keyStorePath: z.string().default('${IRIS_HOME}/keys.db'),
  auditLogPath: z.string().default('${IRIS_HOME}/audit.db'),
  cors: z.object({
    enabled: z.boolean().default(true),
    origins: z.array(z.string()).default(['http://localhost:3100'])
  }),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().positive().default(900000),
    maxRequests: z.number().int().positive().default(100)
  })
});
```

---

## CLI Commands

### Key Management CLI

**Implementation**: `src/cli/commands/key.ts` (using Commander.js)

```typescript
import { Command } from 'commander';
import { generateApiKey } from '../api/auth/key-generator.js';
import { ApiKeyStore } from '../api/auth/key-store.js';

const keyCommand = new Command('key');

// Generate new key
keyCommand
  .command('generate')
  .argument('<name>', 'Human-readable key name')
  .option('-p, --permissions <perms>', 'Comma-separated permissions')
  .option('-r, --role <role>', 'Pre-defined role (viewer, operator, developer, admin)')
  .option('-e, --expires <days>', 'Expiration in days')
  .option('--env <env>', 'Environment (dev, prod, test)')
  .action(async (name, options) => {
    const keyStore = new ApiKeyStore(config.api.keyStorePath);

    const permissions = options.role
      ? ROLES[options.role]
      : options.permissions.split(',');

    const metadata = generateApiKey(name, permissions, {
      environment: options.env,
      expiresInDays: options.expires ? parseInt(options.expires) : undefined
    });

    keyStore.store(metadata);

    console.log('\n✅ API key generated successfully!\n');
    console.log(`Key: ${metadata.key}`);
    console.log('\n⚠️  Save this key securely - it will not be shown again!\n');
  });

// List keys
keyCommand
  .command('list')
  .option('--active', 'Show only active (non-revoked) keys')
  .action(async (options) => {
    const keyStore = new ApiKeyStore(config.api.keyStorePath);
    const keys = keyStore.list();

    // Format as table
    console.table(keys.map(k => ({
      Name: k.name,
      Permissions: k.permissions.join(', '),
      Created: new Date(k.createdAt).toLocaleString(),
      Expires: k.expiresAt ? new Date(k.expiresAt).toLocaleString() : 'Never',
      Status: k.revokedAt ? 'Revoked' : 'Active',
      UsageCount: k.usageCount
    })));
  });

// Revoke key
keyCommand
  .command('revoke')
  .argument('<hash>', 'Key hash (first 12 chars)')
  .action(async (hash) => {
    const keyStore = new ApiKeyStore(config.api.keyStorePath);
    keyStore.revoke(hash);
    console.log('✅ API key revoked successfully');
  });

export { keyCommand };
```

**Usage**:
```bash
# Generate keys
pnpm iris key generate "Dashboard" --role operator
pnpm iris key generate "CI Pipeline" --permissions team:tell,team:wake --expires 90
pnpm iris key generate "Admin Key" --role admin --env prod

# List keys
pnpm iris key list
pnpm iris key list --active

# Revoke key
pnpm iris key revoke abc123def456
```

---

## Security Hardening

### TLS/HTTPS Support

**Optional production hardening** (Phase 3.5):

```json
{
  "api": {
    "tls": {
      "enabled": true,
      "cert": "/path/to/cert.pem",
      "key": "/path/to/key.pem",
      "ca": "/path/to/ca.pem"  // Optional for mutual TLS
    }
  }
}
```

### Environment-Specific Defaults

```typescript
// src/api/auth/defaults.ts
export function getSecurityDefaults(env: 'development' | 'production') {
  if (env === 'production') {
    return {
      requireAuth: true,
      host: '127.0.0.1',        // Localhost only
      cors: { enabled: false }, // No CORS in prod
      rateLimit: {
        windowMs: 60000,        // 1 minute
        maxRequests: 50         // Stricter limit
      }
    };
  }

  return {
    requireAuth: false,         // Dev convenience
    host: '0.0.0.0',           // Allow LAN access
    cors: { enabled: true, origins: ['*'] },
    rateLimit: {
      windowMs: 900000,
      maxRequests: 1000
    }
  };
}
```

### Secret Scanning Protection

**Add to `.gitignore`**:
```
keys.db
keys.db-shm
keys.db-wal
audit.db
audit.db-shm
audit.db-wal
*.pem
*.key
.env.local
```

**Add to `.git-secrets` or `gitleaks.toml`**:
```toml
[[rules]]
description = "Iris API Key"
regex = '''iris_sk_[a-zA-Z0-9_]{40,60}'''
```

---

## Testing Strategy

### Unit Tests

**Files**: `tests/unit/auth/*.test.ts`

```typescript
// tests/unit/auth/key-generator.test.ts
describe('API Key Generation', () => {
  it('should generate valid key format', () => {
    const key = generateApiKey('Test', ['team:tell']);
    expect(key.key).toMatch(/^iris_sk_[a-zA-Z0-9]{40,}$/);
  });

  it('should include environment in key', () => {
    const key = generateApiKey('Test', ['admin'], { environment: 'dev' });
    expect(key.key).toMatch(/^iris_sk_dev_/);
  });

  it('should generate unique keys', () => {
    const key1 = generateApiKey('Test1', ['admin']);
    const key2 = generateApiKey('Test2', ['admin']);
    expect(key1.key).not.toBe(key2.key);
    expect(key1.hash).not.toBe(key2.hash);
  });
});

// tests/unit/auth/key-store.test.ts
describe('ApiKeyStore', () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore(':memory:');
  });

  it('should validate correct key', () => {
    const metadata = generateApiKey('Test', ['team:tell']);
    store.store(metadata);

    const validated = store.validate(metadata.key);
    expect(validated).not.toBeNull();
    expect(validated?.name).toBe('Test');
  });

  it('should reject revoked key', () => {
    const metadata = generateApiKey('Test', ['team:tell']);
    store.store(metadata);
    store.revoke(metadata.hash);

    const validated = store.validate(metadata.key);
    expect(validated).toBeNull();
  });

  it('should reject expired key', () => {
    const metadata = generateApiKey('Test', ['team:tell'], { expiresInDays: -1 });
    store.store(metadata);

    const validated = store.validate(metadata.key);
    expect(validated).toBeNull();
  });
});

// tests/unit/auth/permissions.test.ts
describe('Permission Validation', () => {
  it('should allow admin all permissions', () => {
    expect(hasPermission(['admin'], 'team:tell')).toBe(true);
    expect(hasPermission(['admin'], 'debug:read')).toBe(true);
  });

  it('should deny insufficient permissions', () => {
    expect(hasPermission(['team:tell'], 'team:wake')).toBe(false);
  });

  it('should allow exact permission match', () => {
    expect(hasPermission(['team:tell', 'status:read'], 'team:tell')).toBe(true);
  });
});
```

### Integration Tests

**Files**: `tests/integration/auth/*.test.ts`

```typescript
// tests/integration/auth/middleware.test.ts
import request from 'supertest';

describe('Authentication Middleware', () => {
  let app: Express;
  let validKey: string;

  beforeAll(() => {
    // Setup test app with auth middleware
    const metadata = generateApiKey('Test', ['team:tell']);
    keyStore.store(metadata);
    validKey = metadata.key;
  });

  it('should reject requests without Authorization header', async () => {
    const res = await request(app).post('/api/teams/tell');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UnauthorizedError');
  });

  it('should reject invalid API key', async () => {
    const res = await request(app)
      .post('/api/teams/tell')
      .set('Authorization', 'Bearer invalid_key');
    expect(res.status).toBe(401);
  });

  it('should accept valid API key', async () => {
    const res = await request(app)
      .post('/api/teams/tell')
      .set('Authorization', `Bearer ${validKey}`)
      .send({ toTeam: 'test', message: 'hello', fromTeam: 'team-iris' });
    expect(res.status).not.toBe(401);
  });

  it('should enforce permissions', async () => {
    const limitedKey = generateApiKey('Limited', ['status:read']);
    keyStore.store(limitedKey);

    const res = await request(app)
      .post('/api/teams/tell')  // Requires 'team:tell'
      .set('Authorization', `Bearer ${limitedKey.key}`)
      .send({ toTeam: 'test', message: 'hello', fromTeam: 'team-iris' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });
});
```

---

## Implementation Timeline

### Phase 3.0: Auth Foundation (Week 1)

- [x] Design auth architecture (this document)
- [ ] Implement key generation (`key-generator.ts`)
- [ ] Implement key storage (`key-store.ts`)
- [ ] Add SQLite schema for keys and audit log
- [ ] Create permission model (`permissions.ts`)
- [ ] Write unit tests for auth components

### Phase 3.1: Middleware (Week 2)

- [ ] HTTP auth middleware (`middleware/auth.ts`)
- [ ] WebSocket auth middleware (`websocket/auth.ts`)
- [ ] Rate limiting (`middleware/rate-limit.ts`)
- [ ] Audit logging (`middleware/audit.ts`)
- [ ] Integration tests for middleware

### Phase 3.2: CLI Integration (Week 2)

- [ ] Implement `pnpm iris key generate`
- [ ] Implement `pnpm iris key list`
- [ ] Implement `pnpm iris key revoke`
- [ ] Update configuration schema
- [ ] Update `example.config.yaml`

### Phase 3.3: Hardening (Week 3)

- [ ] Security audit
- [ ] TLS/HTTPS support (optional)
- [ ] Secret scanning prevention
- [ ] Rate limit testing under load
- [ ] Documentation

**Deliverable**: Fully functional, tested auth system ready for API endpoint integration.

---

## Success Criteria

Authentication is considered complete when:

- ✅ API keys can be generated, listed, and revoked via CLI
- ✅ Keys are stored securely (hashed) in SQLite, never in `config.yaml`
- ✅ HTTP and WebSocket authentication middleware validates keys
- ✅ Permission checks enforce granular RBAC
- ✅ Rate limiting prevents abuse
- ✅ All auth events are audited (SQLite + Wonder Logger)
- ✅ Unit and integration tests achieve >90% coverage
- ✅ Documentation is complete with usage examples

---

## Open Questions

1. **Key Rotation**: Should we support automated key rotation? (e.g., monthly)
2. **Multi-Factor Auth**: Future: TOTP for admin keys?
3. **OAuth/OIDC**: Should we support OAuth2 for third-party integrations?
4. **Key Scopes**: Should keys be scopable to specific teams? (e.g., key only works for `team-frontend`)
5. **Audit Retention**: How long should audit logs be retained? (30 days, 90 days, 1 year?)
6. **Key Migration**: How to handle migration from config-based keys (if any exist) to DB-based keys?

---

## References

- **API Implementation Plan**: [docs/API_IMPLEMENTATION_PLAN.md](./API_IMPLEMENTATION_PLAN.md) (to be updated)
- **Existing Validation**: `src/utils/validation.ts`
- **Error Hierarchy**: `src/utils/errors.ts`
- **Wonder Logger**: `src/utils/logger.ts`
- **SQLite Usage**: `src/notifications/queue.ts` (reference)

---

**Document Version:** 1.0
**Last Updated:** 2025-01-16
**Status:** Planning Phase
**Next Action:** Update API_IMPLEMENTATION_PLAN.md to reference this as Phase 3.0 prerequisite
