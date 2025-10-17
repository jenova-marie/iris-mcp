# Iris MCP API Authentication Implementation Plan

**Status:** Planning Phase
**Created:** 2025-01-16
**Updated:** 2025-01-16
**Priority:** PREREQUISITE for Phase 3 (API Server)
**Design Reference:** [API_AUTH.md](./API_AUTH.md)

---

## Executive Summary

This implementation plan translates the **hybrid three-tier authentication architecture** from [API_AUTH.md](./API_AUTH.md) into actionable development tasks. The plan covers:

1. **Phase 1 (Week 1)**: API Keys - Foundation for simple auth
2. **Phase 2 (Week 2)**: OAuth2/OIDC - Enterprise SSO integration
3. **Phase 3 (Week 3)**: SPIFFE/SPIRE - Cryptographic workload identity
4. **Phase 4 (Week 4)**: Hybrid Mode - Multi-strategy routing
5. **Phase 5 (Week 5)**: Hardening & Documentation

**Critical Dependencies**:
- **Config YAML**: Uses `config.yaml` with environment variable interpolation (`${VAR:-default}`)
- **Existing utilities**: Leverages `src/utils/validation.ts`, `src/utils/errors.ts`, `src/utils/logger.ts`
- **SQLite**: Same pattern as `src/notifications/queue.ts` (better-sqlite3, WAL mode)

---

## Phase 1: API Keys Foundation (Week 1)

### Overview

Implement simple bearer token authentication for local development and CI/CD use cases.

**Deliverables**:
- API key generation, storage, validation
- Permission model (RBAC)
- CLI commands (`pnpm iris key generate/list/revoke`)
- Unit tests (>90% coverage)

---

### Task 1.1: Core Data Structures

**File**: `src/api/auth/types.ts`

**Create type definitions**:

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

export type Role = 'viewer' | 'operator' | 'developer' | 'admin';

export interface ApiKeyMetadata {
  key: string;              // Full key (only returned once)
  hash: string;             // SHA-256 hash for storage
  name: string;             // Human-readable label
  permissions: Permission[];
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
  usageCount: number;
}

export interface AuthContext {
  authenticated: boolean;
  strategy: 'apikey' | 'oauth2' | 'spiffe';
  identity: {
    // API Key
    keyName?: string;
    keyHash?: string;
    // OAuth2
    sub?: string;
    email?: string;
    name?: string;
    // SPIFFE
    spiffeId?: string;
  };
  permissions: Permission[];
  metadata: Record<string, any>;
}
```

**Acceptance Criteria**:
- [ ] Types match [API_AUTH.md](./API_AUTH.md) spec
- [ ] Exported from `src/api/auth/types.ts`
- [ ] No compilation errors

---

### Task 1.2: API Key Generation

**File**: `src/api/auth/key-generator.ts`

**Implementation**:

```typescript
import { randomBytes, createHash } from 'crypto';
import type { ApiKeyMetadata, Permission } from './types.js';

export function generateApiKey(
  name: string,
  permissions: Permission[],
  options?: {
    environment?: 'dev' | 'prod' | 'test';
    expiresInDays?: number;
  }
): ApiKeyMetadata {
  // Generate 40-char base62-encoded random string
  const random = randomBytes(32)
    .toString('base64')
    .replace(/[+/=]/g, '')
    .substring(0, 40);

  // Construct key: iris_sk_{env}_{random}
  const env = options?.environment ? `_${options.environment}` : '';
  const key = `iris_sk${env}_${random}`;

  // Hash for storage (SHA-256)
  const hash = createHash('sha256').update(key).digest('hex');

  const createdAt = Date.now();
  const expiresAt = options?.expiresInDays
    ? createdAt + (options.expiresInDays * 24 * 60 * 60 * 1000)
    : undefined;

  return {
    key,
    hash,
    name,
    permissions,
    createdAt,
    expiresAt,
    usageCount: 0
  };
}
```

**Acceptance Criteria**:
- [ ] Key format matches `iris_sk_{env}_{random}` pattern
- [ ] Random component is 40 chars, base62-encoded
- [ ] SHA-256 hash generation works
- [ ] Optional expiration calculated correctly
- [ ] Unit tests pass (valid format, uniqueness, env inclusion)

---

### Task 1.3: SQLite Key Store

**File**: `src/api/auth/key-store.ts`

**Database location**: `$IRIS_HOME/keys.db`

**Schema**:
```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL,  -- JSON array
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  usage_count INTEGER DEFAULT 0,
  metadata TEXT  -- JSON for extensibility
);

CREATE INDEX idx_hash ON api_keys(hash);
CREATE INDEX idx_revoked ON api_keys(revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
```

**Implementation**:

```typescript
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { ApiKeyMetadata, Permission } from './types.js';
import { getChildLogger } from '../../utils/logger.js';

const logger = getChildLogger('iris:auth:keystore');

export class ApiKeyStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    logger.info({ dbPath }, 'API key store initialized');
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
      CREATE INDEX IF NOT EXISTS idx_revoked ON api_keys(revoked_at)
        WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_expires ON api_keys(expires_at)
        WHERE expires_at IS NOT NULL;
    `);
  }

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

    logger.info({ name: metadata.name, hash: metadata.hash.substring(0, 12) }, 'API key stored');
  }

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

    // Update usage stats
    this.db.prepare(`
      UPDATE api_keys
      SET last_used_at = ?, usage_count = usage_count + 1
      WHERE hash = ?
    `).run(Date.now(), hash);

    return {
      key: '',  // Never return plaintext
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

  revoke(hash: string): void {
    this.db.prepare(`
      UPDATE api_keys SET revoked_at = ? WHERE hash = ?
    `).run(Date.now(), hash);

    logger.info({ hash: hash.substring(0, 12) }, 'API key revoked');
  }

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
      expiresAt: row.expires_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
      usageCount: row.usage_count
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

**Acceptance Criteria**:
- [ ] SQLite database created at `$IRIS_HOME/keys.db`
- [ ] WAL mode enabled
- [ ] Schema matches spec
- [ ] `store()` saves hashed keys
- [ ] `validate()` checks expiration and revocation
- [ ] `validate()` updates usage stats
- [ ] `revoke()` soft-deletes keys
- [ ] `list()` returns all keys
- [ ] Unit tests cover all methods

---

### Task 1.4: Permission Model

**File**: `src/api/auth/permissions.ts`

**Implementation**:

```typescript
import type { Permission } from './types.js';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../utils/errors.js';

export const ROLES = {
  viewer: ['status:read', 'cache:read'],
  operator: ['status:read', 'cache:read', 'team:tell', 'team:wake'],
  developer: [
    'status:read',
    'cache:read',
    'team:tell',
    'team:wake',
    'team:sleep',
    'team:clear',
    'debug:read'
  ],
  admin: ['admin']
} as const;

export function hasPermission(
  userPermissions: Permission[],
  required: Permission
): boolean {
  // Admin bypass
  if (userPermissions.includes('admin')) {
    return true;
  }

  // Exact match
  if (userPermissions.includes(required)) {
    return true;
  }

  // Future: Wildcard support (team:* matches team:tell, team:wake, etc.)

  return false;
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if auth disabled (req.authContext not set)
    if (!req.authContext?.authenticated) {
      return next();
    }

    if (!hasPermission(req.authContext.permissions, permission)) {
      throw new ForbiddenError(
        `Insufficient permissions. Required: ${permission}`
      );
    }

    next();
  };
}
```

**Acceptance Criteria**:
- [ ] Role presets match [API_AUTH.md](./API_AUTH.md) spec
- [ ] `hasPermission()` supports admin bypass
- [ ] `requirePermission()` middleware works with Express
- [ ] Unit tests cover permission checks

---

### Task 1.5: CLI Commands

**File**: `src/cli/commands/key.ts`

**Implementation**:

```typescript
import { Command } from 'commander';
import { generateApiKey } from '../../api/auth/key-generator.js';
import { ApiKeyStore } from '../../api/auth/key-store.js';
import { ROLES } from '../../api/auth/permissions.js';
import { getConfigPath } from '../../utils/paths.js';
import { TeamsConfigManager } from '../../config/iris-config.js';
import chalk from 'chalk';

const keyCommand = new Command('key')
  .description('Manage API keys');

// Generate
keyCommand
  .command('generate')
  .argument('<name>', 'Human-readable key name')
  .option('-p, --permissions <perms>', 'Comma-separated permissions')
  .option('-r, --role <role>', 'Pre-defined role (viewer, operator, developer, admin)')
  .option('-e, --expires <days>', 'Expiration in days')
  .option('--env <env>', 'Environment (dev, prod, test)')
  .action(async (name, options) => {
    const configManager = new TeamsConfigManager(getConfigPath());
    const config = configManager.getConfig();

    const keyStorePath = config.api?.keyStorePath || `${process.env.IRIS_HOME}/keys.db`;
    const keyStore = new ApiKeyStore(keyStorePath);

    // Determine permissions
    let permissions;
    if (options.role) {
      if (!ROLES[options.role as keyof typeof ROLES]) {
        console.error(chalk.red(`Invalid role: ${options.role}`));
        process.exit(1);
      }
      permissions = ROLES[options.role as keyof typeof ROLES];
    } else if (options.permissions) {
      permissions = options.permissions.split(',');
    } else {
      console.error(chalk.red('Must specify either --role or --permissions'));
      process.exit(1);
    }

    const metadata = generateApiKey(name, permissions as any, {
      environment: options.env,
      expiresInDays: options.expires ? parseInt(options.expires) : undefined
    });

    keyStore.store(metadata);
    keyStore.close();

    console.log(chalk.green('\n✅ API key generated successfully!\n'));
    console.log(chalk.bold('Key: ') + chalk.cyan(metadata.key));
    console.log(chalk.yellow('\n⚠️  Save this key securely - it will not be shown again!\n'));
  });

// List
keyCommand
  .command('list')
  .option('--active', 'Show only active (non-revoked) keys')
  .action(async (options) => {
    const configManager = new TeamsConfigManager(getConfigPath());
    const config = configManager.getConfig();

    const keyStorePath = config.api?.keyStorePath || `${process.env.IRIS_HOME}/keys.db`;
    const keyStore = new ApiKeyStore(keyStorePath);

    let keys = keyStore.list();
    if (options.active) {
      keys = keys.filter(k => !k.revokedAt);
    }

    keyStore.close();

    if (keys.length === 0) {
      console.log(chalk.yellow('No API keys found'));
      return;
    }

    console.table(keys.map(k => ({
      Hash: k.hash.substring(0, 12) + '...',
      Name: k.name,
      Permissions: k.permissions.join(', '),
      Created: new Date(k.createdAt).toLocaleString(),
      Expires: k.expiresAt ? new Date(k.expiresAt).toLocaleString() : 'Never',
      Status: k.revokedAt ? chalk.red('Revoked') : chalk.green('Active'),
      'Usage Count': k.usageCount
    })));
  });

// Revoke
keyCommand
  .command('revoke')
  .argument('<hash>', 'Key hash (first 12 chars or full hash)')
  .action(async (hash) => {
    const configManager = new TeamsConfigManager(getConfigPath());
    const config = configManager.getConfig();

    const keyStorePath = config.api?.keyStorePath || `${process.env.IRIS_HOME}/keys.db`;
    const keyStore = new ApiKeyStore(keyStorePath);

    // Find key by partial hash
    const keys = keyStore.list();
    const key = keys.find(k => k.hash.startsWith(hash));

    if (!key) {
      console.error(chalk.red(`Key not found: ${hash}`));
      keyStore.close();
      process.exit(1);
    }

    keyStore.revoke(key.hash);
    keyStore.close();

    console.log(chalk.green(`✅ API key revoked: ${key.name}`));
  });

export { keyCommand };
```

**Integration**: Add to `src/cli/index.ts`:

```typescript
import { keyCommand } from './commands/key.js';

program.addCommand(keyCommand);
```

**Acceptance Criteria**:
- [ ] `pnpm iris key generate` works with --role and --permissions
- [ ] `pnpm iris key list` displays table of keys
- [ ] `pnpm iris key list --active` filters revoked keys
- [ ] `pnpm iris key revoke <hash>` works with partial hash
- [ ] Error handling for invalid inputs
- [ ] CLI help text is clear

---

### Task 1.6: Configuration Schema

**File**: `src/config/iris-config.ts`

**Update Zod schema**:

```typescript
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
  }).optional(),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().positive().default(900000),  // 15 minutes
    maxRequests: z.number().int().positive().default(100)
  }).optional()
}).optional();

// Add to TeamsConfigSchema
const TeamsConfigSchema = z.object({
  settings: GlobalSettingsSchema,
  dashboard: DashboardConfigSchema.optional(),
  database: DatabaseConfigSchema.optional(),
  api: ApiConfigSchema,  // Add this
  teams: z.record(IrisConfigSchema)
});
```

**Update `default.config.yaml`**:

```yaml
# API Server Configuration (Phase 3)
api:
  enabled: false              # Set to true to start HTTP/WebSocket API
  port: 1615
  host: 127.0.0.1            # Localhost only (use 0.0.0.0 for LAN access)
  requireAuth: true           # Require authentication (recommended)

  # Storage paths (supports ${IRIS_HOME} interpolation)
  keyStorePath: ${IRIS_HOME}/keys.db
  auditLogPath: ${IRIS_HOME}/audit.db

  # CORS configuration
  cors:
    enabled: true
    origins:
      - http://localhost:3100  # Dashboard

  # Rate limiting (per-identity)
  rateLimit:
    enabled: true
    windowMs: 900000           # 15 minutes
    maxRequests: 100           # Max requests per window
```

**Acceptance Criteria**:
- [ ] Zod schema validates config correctly
- [ ] Environment variable interpolation works (`${IRIS_HOME}`)
- [ ] Default values match [API_AUTH.md](./API_AUTH.md) spec
- [ ] Config validation tests pass

---

### Task 1.7: Unit Tests

**Files**: `tests/unit/auth/*.test.ts`

**Create test suite**:

- `key-generator.test.ts` - Key format, uniqueness, environment
- `key-store.test.ts` - Store, validate, revoke, list, expiration
- `permissions.test.ts` - Permission checks, admin bypass, roles

**Coverage target**: >90%

**Acceptance Criteria**:
- [ ] All Phase 1 code has unit tests
- [ ] Tests use in-memory SQLite (`:memory:`)
- [ ] Coverage >90% (run `pnpm test:coverage`)

---

## Phase 2: OAuth2/OIDC Integration (Week 2)

### Overview

Add enterprise SSO support via OAuth2/OIDC providers (Auth0, Okta, Keycloak, Azure AD, etc.).

**Deliverables**:
- OIDC discovery client
- JWT validation (local JWKS + introspection)
- Scope-to-permission mapping
- OAuth2 flows (authorization code + client credentials)
- Integration tests

---

### Task 2.1: OAuth2 Configuration

**File**: `src/config/iris-config.ts`

**Add OAuth2 schema**:

```typescript
const OAuth2ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().default('custom'),  // or 'auth0', 'okta', 'keycloak'

  // OIDC Discovery
  discoveryUrl: z.string().url().optional(),

  // Manual configuration (if not using discovery)
  issuer: z.string().url().optional(),
  audience: z.string().optional(),
  jwksUri: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  introspectionEndpoint: z.string().url().optional(),

  // Client credentials
  clientId: z.string(),
  clientSecret: z.string(),

  // Validation mode
  validationMode: z.enum(['jwt', 'introspection']).default('jwt'),
  jwksCacheTtl: z.number().positive().default(3600),  // 1 hour

  // Scope mapping
  scopeMapping: z.record(z.array(z.string())).default({})
}).optional();

// Update ApiConfigSchema
const ApiConfigSchema = z.object({
  // ... existing fields
  oauth2: OAuth2ConfigSchema
});
```

**Update `default.config.yaml`**:

```yaml
api:
  # ... existing fields

  # OAuth2/OIDC Configuration (optional)
  oauth2:
    enabled: false
    provider: auth0  # or okta, keycloak, custom

    # OIDC Discovery (auto-configure endpoints)
    discoveryUrl: https://example.auth0.com/.well-known/openid-configuration

    # Client credentials (use environment variables for secrets!)
    clientId: ${OAUTH2_CLIENT_ID}
    clientSecret: ${OAUTH2_CLIENT_SECRET}

    # Validation mode: jwt (local, fast) or introspection (remote, accurate)
    validationMode: jwt
    jwksCacheTtl: 3600  # Cache JWKS for 1 hour

    # Map OAuth2 scopes to Iris permissions
    scopeMapping:
      iris:teams:write:
        - team:tell
        - team:wake
        - team:sleep
      iris:teams:read:
        - status:read
      iris:cache:read:
        - cache:read
      iris:cache:write:
        - cache:write
      iris:admin:
        - admin
```

**Acceptance Criteria**:
- [ ] Schema validates OAuth2 config
- [ ] Environment variable interpolation works for secrets
- [ ] Scope mapping is configurable

---

### Task 2.2: OIDC Discovery Client

**File**: `src/api/auth/oauth2/discovery.ts`

**Dependencies**: `openid-client` or `node-fetch`

**Implementation**:

```typescript
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('iris:auth:oidc');

export interface OidcEndpoints {
  issuer: string;
  jwksUri: string;
  tokenEndpoint: string;
  introspectionEndpoint?: string;
  authorizationEndpoint: string;
}

export async function discoverOidcEndpoints(
  discoveryUrl: string
): Promise<OidcEndpoints> {
  logger.info({ discoveryUrl }, 'Fetching OIDC discovery document');

  const response = await fetch(discoveryUrl);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.statusText}`);
  }

  const metadata = await response.json();

  return {
    issuer: metadata.issuer,
    jwksUri: metadata.jwks_uri,
    tokenEndpoint: metadata.token_endpoint,
    introspectionEndpoint: metadata.introspection_endpoint,
    authorizationEndpoint: metadata.authorization_endpoint
  };
}
```

**Acceptance Criteria**:
- [ ] Fetches `.well-known/openid-configuration`
- [ ] Parses standard OIDC metadata
- [ ] Error handling for network failures
- [ ] Unit tests with mock responses

---

### Task 2.3: JWT Validator (Local JWKS)

**File**: `src/api/auth/oauth2/jwt-validator.ts`

**Dependencies**: `jose` (for JWT verification)

**Implementation**:

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { AuthContext, Permission } from '../types.js';
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('iris:auth:jwt');

export class JwtValidator {
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private config: {
      jwksUri: string;
      issuer: string;
      audience: string;
      scopeMapping: Record<string, Permission[]>;
    }
  ) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async validate(token: string): Promise<AuthContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience
      });

      // Extract scopes
      const scope = (payload.scope as string) || '';
      const scopes = scope.split(' ').filter(Boolean);

      // Map scopes to permissions
      const permissions = this.mapScopesToPermissions(scopes);

      return {
        authenticated: true,
        strategy: 'oauth2',
        identity: {
          sub: payload.sub,
          email: payload.email as string | undefined,
          name: payload.name as string | undefined
        },
        permissions,
        metadata: { scopes }
      };
    } catch (error) {
      logger.debug({ error }, 'JWT validation failed');
      return null;
    }
  }

  private mapScopesToPermissions(scopes: string[]): Permission[] {
    const permissions = new Set<Permission>();

    for (const scope of scopes) {
      const mapped = this.config.scopeMapping[scope];
      if (mapped) {
        mapped.forEach(p => permissions.add(p as Permission));
      }
    }

    return Array.from(permissions);
  }
}
```

**Acceptance Criteria**:
- [ ] Validates JWT signature with JWKS
- [ ] Verifies issuer and audience
- [ ] Maps scopes to permissions
- [ ] Caches JWKS (automatic with `jose`)
- [ ] Unit tests with mock JWKS

---

### Task 2.4: Token Introspection

**File**: `src/api/auth/oauth2/introspection.ts`

**Implementation**:

```typescript
import type { AuthContext, Permission } from '../types.js';
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('iris:auth:introspection');

export class TokenIntrospector {
  constructor(
    private config: {
      introspectionEndpoint: string;
      clientId: string;
      clientSecret: string;
      scopeMapping: Record<string, Permission[]>;
    }
  ) {}

  async introspect(token: string): Promise<AuthContext | null> {
    const response = await fetch(this.config.introspectionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        token,
        token_type_hint: 'access_token'
      })
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Introspection request failed');
      return null;
    }

    const result = await response.json();

    if (!result.active) {
      logger.debug('Token is not active');
      return null;
    }

    // Extract scopes
    const scope = result.scope || '';
    const scopes = scope.split(' ').filter(Boolean);

    // Map scopes to permissions
    const permissions = this.mapScopesToPermissions(scopes);

    return {
      authenticated: true,
      strategy: 'oauth2',
      identity: {
        sub: result.sub,
        email: result.email,
        name: result.username
      },
      permissions,
      metadata: { scopes, introspected: true }
    };
  }

  private mapScopesToPermissions(scopes: string[]): Permission[] {
    const permissions = new Set<Permission>();

    for (const scope of scopes) {
      const mapped = this.config.scopeMapping[scope];
      if (mapped) {
        mapped.forEach(p => permissions.add(p as Permission));
      }
    }

    return Array.from(permissions);
  }
}
```

**Acceptance Criteria**:
- [ ] Calls introspection endpoint with Basic Auth
- [ ] Handles active/inactive tokens
- [ ] Maps scopes to permissions
- [ ] Integration tests with mock introspection server

---

### Task 2.5: Update Auth Middleware

**File**: `src/api/middleware/auth.ts`

**Update to support multiple strategies**:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ApiKeyStore } from '../auth/key-store.js';
import { JwtValidator } from '../auth/oauth2/jwt-validator.js';
import { TokenIntrospector } from '../auth/oauth2/introspection.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { getChildLogger } from '../../utils/logger.js';

const logger = getChildLogger('iris:auth:middleware');

export function detectTokenType(token: string): 'apikey' | 'jwt' | 'spiffe' {
  if (token.startsWith('iris_sk_')) {
    return 'apikey';
  }

  if (token.split('.').length === 3) {
    return 'jwt';
  }

  if (token.startsWith('-----BEGIN CERTIFICATE-----')) {
    return 'spiffe';
  }

  throw new UnauthorizedError('Unknown token type');
}

export function createAuthMiddleware(
  keyStore: ApiKeyStore | null,
  jwtValidator: JwtValidator | null,
  introspector: TokenIntrospector | null,
  requireAuth: boolean
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip if auth not required
    if (!requireAuth) {
      req.authContext = null;
      return next();
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');

    // Detect token type
    const type = detectTokenType(token);

    // Route to appropriate validator
    let authContext;

    switch (type) {
      case 'apikey':
        if (!keyStore) {
          throw new UnauthorizedError('API key authentication disabled');
        }
        const metadata = keyStore.validate(token);
        if (!metadata) {
          throw new UnauthorizedError('Invalid or expired API key');
        }
        authContext = {
          authenticated: true,
          strategy: 'apikey' as const,
          identity: { keyName: metadata.name, keyHash: metadata.hash },
          permissions: metadata.permissions,
          metadata: { usageCount: metadata.usageCount }
        };
        break;

      case 'jwt':
        // Try JWT validation first
        if (jwtValidator) {
          authContext = await jwtValidator.validate(token);
        }

        // Fallback to introspection if configured
        if (!authContext && introspector) {
          authContext = await introspector.introspect(token);
        }

        if (!authContext) {
          throw new UnauthorizedError('Invalid JWT token');
        }
        break;

      case 'spiffe':
        // TODO: Phase 3 - SPIFFE validation
        throw new UnauthorizedError('SPIFFE authentication not yet implemented');

      default:
        throw new UnauthorizedError('Unknown token type');
    }

    // Attach to request
    req.authContext = authContext;
    next();
  };
}
```

**Acceptance Criteria**:
- [ ] Detects token type correctly
- [ ] Routes to appropriate validator
- [ ] Falls back to introspection if JWT validation fails
- [ ] Integration tests cover all paths

---

### Task 2.6: Integration Tests

**Files**: `tests/integration/auth/oauth2.test.ts`

**Test scenarios**:
- OIDC discovery
- JWT validation with mock JWKS
- Token introspection with mock endpoint
- Scope-to-permission mapping
- Middleware integration

**Acceptance Criteria**:
- [ ] All OAuth2 flows tested
- [ ] Mock OIDC provider works
- [ ] Coverage >85%

---

## Phase 3: SPIFFE/SPIRE Integration (Week 3)

### Overview

Add cryptographic workload identity for service mesh deployments.

**Deliverables**:
- SPIRE Workload API client
- X.509-SVID validation
- JWT-SVID validation
- SPIFFE ID mapping
- mTLS server support (optional)

---

### Task 3.1: SPIFFE Configuration

**File**: `src/config/iris-config.ts`

**Add SPIFFE schema**:

```typescript
const SpiffeConfigSchema = z.object({
  enabled: z.boolean().default(false),

  // SPIRE Workload API (Unix domain socket)
  workloadApiSocket: z.string().default('unix:///run/spire/sockets/agent.sock'),

  // Trust domain
  trustDomain: z.string().default('iris.example.com'),

  // SPIRE Server endpoints
  spireServerUrl: z.string().url().optional(),
  trustBundleEndpoint: z.string().default('/trust-bundle'),
  jwksEndpoint: z.string().default('/.well-known/jwks.json'),

  // Accepted audiences (for JWT-SVID)
  audiences: z.array(z.string()).default([]),

  // SPIFFE ID mapping
  idMapping: z.record(z.array(z.string())).default({}),
  idPatterns: z.array(z.object({
    pattern: z.string(),
    permissions: z.array(z.string())
  })).default([])
}).optional();

// Update ApiConfigSchema
const ApiConfigSchema = z.object({
  // ... existing fields
  spiffe: SpiffeConfigSchema
});
```

**Update `default.config.yaml`**:

```yaml
api:
  # ... existing fields

  # SPIFFE/SPIRE Configuration (optional)
  spiffe:
    enabled: false
    workloadApiSocket: unix:///run/spire/sockets/agent.sock
    trustDomain: iris.example.com

    # SPIRE Server (for trust bundle, JWKS)
    spireServerUrl: https://spire-server.example.com
    trustBundleEndpoint: /trust-bundle
    jwksEndpoint: /.well-known/jwks.json

    # Accepted audiences (for JWT-SVID)
    audiences:
      - spiffe://iris.example.com/api

    # Map SPIFFE IDs to permissions
    idMapping:
      spiffe://iris.example.com/team/frontend:
        - team:tell
        - status:read
      spiffe://iris.example.com/dashboard:
        - status:read
        - cache:read
        - team:wake
      spiffe://iris.example.com/admin:
        - admin

    # Wildcard patterns (optional)
    idPatterns:
      - pattern: spiffe://iris.example.com/team/*
        permissions:
          - team:tell
          - status:read
```

**Acceptance Criteria**:
- [ ] Schema validates SPIFFE config
- [ ] Environment variable interpolation works
- [ ] SPIFFE ID mapping is configurable

---

### Task 3.2: SPIRE Workload API Client

**File**: `src/api/auth/spiffe/workload-api.ts`

**Dependencies**: `spiffe` npm package

**Implementation**:

```typescript
import { WorkloadApi, X509Svid, JwtSvid } from 'spiffe';
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('iris:auth:spiffe');

export class SpireWorkloadApiClient {
  private client: WorkloadApi;

  constructor(socketPath: string) {
    this.client = new WorkloadApi({ socketPath });
    logger.info({ socketPath }, 'SPIRE Workload API client initialized');
  }

  async fetchX509Svid(): Promise<X509Svid> {
    const svid = await this.client.fetchX509Svid();
    logger.info({ spiffeId: svid.spiffeId }, 'Fetched X.509-SVID');
    return svid;
  }

  async fetchJwtSvid(audience: string[]): Promise<JwtSvid> {
    const svid = await this.client.fetchJwtSvid({ audience });
    logger.info({ spiffeId: svid.spiffeId }, 'Fetched JWT-SVID');
    return svid;
  }

  async fetchX509Bundle(): Promise<any> {
    return this.client.fetchX509Bundle();
  }

  watchX509Svid(callback: (svid: X509Svid) => void): void {
    this.client.watchX509Svid({
      onSvid: callback,
      onError: (error) => {
        logger.error({ error }, 'X.509-SVID watch error');
      }
    });
  }
}
```

**Acceptance Criteria**:
- [ ] Fetches X.509-SVID from SPIRE agent
- [ ] Fetches JWT-SVID with audience
- [ ] Watches for SVID updates (auto-rotation)
- [ ] Error handling for SPIRE agent connection
- [ ] Integration tests with mock SPIRE agent

---

### Task 3.3: X.509-SVID Validator

**File**: `src/api/auth/spiffe/x509-validator.ts`

**Implementation**:

```typescript
import { X509Certificate } from 'crypto';
import type { AuthContext, Permission } from '../types.js';
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('iris:auth:spiffe:x509');

export class X509SvidValidator {
  constructor(
    private config: {
      trustDomain: string;
      idMapping: Record<string, Permission[]>;
      idPatterns: Array<{ pattern: string; permissions: Permission[] }>;
    }
  ) {}

  async validate(certPem: string, trustBundle: any): Promise<AuthContext | null> {
    try {
      const cert = new X509Certificate(certPem);

      // Verify certificate chain against trust bundle
      // (Simplified - in production, use full chain verification)

      // Extract SPIFFE ID from SAN
      const spiffeId = this.extractSpiffeId(cert);
      if (!spiffeId) {
        logger.debug('No SPIFFE ID in certificate SAN');
        return null;
      }

      // Map SPIFFE ID to permissions
      const permissions = this.mapSpiffeIdToPermissions(spiffeId);

      return {
        authenticated: true,
        strategy: 'spiffe',
        identity: { spiffeId },
        permissions,
        metadata: { svid: 'x509', notAfter: cert.validTo }
      };
    } catch (error) {
      logger.debug({ error }, 'X.509-SVID validation failed');
      return null;
    }
  }

  private extractSpiffeId(cert: X509Certificate): string | null {
    // Parse SAN for URI:spiffe://...
    const san = cert.subjectAltName;
    if (!san) return null;

    const match = san.match(/URI:spiffe:\/\/[^\s,]+/);
    return match ? match[0].replace('URI:', '') : null;
  }

  private mapSpiffeIdToPermissions(spiffeId: string): Permission[] {
    // Exact match
    const exact = this.config.idMapping[spiffeId];
    if (exact) {
      return exact as Permission[];
    }

    // Pattern match
    for (const pattern of this.config.idPatterns) {
      const regex = new RegExp(pattern.pattern.replace('*', '.*'));
      if (regex.test(spiffeId)) {
        return pattern.permissions as Permission[];
      }
    }

    return [];
  }
}
```

**Acceptance Criteria**:
- [ ] Verifies X.509 certificate chain
- [ ] Extracts SPIFFE ID from SAN
- [ ] Maps SPIFFE ID to permissions (exact + patterns)
- [ ] Unit tests with mock certificates

---

### Task 3.4: JWT-SVID Validator

**File**: `src/api/auth/spiffe/jwt-validator.ts`

**Dependencies**: `jose`

**Implementation**:

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { AuthContext, Permission } from '../types.js';
import { getChildLogger } from '../../../utils/logger.js';

const logger = getChildLogger('iris:auth:spiffe:jwt');

export class JwtSvidValidator {
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private config: {
      spireServerUrl: string;
      jwksEndpoint: string;
      audiences: string[];
      idMapping: Record<string, Permission[]>;
      idPatterns: Array<{ pattern: string; permissions: Permission[] }>;
    }
  ) {
    const jwksUrl = `${config.spireServerUrl}${config.jwksEndpoint}`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async validate(token: string): Promise<AuthContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        audience: this.config.audiences
      });

      // Extract SPIFFE ID from 'sub' claim
      const spiffeId = payload.sub as string;
      if (!spiffeId?.startsWith('spiffe://')) {
        logger.debug({ sub: spiffeId }, 'Invalid SPIFFE ID in JWT');
        return null;
      }

      // Map SPIFFE ID to permissions
      const permissions = this.mapSpiffeIdToPermissions(spiffeId);

      return {
        authenticated: true,
        strategy: 'spiffe',
        identity: { spiffeId },
        permissions,
        metadata: { svid: 'jwt' }
      };
    } catch (error) {
      logger.debug({ error }, 'JWT-SVID validation failed');
      return null;
    }
  }

  private mapSpiffeIdToPermissions(spiffeId: string): Permission[] {
    // Same logic as X.509 validator
    const exact = this.config.idMapping[spiffeId];
    if (exact) {
      return exact as Permission[];
    }

    for (const pattern of this.config.idPatterns) {
      const regex = new RegExp(pattern.pattern.replace('*', '.*'));
      if (regex.test(spiffeId)) {
        return pattern.permissions as Permission[];
      }
    }

    return [];
  }
}
```

**Acceptance Criteria**:
- [ ] Validates JWT-SVID signature with SPIRE JWKS
- [ ] Verifies audience claim
- [ ] Extracts SPIFFE ID from `sub` claim
- [ ] Maps SPIFFE ID to permissions
- [ ] Unit tests with mock JWKS

---

### Task 3.5: Update Auth Middleware

**File**: `src/api/middleware/auth.ts`

**Add SPIFFE support**:

```typescript
// Add to createAuthMiddleware
case 'spiffe':
  // X.509-SVID (from mTLS certificate)
  if (x509Validator && req.socket.getPeerCertificate) {
    const cert = req.socket.getPeerCertificate();
    if (cert) {
      authContext = await x509Validator.validate(cert, trustBundle);
    }
  }

  if (!authContext) {
    throw new UnauthorizedError('SPIFFE authentication failed');
  }
  break;

// For JWT-SVID (Bearer token), check if it's a SPIFFE JWT
if (type === 'jwt' && jwtSvidValidator) {
  // Try SPIFFE JWT-SVID
  authContext = await jwtSvidValidator.validate(token);

  // Fallback to OAuth2 if not SPIFFE
  if (!authContext && jwtValidator) {
    authContext = await jwtValidator.validate(token);
  }
}
```

**Acceptance Criteria**:
- [ ] Detects X.509-SVID from mTLS
- [ ] Validates JWT-SVID tokens
- [ ] Falls back correctly between SPIFFE and OAuth2 JWTs
- [ ] Integration tests

---

## Phase 4: Hybrid Mode (Week 4)

### Overview

Enable multiple authentication strategies simultaneously with configurable priority.

**Deliverables**:
- Multi-strategy routing
- Strategy priority configuration
- Conflict resolution
- End-to-end tests

---

### Task 4.1: Strategy Priority

**File**: `src/config/iris-config.ts`

**Add to ApiConfigSchema**:

```typescript
const ApiConfigSchema = z.object({
  // ... existing fields

  // Enabled strategies
  strategies: z.array(z.enum(['apikey', 'oauth2', 'spiffe'])).default(['apikey']),

  // Strategy priority (for ambiguous tokens)
  strategyPriority: z.array(z.enum(['apikey', 'oauth2', 'spiffe']))
    .default(['spiffe', 'oauth2', 'apikey'])
});
```

**Update `default.config.yaml`**:

```yaml
api:
  # Enabled authentication strategies
  strategies:
    - apikey
    # - oauth2
    # - spiffe

  # Strategy priority (for ambiguous tokens, e.g., JWT could be OAuth2 or SPIFFE)
  strategyPriority:
    - spiffe   # Try SPIFFE first (most secure)
    - oauth2   # Then OAuth2
    - apikey   # Finally API keys
```

**Acceptance Criteria**:
- [ ] Config validates strategy list
- [ ] Priority order is configurable
- [ ] Invalid strategies rejected

---

### Task 4.2: Update Token Detection

**File**: `src/api/middleware/auth.ts`

**Improve JWT detection**:

```typescript
export function detectTokenType(
  token: string,
  enabledStrategies: string[]
): 'apikey' | 'jwt' | 'spiffe' {
  // API Key
  if (token.startsWith('iris_sk_')) {
    if (!enabledStrategies.includes('apikey')) {
      throw new UnauthorizedError('API key authentication disabled');
    }
    return 'apikey';
  }

  // X.509-SVID (PEM certificate)
  if (token.startsWith('-----BEGIN CERTIFICATE-----')) {
    if (!enabledStrategies.includes('spiffe')) {
      throw new UnauthorizedError('SPIFFE authentication disabled');
    }
    return 'spiffe';
  }

  // JWT (could be OAuth2 or SPIFFE JWT-SVID)
  if (token.split('.').length === 3) {
    // Check if any JWT-capable strategy is enabled
    const jwtStrategies = ['oauth2', 'spiffe'].filter(s =>
      enabledStrategies.includes(s)
    );

    if (jwtStrategies.length === 0) {
      throw new UnauthorizedError('JWT authentication disabled');
    }

    return 'jwt';  // Ambiguous - will try based on priority
  }

  throw new UnauthorizedError('Unknown token type');
}
```

**Acceptance Criteria**:
- [ ] Respects enabled strategies
- [ ] Throws errors for disabled strategies
- [ ] JWT detection works

---

### Task 4.3: Multi-Strategy JWT Validation

**File**: `src/api/middleware/auth.ts`

**Update JWT validation with priority**:

```typescript
case 'jwt':
  // Get enabled JWT strategies in priority order
  const jwtStrategies = config.strategyPriority.filter(s =>
    ['oauth2', 'spiffe'].includes(s) &&
    config.strategies.includes(s)
  );

  for (const strategy of jwtStrategies) {
    if (strategy === 'spiffe' && jwtSvidValidator) {
      authContext = await jwtSvidValidator.validate(token);
      if (authContext) break;
    }

    if (strategy === 'oauth2' && jwtValidator) {
      authContext = await jwtValidator.validate(token);
      if (authContext) break;
    }
  }

  // Fallback to introspection if configured
  if (!authContext && introspector) {
    authContext = await introspector.introspect(token);
  }

  if (!authContext) {
    throw new UnauthorizedError('JWT validation failed for all strategies');
  }
  break;
```

**Acceptance Criteria**:
- [ ] Tries strategies in priority order
- [ ] Stops at first successful validation
- [ ] Falls back to introspection
- [ ] Integration tests cover all paths

---

### Task 4.4: End-to-End Tests

**Files**: `tests/integration/auth/hybrid.test.ts`

**Test scenarios**:
- Multiple strategies enabled
- Strategy priority order
- JWT ambiguity resolution (OAuth2 vs SPIFFE)
- Fallback behavior
- All three strategies working together

**Acceptance Criteria**:
- [ ] All hybrid scenarios tested
- [ ] Priority order verified
- [ ] Coverage >85%

---

## Phase 5: Hardening & Documentation (Week 5)

### Overview

Security audit, rate limiting, audit logging, TLS support, and comprehensive documentation.

**Deliverables**:
- Rate limiting (per-identity)
- Audit logging (SQLite + Wonder Logger)
- TLS/HTTPS support (optional)
- Security audit checklist
- Complete documentation

---

### Task 5.1: Rate Limiting

**File**: `src/api/middleware/rate-limit.ts`

**Dependencies**: `express-rate-limit`

**Implementation**:

```typescript
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { getChildLogger } from '../../utils/logger.js';

const logger = getChildLogger('iris:auth:ratelimit');

export function createApiRateLimiter(config: {
  windowMs: number;
  maxRequests: number;
}) {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.maxRequests,

    // Key by identity (not IP)
    keyGenerator: (req: Request) => {
      if (!req.authContext?.authenticated) {
        return req.ip || 'anonymous';
      }

      const { strategy, identity } = req.authContext;

      switch (strategy) {
        case 'apikey':
          return identity.keyHash || req.ip;
        case 'oauth2':
          return identity.sub || req.ip;
        case 'spiffe':
          return identity.spiffeId || req.ip;
        default:
          return req.ip;
      }
    },

    // Custom error response
    handler: (req, res) => {
      logger.warn({
        identity: req.authContext?.identity,
        ip: req.ip,
        endpoint: req.path
      }, 'Rate limit exceeded');

      res.status(429).json({
        error: 'TooManyRequestsError',
        message: 'Rate limit exceeded. Try again later.',
        statusCode: 429,
        timestamp: Date.now(),
        retryAfter: Math.ceil(config.windowMs / 1000)
      });
    },

    standardHeaders: true,
    legacyHeaders: false
  });
}
```

**Acceptance Criteria**:
- [ ] Keys by identity (not IP)
- [ ] Returns 429 with Retry-After header
- [ ] Logs rate limit violations
- [ ] Integration tests verify limits

---

### Task 5.2: Audit Logging

**File**: `src/api/auth/audit.ts`

**Database**: `$IRIS_HOME/audit.db`

**Schema**:
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  strategy TEXT,
  identity_key TEXT,
  identity_value TEXT,
  ip_address TEXT,
  endpoint TEXT,
  method TEXT,
  status_code INTEGER,
  error_message TEXT,
  metadata TEXT
);

CREATE INDEX idx_timestamp ON audit_log(timestamp);
CREATE INDEX idx_identity ON audit_log(identity_key, identity_value);
CREATE INDEX idx_event_type ON audit_log(event_type);
```

**Implementation**:

```typescript
import Database from 'better-sqlite3';
import { getChildLogger } from '../../utils/logger.js';

const logger = getChildLogger('iris:auth:audit');

export class AuditLogger {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        strategy TEXT,
        identity_key TEXT,
        identity_value TEXT,
        ip_address TEXT,
        endpoint TEXT,
        method TEXT,
        status_code INTEGER,
        error_message TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_identity ON audit_log(identity_key, identity_value);
      CREATE INDEX IF NOT EXISTS idx_event_type ON audit_log(event_type);
    `);
  }

  log(event: {
    eventType: string;
    strategy?: string;
    identity?: { key: string; value: string };
    ip?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    errorMessage?: string;
    metadata?: Record<string, any>;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (
        timestamp, event_type, strategy, identity_key, identity_value,
        ip_address, endpoint, method, status_code, error_message, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      Date.now(),
      event.eventType,
      event.strategy ?? null,
      event.identity?.key ?? null,
      event.identity?.value ?? null,
      event.ip ?? null,
      event.endpoint ?? null,
      event.method ?? null,
      event.statusCode ?? null,
      event.errorMessage ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null
    );

    // Also log to Wonder Logger
    logger.info({
      event: event.eventType,
      ...event
    }, `Audit: ${event.eventType}`);
  }

  close(): void {
    this.db.close();
  }
}
```

**Integration in middleware**:

```typescript
// In auth middleware
auditLogger.log({
  eventType: 'auth:success',
  strategy: authContext.strategy,
  identity: getIdentityForAudit(authContext),
  ip: req.ip,
  endpoint: req.path,
  method: req.method,
  statusCode: 200
});

// On error
auditLogger.log({
  eventType: 'auth:failed',
  ip: req.ip,
  endpoint: req.path,
  method: req.method,
  statusCode: 401,
  errorMessage: error.message
});
```

**Acceptance Criteria**:
- [ ] All auth events logged (success, failure, forbidden, rate limit)
- [ ] Logs to both SQLite and Wonder Logger
- [ ] Audit log query tool (CLI or API endpoint)
- [ ] Retention policy configurable

---

### Task 5.3: TLS/HTTPS Support (Optional)

**File**: `src/api_server.ts`

**Add HTTPS server option**:

```typescript
import https from 'https';
import fs from 'fs';

if (config.api.tls?.enabled) {
  const httpsServer = https.createServer({
    key: fs.readFileSync(config.api.tls.key),
    cert: fs.readFileSync(config.api.tls.cert),
    ca: config.api.tls.ca ? fs.readFileSync(config.api.tls.ca) : undefined,
    requestCert: config.api.tls.requireClientCert ?? false,
    rejectUnauthorized: config.api.tls.rejectUnauthorized ?? true
  }, app);

  httpsServer.listen(config.api.port, config.api.host);
} else {
  httpServer.listen(config.api.port, config.api.host);
}
```

**Configuration**:

```yaml
api:
  tls:
    enabled: true
    cert: /path/to/cert.pem
    key: /path/to/key.pem
    ca: /path/to/ca.pem  # Optional for mutual TLS
    requireClientCert: false
    rejectUnauthorized: true
```

**Acceptance Criteria**:
- [ ] HTTPS server starts with TLS config
- [ ] Certificate validation works
- [ ] Mutual TLS (mTLS) optional
- [ ] Documentation for certificate setup

---

### Task 5.4: Security Audit

**Checklist**:

- [ ] **Secret Management**
  - [ ] API keys hashed (SHA-256) in database
  - [ ] OAuth2 client secrets via environment variables
  - [ ] No secrets in `config.yaml`
  - [ ] `.gitignore` includes `keys.db`, `audit.db`, `*.pem`

- [ ] **Input Validation**
  - [ ] All inputs validated (reuse `src/utils/validation.ts`)
  - [ ] Rate limiting on all endpoints
  - [ ] SQL injection prevented (parameterized queries)

- [ ] **Authentication**
  - [ ] Token validation for all strategies
  - [ ] Expiration checks enforced
  - [ ] Revoked keys rejected immediately

- [ ] **Authorization**
  - [ ] Permission checks on every route
  - [ ] Admin bypass only for `admin` permission
  - [ ] No privilege escalation bugs

- [ ] **Audit Logging**
  - [ ] All auth events logged
  - [ ] Failed attempts logged
  - [ ] Retention policy configured

- [ ] **Network Security**
  - [ ] Default host is `127.0.0.1` (localhost only)
  - [ ] CORS restricted to known origins
  - [ ] Helmet middleware enabled
  - [ ] TLS recommended for production

- [ ] **Error Handling**
  - [ ] No stack traces in API responses
  - [ ] Generic error messages (no info leakage)
  - [ ] Errors logged with full details

**Acceptance Criteria**:
- [ ] All checklist items pass
- [ ] Security review completed
- [ ] Vulnerabilities documented and fixed

---

### Task 5.5: Documentation

**Files to create/update**:

1. **API_AUTH.md** - ✅ Already created (design doc)
2. **API_AUTH_IMPLEMENTATION_PLAN.md** - ✅ This document
3. **API_AUTH_USAGE.md** - User guide for API authentication

**API_AUTH_USAGE.md outline**:

```markdown
# Iris MCP API Authentication Usage Guide

## Quick Start

### Local Development (API Keys)
1. Generate an API key
2. Use key in Authorization header
3. Test with curl

### Enterprise SSO (OAuth2/OIDC)
1. Configure IdP
2. Set up OIDC discovery
3. Obtain access token
4. Use token in Authorization header

### Service Mesh (SPIFFE/SPIRE)
1. Install SPIRE
2. Register workloads
3. Configure Iris with SPIRE
4. Use SVIDs for authentication

## Configuration Examples

## Troubleshooting

## Security Best Practices
```

**Update existing docs**:
- [x] **API_IMPLEMENTATION_PLAN.md** - Reference auth as prerequisite
- [ ] **README.md** - Add auth overview
- [ ] **ARCHITECTURE.md** - Document auth architecture
- [ ] **CLAUDE.md** - Mention auth in Phase 3

**Acceptance Criteria**:
- [ ] API_AUTH_USAGE.md complete
- [ ] All docs reference auth correctly
- [ ] Examples for all three strategies
- [ ] Troubleshooting guide

---

## Dependencies

### npm Packages

**Required**:
```yaml
dependencies:
  better-sqlite3: ^11.8.1
  express-rate-limit: ^7.1.5
  jose: ^5.2.0
devDependencies:
  '@types/better-sqlite3': ^7.6.12
```

**Optional** (for OAuth2/SPIFFE):
```yaml
dependencies:
  openid-client: ^5.6.5  # Optional: easier OIDC
  spiffe: ^0.5.0         # Optional: SPIFFE SDK
```

---

## Testing Strategy

### Unit Tests (>90% coverage)

**Files**: `tests/unit/auth/*.test.ts`

- `key-generator.test.ts`
- `key-store.test.ts`
- `permissions.test.ts`
- `oauth2/jwt-validator.test.ts`
- `oauth2/introspection.test.ts`
- `spiffe/x509-validator.test.ts`
- `spiffe/jwt-validator.test.ts`
- `middleware/auth.test.ts`
- `middleware/rate-limit.test.ts`

### Integration Tests (>85% coverage)

**Files**: `tests/integration/auth/*.test.ts`

- `apikey.test.ts` - API key end-to-end
- `oauth2.test.ts` - OAuth2 flows end-to-end
- `spiffe.test.ts` - SPIFFE validation end-to-end
- `hybrid.test.ts` - Multi-strategy scenarios
- `rate-limit.test.ts` - Rate limiting under load
- `audit.test.ts` - Audit logging verification

### Manual Testing

**Checklist**:
- [ ] API key generation via CLI
- [ ] OAuth2 authorization code flow (browser)
- [ ] OAuth2 client credentials flow (curl)
- [ ] SPIFFE X.509-SVID (mTLS)
- [ ] SPIFFE JWT-SVID (Bearer token)
- [ ] Rate limiting behavior
- [ ] Audit log entries

---

## Success Criteria

Authentication implementation is considered complete when:

- ✅ **Phase 1 (API Keys)** complete and tested
- ✅ **Phase 2 (OAuth2/OIDC)** complete and tested
- ✅ **Phase 3 (SPIFFE/SPIRE)** complete and tested
- ✅ **Phase 4 (Hybrid Mode)** complete and tested
- ✅ **Phase 5 (Hardening)** complete and tested
- ✅ All three strategies work independently
- ✅ Hybrid mode works with multiple strategies
- ✅ Rate limiting prevents abuse
- ✅ Audit logging captures all events
- ✅ Unit test coverage >90%
- ✅ Integration test coverage >85%
- ✅ Security audit passes all checks
- ✅ Documentation is complete and accurate
- ✅ CLI tools work correctly
- ✅ Configuration is intuitive

---

## Timeline Summary

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1: API Keys** | Week 1 | Key generation, storage, validation, CLI, permissions |
| **Phase 2: OAuth2/OIDC** | Week 2 | OIDC discovery, JWT validation, introspection, scope mapping |
| **Phase 3: SPIFFE/SPIRE** | Week 3 | Workload API client, X.509/JWT-SVID validation, SPIFFE ID mapping |
| **Phase 4: Hybrid Mode** | Week 4 | Multi-strategy routing, priority configuration, conflict resolution |
| **Phase 5: Hardening** | Week 5 | Rate limiting, audit logging, TLS, security audit, documentation |

**Total**: 5 weeks for complete three-tier hybrid authentication

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Prioritize phases** (can implement Phase 1 alone if OAuth2/SPIFFE not needed immediately)
3. **Set up development environment** (OIDC provider, SPIRE server for testing)
4. **Begin Phase 1** implementation
5. **Iterate** based on feedback and testing

---

**Document Version:** 1.0
**Last Updated:** 2025-01-16
**Status:** Planning Phase
**Design Reference:** [API_AUTH.md](./API_AUTH.md)
**Next Action:** Begin Phase 1 implementation (API Keys Foundation)
