# Iris MCP API Authentication Architecture

**Version:** 1.0
**Status:** Design Phase
**Created:** 2025-01-16
**Purpose:** Foundational authentication design for Iris MCP HTTP/WebSocket API

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Authentication Strategies](#authentication-strategies)
3. [Architecture Overview](#architecture-overview)
4. [Strategy 1: API Keys](#strategy-1-api-keys)
5. [Strategy 2: OAuth2/OIDC](#strategy-2-oauth2oidc)
6. [Strategy 3: SPIFFE/SPIRE](#strategy-3-spiffespire)
7. [Hybrid Mode](#hybrid-mode)
8. [Permission Model](#permission-model)
9. [Token Validation Flow](#token-validation-flow)
10. [Configuration](#configuration)
11. [Security Considerations](#security-considerations)
12. [Implementation Roadmap](#implementation-roadmap)
13. [References](#references)

---

## Philosophy

Iris MCP is designed for **flexibility across deployment contexts**:

- **Local development**: Simple API keys, minimal setup
- **Enterprise SSO**: OAuth2/OIDC integration with existing identity providers
- **Service mesh**: SPIFFE/SPIRE for cryptographic workload identity
- **Hybrid environments**: Mix and match strategies as needed

### Core Principles

1. **No forced complexity** - Simple deployments stay simple
2. **Provider agnostic** - Works with any OAuth2/OIDC provider (Auth0, Okta, Keycloak, Azure AD, Google)
3. **Zero-trust ready** - SPIFFE/SPIRE for service-to-service auth without secrets
4. **Configurable by default** - All auth strategies disabled by default, opt-in via `config.json`
5. **Separation of concerns** - MCP tool approval ≠ API authentication

### Authentication vs Authorization

```
┌────────────────────────────────────────────────────────┐
│ Authentication: "Who are you?"                         │
│ • API Key: You possess a secret                       │
│ • OAuth2: Identity provider vouches for you           │
│ • SPIFFE: Cryptographic proof of workload identity    │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Authorization: "What can you do?"                      │
│ • Permissions: team:tell, cache:read, admin, etc.     │
│ • Scopes (OAuth2): iris:teams:write, iris:cache:read  │
│ • SPIFFE ID matching: spiffe://iris/team/frontend     │
└────────────────────────────────────────────────────────┘
```

---

## Authentication Strategies

Iris MCP supports **three authentication strategies**, independently configurable:

| Strategy | Use Case | Complexity | Secret Management | Best For |
|----------|----------|------------|-------------------|----------|
| **API Keys** | Self-hosted, dev, simple integrations | Low | Manual (CLI or SQLite) | Local dev, personal deployments |
| **OAuth2/OIDC** | Enterprise SSO, web dashboards | Medium | Delegated to IdP | Human users, existing SSO |
| **SPIFFE/SPIRE** | Service mesh, zero-trust networking | High | Automatic (SPIRE agent) | Production, multi-service |

### Strategy Selection Matrix

```
┌─────────────────────────────────────────────────────────────┐
│ Deployment Context        → Recommended Strategy            │
├─────────────────────────────────────────────────────────────┤
│ Local development         → API Keys                        │
│ Personal VPS/homelab      → API Keys                        │
│ Team deployment (< 10)    → API Keys or OAuth2              │
│ Enterprise (SSO required) → OAuth2/OIDC                     │
│ Kubernetes/service mesh   → SPIFFE/SPIRE                    │
│ Hybrid (teams + services) → Hybrid (all strategies enabled) │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

### Request Flow

```
┌──────────────────────────────────────────────────────────────┐
│ Client Request                                               │
│ Authorization: Bearer {token}                                │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Auth Middleware (src/api/middleware/auth.ts)                 │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 1. Extract Bearer token from Authorization header        │ │
│ │ 2. Detect token type (API key, JWT, X.509-SVID)         │ │
│ │ 3. Route to appropriate validator                        │ │
│ └──────────────────────────────────────────────────────────┘ │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌──────────────────┐
│ API Key         │ │ OAuth2/OIDC │ │ SPIFFE/SPIRE     │
│ Validator       │ │ JWT         │ │ X.509-SVID       │
│                 │ │ Validator   │ │ Validator        │
│ (SQLite store)  │ │ (JWKS/      │ │ (SPIRE Workload  │
│                 │ │  introspect)│ │  API)            │
└────────┬────────┘ └──────┬──────┘ └────────┬─────────┘
         │                 │                  │
         └─────────────────┼──────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Permission Mapper (src/api/auth/permissions.ts)              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ • API Key: permissions from key metadata                 │ │
│ │ • OAuth2: map scopes → permissions                       │ │
│ │ • SPIFFE: map SPIFFE ID → permissions                    │ │
│ └──────────────────────────────────────────────────────────┘ │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Request Context (attached to req)                            │
│ {                                                            │
│   authenticated: true,                                       │
│   strategy: 'oauth2' | 'apikey' | 'spiffe',                 │
│   identity: { sub: '...', email: '...', spiffeId: '...' },  │
│   permissions: ['team:tell', 'cache:read', ...],            │
│   metadata: { ... }                                          │
│ }                                                            │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Route Handler (with permission checks)                       │
│ requirePermission('team:tell')                               │
└──────────────────────────────────────────────────────────────┘
```

### Token Type Detection

**How Iris distinguishes between token types**:

```typescript
function detectTokenType(token: string): 'apikey' | 'jwt' | 'spiffe' {
  // API Key: iris_sk_{random} format
  if (token.startsWith('iris_sk_')) {
    return 'apikey';
  }

  // JWT: Three base64-encoded parts separated by dots
  if (token.split('.').length === 3) {
    return 'jwt';
  }

  // SPIFFE X.509-SVID: PEM-encoded certificate
  if (token.startsWith('-----BEGIN CERTIFICATE-----')) {
    return 'spiffe';
  }

  throw new UnauthorizedError('Unknown token type');
}
```

---

## Strategy 1: API Keys

### Overview

**Simple bearer tokens** for straightforward authentication. Ideal for:
- Local development
- Personal deployments
- CI/CD pipelines
- Simple API clients

### Key Format

```
iris_sk_{environment}_{random}

Examples:
iris_sk_abc123def456ghi789jkl012mno345pqr678stu
iris_sk_dev_xyz789abc012def345ghi678jkl901mno234
iris_sk_prod_abc123def456ghi789jkl012mno345pqr678
```

**Components**:
- `iris_` - Fixed prefix (identifies Iris API keys)
- `sk` - "Secret Key" (distinguishes from future public keys)
- `{environment}` - Optional: `dev`, `prod`, `test` (omitted for default)
- `{random}` - 40 characters of cryptographically random base62

**Length**: 50-55 characters total

### Storage

**SQLite database** (`$IRIS_HOME/keys.db`), **never in `config.json`**.

**Schema**:
```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,           -- SHA-256 of actual key
  name TEXT NOT NULL,                  -- Human-readable label
  permissions TEXT NOT NULL,            -- JSON array ['team:tell', ...]
  created_at INTEGER NOT NULL,
  expires_at INTEGER,                   -- Optional expiration
  revoked_at INTEGER,                   -- Revocation timestamp
  last_used_at INTEGER,
  usage_count INTEGER DEFAULT 0,
  metadata TEXT                         -- JSON for extensibility
);
```

**Key Properties**:
- **Hashed storage**: Only SHA-256 hash stored, never plaintext
- **Single-use visibility**: Key shown once during generation, never again
- **Revocable**: Soft delete via `revoked_at` timestamp
- **Expirable**: Optional `expires_at` for time-limited keys
- **Auditable**: Track `last_used_at` and `usage_count`

### CLI Management

```bash
# Generate new key
pnpm iris key generate "Dashboard Client" --permissions team:tell,team:wake,status:read
pnpm iris key generate "Admin" --role admin --expires 90

# List keys
pnpm iris key list
pnpm iris key list --active

# Revoke key
pnpm iris key revoke abc123def456  # First 12 chars of hash

# Rotate key (generate new, revoke old)
pnpm iris key rotate abc123def456 --name "Dashboard Client (rotated)"
```

### Validation Flow

```typescript
// Pseudo-code
async function validateApiKey(key: string): Promise<AuthContext | null> {
  const hash = sha256(key);

  const row = db.prepare(`
    SELECT * FROM api_keys
    WHERE hash = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `).get(hash, Date.now());

  if (!row) return null;

  // Update usage stats
  db.prepare(`
    UPDATE api_keys
    SET last_used_at = ?, usage_count = usage_count + 1
    WHERE hash = ?
  `).run(Date.now(), hash);

  return {
    authenticated: true,
    strategy: 'apikey',
    identity: { keyName: row.name, keyHash: hash },
    permissions: JSON.parse(row.permissions),
    metadata: { usageCount: row.usage_count + 1 }
  };
}
```

### Security

- ✅ Hashed storage (SHA-256)
- ✅ Single-use visibility
- ✅ Per-key rate limiting
- ✅ Expiration support
- ✅ Audit logging
- ❌ No automatic rotation
- ❌ Manual secret distribution

---

## Strategy 2: OAuth2/OIDC

### Overview

**Delegated authentication** via external identity providers. Ideal for:
- Enterprise SSO integration
- Web dashboard login
- Human user authentication
- Multi-tenant deployments

### Supported Providers

**Provider-agnostic design**. Works with any OAuth2/OIDC-compliant provider:

- **SaaS**: Auth0, Okta, Azure AD (Entra ID), Google Workspace, OneLogin
- **Self-hosted**: Keycloak, ORY Hydra, Authelia, Authentik
- **Cloud-native**: Supabase Auth, Firebase Auth, AWS Cognito

**Requirements**:
- OIDC Discovery (`.well-known/openid-configuration`)
- JWT signing with RS256/ES256 (not HS256)
- Standard claims: `sub`, `iss`, `aud`, `exp`, `iat`

### OAuth2 Flows

**Iris supports two flows**:

#### 1. Authorization Code Flow + PKCE (Web Dashboard)

**Use case**: Interactive web applications (dashboard UI)

```
┌────────────┐                                  ┌──────────────┐
│  Browser   │                                  │ OAuth2 IdP   │
│ (Dashboard)│                                  │ (Auth0/etc)  │
└─────┬──────┘                                  └──────┬───────┘
      │                                                 │
      │ 1. GET /login → Redirect to IdP                │
      ├────────────────────────────────────────────────▶
      │                                                 │
      │ 2. User authenticates at IdP                   │
      │◀────────────────────────────────────────────────┤
      │                                                 │
      │ 3. Redirect back with auth code                │
      ◀─────────────────────────────────────────────────┤
      │                                                 │
      │ 4. POST /callback (code + PKCE verifier)       │
      ├────────────────────────────────────────────────▶
      │                                                 │
      │ 5. Exchange code for tokens (id_token, access_token)
      ◀─────────────────────────────────────────────────┤
      │                                                 │
      │ 6. Store tokens in browser (httpOnly cookie)   │
      │                                                 │
      │ 7. API requests include access_token in header │
      │    Authorization: Bearer {access_token}        │
```

#### 2. Client Credentials Flow (Machine-to-Machine)

**Use case**: Non-interactive clients (CI/CD, scripts, backend services)

```
┌────────────┐                                  ┌──────────────┐
│ API Client │                                  │ OAuth2 IdP   │
│ (CI/CD)    │                                  │ (Auth0/etc)  │
└─────┬──────┘                                  └──────┬───────┘
      │                                                 │
      │ 1. POST /oauth/token                           │
      │    (client_id, client_secret, scope)           │
      ├────────────────────────────────────────────────▶
      │                                                 │
      │ 2. Return access_token (JWT)                   │
      ◀─────────────────────────────────────────────────┤
      │                                                 │
      │ 3. API requests include access_token           │
      │    Authorization: Bearer {access_token}        │
```

### JWT Validation

**Two validation modes**:

#### Mode 1: Local JWT Validation (Recommended)

**Validates JWT signature locally** using public keys from JWKS endpoint.

**Pros**:
- ✅ Fast (no network call per request)
- ✅ Works offline (cached public keys)
- ✅ Scalable (no IdP load)

**Cons**:
- ❌ Delayed revocation (until JWT expires)
- ❌ Must refresh JWKS periodically

**Flow**:
```typescript
// Pseudo-code
async function validateJwt(token: string): Promise<AuthContext | null> {
  // 1. Fetch JWKS from IdP (cached, refreshed hourly)
  const jwks = await getJwks(config.oauth2.jwksUri);

  // 2. Verify JWT signature with public key
  const decoded = await jose.jwtVerify(token, jwks, {
    issuer: config.oauth2.issuer,
    audience: config.oauth2.audience
  });

  // 3. Extract claims
  const { sub, email, scope } = decoded.payload;

  // 4. Map scopes to permissions
  const scopes = scope.split(' ');
  const permissions = mapScopesToPermissions(scopes);

  return {
    authenticated: true,
    strategy: 'oauth2',
    identity: { sub, email },
    permissions,
    metadata: { scopes }
  };
}
```

#### Mode 2: Token Introspection

**Calls IdP to validate token** on every request.

**Pros**:
- ✅ Real-time revocation
- ✅ Accurate token status

**Cons**:
- ❌ Slow (network call per request)
- ❌ IdP dependency (failure = downtime)
- ❌ IdP load (not scalable)

**Flow**:
```typescript
async function introspectToken(token: string): Promise<AuthContext | null> {
  const response = await fetch(config.oauth2.introspectionEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      client_id: config.oauth2.clientId,
      client_secret: config.oauth2.clientSecret
    })
  });

  const { active, sub, scope } = await response.json();
  if (!active) return null;

  return {
    authenticated: true,
    strategy: 'oauth2',
    identity: { sub },
    permissions: mapScopesToPermissions(scope.split(' ')),
    metadata: { introspected: true }
  };
}
```

**Default**: Use **local JWT validation** for performance, with configurable fallback to introspection.

### Scope-to-Permission Mapping

**OAuth2 scopes are mapped to Iris permissions** via configuration:

```json
{
  "oauth2": {
    "scopeMapping": {
      "iris:teams:write": ["team:tell", "team:wake", "team:sleep"],
      "iris:teams:read": ["status:read"],
      "iris:cache:read": ["cache:read"],
      "iris:cache:write": ["cache:write"],
      "iris:admin": ["admin"]
    }
  }
}
```

**Custom claims** (optional):
```json
// JWT payload with custom claim
{
  "sub": "user123",
  "email": "alice@example.com",
  "scope": "iris:teams:write iris:cache:read",
  "iris_permissions": ["team:tell", "team:wake", "cache:read"]  // Direct mapping
}
```

### Configuration

```json
{
  "api": {
    "auth": {
      "oauth2": {
        "enabled": true,
        "provider": "auth0",  // or "okta", "keycloak", "custom"

        // OIDC Discovery (auto-populate endpoints)
        "discoveryUrl": "https://example.auth0.com/.well-known/openid-configuration",

        // Or manual configuration
        "issuer": "https://example.auth0.com/",
        "audience": "https://iris-api.example.com",
        "jwksUri": "https://example.auth0.com/.well-known/jwks.json",
        "tokenEndpoint": "https://example.auth0.com/oauth/token",
        "introspectionEndpoint": "https://example.auth0.com/oauth/introspect",

        // Client credentials (for client credentials flow)
        "clientId": "abc123...",
        "clientSecret": "${OAUTH2_CLIENT_SECRET}",  // From env var

        // Validation mode
        "validationMode": "jwt",  // or "introspection"
        "jwksCacheTtl": 3600,     // Cache JWKS for 1 hour

        // Scope mapping
        "scopeMapping": { /* ... */ }
      }
    }
  }
}
```

### Security

- ✅ No secret management (delegated to IdP)
- ✅ Automatic token rotation (IdP handles refresh tokens)
- ✅ Real-time revocation (with introspection mode)
- ✅ Centralized user management
- ✅ MFA support (if IdP supports it)
- ❌ Requires external IdP (dependency)
- ❌ More complex setup

---

## Strategy 3: SPIFFE/SPIRE

### Overview

**Cryptographic workload identity** for zero-trust service-to-service authentication. Ideal for:
- Kubernetes/service mesh deployments
- Multi-service architectures
- Production zero-trust environments
- Automated secret rotation

### What is SPIFFE/SPIRE?

**SPIFFE** (Secure Production Identity Framework For Everyone):
- Standard for **workload identity** (not user identity)
- Issues **SVIDs** (SPIFFE Verifiable Identity Documents)
- Format: `spiffe://{trust_domain}/{workload_path}`

**SPIRE** (SPIFFE Runtime Environment):
- Reference implementation of SPIFFE
- Components: SPIRE Server (CA) + SPIRE Agent (per node)
- Automatic SVID generation and rotation

### SVID Types

#### 1. X.509-SVID (mTLS)

**Mutual TLS authentication** with short-lived certificates.

**Format**: X.509 certificate with SPIFFE ID in Subject Alternative Name (SAN)

**Example**:
```
Subject Alternative Name:
  URI: spiffe://iris.example.com/team/frontend
```

**Usage**:
```bash
# Client request with X.509-SVID (mTLS)
curl --cert /path/to/svid.pem --key /path/to/key.pem \
     --cacert /path/to/bundle.pem \
     https://iris-api.example.com/api/teams/tell
```

#### 2. JWT-SVID

**JWT with SPIFFE ID in `sub` claim**.

**Format**:
```json
{
  "sub": "spiffe://iris.example.com/team/frontend",
  "aud": ["spiffe://iris.example.com/api"],
  "exp": 1738456789,
  "iat": 1738453189
}
```

**Usage**:
```bash
# Client request with JWT-SVID
curl -H "Authorization: Bearer {jwt_svid}" \
     https://iris-api.example.com/api/teams/tell
```

### SPIRE Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ SPIRE Server (Certificate Authority)                        │
│ • Issues SVIDs to registered workloads                      │
│ • Manages trust bundle (CA certificates)                    │
│ • Workload attestation via plugins                          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ (gRPC API)
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ SPIRE Agent   │ │ SPIRE Agent   │ │ SPIRE Agent   │
│ (Node 1)      │ │ (Node 2)      │ │ (Node 3)      │
│               │ │               │ │               │
│ Workloads:    │ │ Workloads:    │ │ Workloads:    │
│ • team-iris   │ │ • team-alpha  │ │ • dashboard   │
│ • api-server  │ │ • team-beta   │ │               │
└───────────────┘ └───────────────┘ └───────────────┘
```

**SPIRE Agent** responsibilities:
- Attest workload identity (via k8s, docker, unix socket, etc.)
- Fetch SVIDs from SPIRE Server
- Provide SVIDs to workloads via Workload API (Unix domain socket)
- Auto-rotate SVIDs before expiration

### Workload Registration

**Example registration entries** (via `spire-server entry create`):

```bash
# Iris API Server
spire-server entry create \
  -spiffeID spiffe://iris.example.com/api \
  -parentID spiffe://iris.example.com/node/server1 \
  -selector k8s:ns:iris \
  -selector k8s:sa:iris-api

# Team Frontend
spire-server entry create \
  -spiffeID spiffe://iris.example.com/team/frontend \
  -parentID spiffe://iris.example.com/node/server2 \
  -selector k8s:ns:iris \
  -selector k8s:pod-label:team:frontend

# Dashboard
spire-server entry create \
  -spiffeID spiffe://iris.example.com/dashboard \
  -parentID spiffe://iris.example.com/node/server3 \
  -selector docker:label:app:iris-dashboard
```

### SVID Validation Flow

#### X.509-SVID (mTLS)

```typescript
// Pseudo-code
async function validateX509Svid(cert: X509Certificate): Promise<AuthContext | null> {
  // 1. Verify certificate chain against SPIRE trust bundle
  const trustBundle = await fetchSpireTrustBundle();
  if (!verifyCertChain(cert, trustBundle)) {
    return null;
  }

  // 2. Extract SPIFFE ID from SAN
  const spiffeId = extractSpiffeId(cert);
  if (!spiffeId) {
    return null;
  }

  // 3. Map SPIFFE ID to permissions
  const permissions = mapSpiffeIdToPermissions(spiffeId);

  return {
    authenticated: true,
    strategy: 'spiffe',
    identity: { spiffeId },
    permissions,
    metadata: { svid: 'x509', notAfter: cert.notAfter }
  };
}
```

#### JWT-SVID

```typescript
async function validateJwtSvid(token: string): Promise<AuthContext | null> {
  // 1. Fetch SPIRE JWKS bundle
  const jwks = await fetchSpireJwks();

  // 2. Verify JWT signature
  const decoded = await jose.jwtVerify(token, jwks, {
    audience: 'spiffe://iris.example.com/api'
  });

  // 3. Extract SPIFFE ID from 'sub' claim
  const spiffeId = decoded.payload.sub;

  // 4. Map SPIFFE ID to permissions
  const permissions = mapSpiffeIdToPermissions(spiffeId);

  return {
    authenticated: true,
    strategy: 'spiffe',
    identity: { spiffeId },
    permissions,
    metadata: { svid: 'jwt' }
  };
}
```

### SPIFFE ID to Permission Mapping

**Map SPIFFE IDs to Iris permissions** via configuration:

```json
{
  "spiffe": {
    "idMapping": {
      "spiffe://iris.example.com/team/frontend": ["team:tell", "status:read"],
      "spiffe://iris.example.com/team/backend": ["team:tell", "cache:read"],
      "spiffe://iris.example.com/dashboard": ["status:read", "cache:read", "team:wake"],
      "spiffe://iris.example.com/admin": ["admin"]
    },

    // Wildcard patterns (optional)
    "idPatterns": [
      {
        "pattern": "spiffe://iris.example.com/team/*",
        "permissions": ["team:tell", "status:read"]
      },
      {
        "pattern": "spiffe://iris.example.com/admin/*",
        "permissions": ["admin"]
      }
    ]
  }
}
```

### Configuration

```json
{
  "api": {
    "auth": {
      "spiffe": {
        "enabled": true,

        // SPIRE Workload API (Unix domain socket)
        "workloadApiSocket": "unix:///run/spire/sockets/agent.sock",

        // Trust domain
        "trustDomain": "iris.example.com",

        // SPIRE Server endpoints (for trust bundle, JWKS)
        "spireServerUrl": "https://spire-server.example.com",
        "trustBundleEndpoint": "/trust-bundle",
        "jwksEndpoint": "/.well-known/jwks.json",

        // Accepted audiences (for JWT-SVID)
        "audiences": ["spiffe://iris.example.com/api"],

        // SPIFFE ID mapping
        "idMapping": { /* ... */ },
        "idPatterns": [ /* ... */ ]
      }
    }
  }
}
```

### Iris as a SPIFFE Workload

**Iris API server itself gets a SPIFFE identity**:

```typescript
// src/api_server.ts
import { SpiffeWorkloadApi } from 'spiffe';

// Fetch Iris API's own SVID from SPIRE agent
const workloadApi = new SpiffeWorkloadApi();
const svid = await workloadApi.fetchX509Svid();

// Use SVID for mTLS server configuration
const httpsServer = https.createServer({
  key: svid.privateKey,
  cert: svid.certificate,
  ca: svid.trustBundle,
  requestCert: true,  // Require client certificates (mTLS)
  rejectUnauthorized: true
}, app);

// Auto-rotate SVID before expiration
workloadApi.watchX509Svid((updatedSvid) => {
  httpsServer.setSecureContext({
    key: updatedSvid.privateKey,
    cert: updatedSvid.certificate,
    ca: updatedSvid.trustBundle
  });
});
```

### Security

- ✅ **Zero secret distribution** (SPIRE agent provides SVIDs)
- ✅ **Automatic rotation** (SPIRE handles renewal)
- ✅ **Cryptographic identity** (X.509 certificates, not bearer tokens)
- ✅ **Workload attestation** (proves identity via platform plugins)
- ✅ **mTLS by default** (mutual authentication)
- ✅ **Federation** (cross-cluster trust)
- ❌ **Operational complexity** (requires SPIRE infrastructure)
- ❌ **Not for human users** (designed for workloads)

---

## Hybrid Mode

### Overview

**Enable multiple authentication strategies simultaneously**. Clients choose which method to use.

**Use case**: Organizations with mixed requirements:
- Developers use API keys for local testing
- Dashboard uses OAuth2 for web login
- Production services use SPIFFE for service mesh

### Configuration

```json
{
  "api": {
    "auth": {
      "strategies": ["apikey", "oauth2", "spiffe"],  // All enabled

      "apikey": { /* ... */ },
      "oauth2": { /* ... */ },
      "spiffe": { /* ... */ }
    }
  }
}
```

### Request Routing

**Middleware detects token type and routes to appropriate validator**:

```typescript
async function authenticate(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing Authorization header');
  }

  const token = authHeader.replace('Bearer ', '');

  // Detect token type
  const type = detectTokenType(token);

  // Route to validator
  switch (type) {
    case 'apikey':
      if (!config.auth.strategies.includes('apikey')) {
        throw new UnauthorizedError('API key auth disabled');
      }
      return await validateApiKey(token);

    case 'jwt':
      // Could be OAuth2 JWT or SPIFFE JWT-SVID
      // Try OAuth2 first, fallback to SPIFFE
      if (config.auth.strategies.includes('oauth2')) {
        try {
          return await validateOAuth2Jwt(token);
        } catch (err) {
          // Fallback to SPIFFE JWT-SVID
        }
      }
      if (config.auth.strategies.includes('spiffe')) {
        return await validateJwtSvid(token);
      }
      throw new UnauthorizedError('JWT validation failed');

    case 'spiffe':
      if (!config.auth.strategies.includes('spiffe')) {
        throw new UnauthorizedError('SPIFFE auth disabled');
      }
      return await validateX509Svid(token);

    default:
      throw new UnauthorizedError('Unknown token type');
  }
}
```

### Strategy Priority

**If a token could match multiple strategies** (e.g., JWT could be OAuth2 or SPIFFE):

**Priority order** (configurable):
1. SPIFFE (most secure, cryptographic)
2. OAuth2 (enterprise standard)
3. API Key (fallback)

```json
{
  "auth": {
    "strategyPriority": ["spiffe", "oauth2", "apikey"]
  }
}
```

---

## Permission Model

### Permission Types

**Granular, action-based permissions**:

| Permission | Description | Example Use Case |
|------------|-------------|------------------|
| `team:tell` | Send messages to teams | Dashboard sends commands |
| `team:wake` | Start team processes | CI/CD wakes teams for deployment |
| `team:sleep` | Stop team processes | Admin shuts down idle teams |
| `team:cancel` | Cancel running operations | User aborts long-running task |
| `team:clear` | Clear team sessions | Cleanup old sessions |
| `team:compact` | Compact team sessions | Reduce context size |
| `team:fork` | Fork team sessions | Debug in separate terminal |
| `cache:read` | View cache contents | Monitor team output |
| `cache:write` | Modify cache | Clear cache manually |
| `status:read` | View system status | Health checks, monitoring |
| `debug:read` | Access debug logs | Troubleshooting |
| `admin` | All permissions | Full system access |

### Permission Hierarchy

```
admin
  ├── team:*
  │   ├── team:tell
  │   ├── team:wake
  │   ├── team:sleep
  │   ├── team:cancel
  │   ├── team:clear
  │   ├── team:compact
  │   └── team:fork
  ├── cache:*
  │   ├── cache:read
  │   └── cache:write
  ├── status:*
  │   └── status:read
  └── debug:*
      └── debug:read
```

**Wildcard support** (future):
- `team:*` → All team permissions
- `cache:*` → All cache permissions
- `*` → All permissions (equivalent to `admin`)

### Role Presets

**Pre-defined roles** for common use cases:

```typescript
export const ROLES = {
  viewer: ['status:read', 'cache:read'],
  operator: ['status:read', 'cache:read', 'team:tell', 'team:wake'],
  developer: ['status:read', 'cache:read', 'team:tell', 'team:wake', 'team:sleep', 'team:clear', 'debug:read'],
  admin: ['admin']
} as const;
```

**CLI usage**:
```bash
pnpm iris key generate "Monitor" --role viewer
pnpm iris key generate "CI/CD" --role operator
pnpm iris key generate "Alice" --role developer
```

### Permission Check Middleware

```typescript
// src/api/middleware/permissions.ts
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { permissions } = req.authContext;

    // Admin bypass
    if (permissions.includes('admin')) {
      return next();
    }

    // Exact match
    if (permissions.includes(permission)) {
      return next();
    }

    // Wildcard match (future)
    const [namespace, action] = permission.split(':');
    if (permissions.includes(`${namespace}:*`)) {
      return next();
    }

    throw new ForbiddenError(`Insufficient permissions. Required: ${permission}`);
  };
}

// Usage in routes
router.post('/teams/tell',
  requirePermission('team:tell'),
  async (req, res) => { /* ... */ }
);
```

---

## Token Validation Flow

### Common Flow (All Strategies)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Extract Token                                            │
│    Authorization: Bearer {token}                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Detect Token Type                                        │
│    • API Key: iris_sk_*                                     │
│    • JWT: {header}.{payload}.{signature}                    │
│    • X.509-SVID: -----BEGIN CERTIFICATE-----                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Validate Token                                           │
│    • API Key: Hash → SQLite lookup                          │
│    • OAuth2 JWT: Verify signature with JWKS                 │
│    • SPIFFE: Verify cert chain with trust bundle            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Extract Identity                                         │
│    • API Key: { keyName, keyHash }                          │
│    • OAuth2: { sub, email, name }                           │
│    • SPIFFE: { spiffeId }                                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Map to Permissions                                       │
│    • API Key: permissions from DB                           │
│    • OAuth2: scope → permissions mapping                    │
│    • SPIFFE: spiffeId → permissions mapping                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Attach to Request Context                                │
│    req.authContext = {                                      │
│      authenticated: true,                                   │
│      strategy: 'apikey' | 'oauth2' | 'spiffe',             │
│      identity: { ... },                                     │
│      permissions: [...],                                    │
│      metadata: { ... }                                      │
│    }                                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Audit Log                                                │
│    • Log successful auth (identity, timestamp, endpoint)    │
│    • Log failed auth (reason, IP, timestamp)                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Proceed to Route Handler                                 │
│    • Permission checks via requirePermission() middleware   │
└─────────────────────────────────────────────────────────────┘
```

### Rate Limiting

**Applied after authentication, before permission checks**:

```typescript
// Per-identity rate limiting
const rateLimiter = rateLimit({
  windowMs: 900000, // 15 minutes
  max: 100,         // Max requests per window

  keyGenerator: (req) => {
    const { strategy, identity } = req.authContext;

    // Key by identity
    switch (strategy) {
      case 'apikey':
        return identity.keyHash;
      case 'oauth2':
        return identity.sub;
      case 'spiffe':
        return identity.spiffeId;
      default:
        return req.ip; // Fallback to IP
    }
  }
});
```

### Audit Logging

**All authentication events logged**:

```typescript
// Success
auditLog('auth:success', {
  strategy: 'oauth2',
  identity: { sub: 'user123', email: 'alice@example.com' },
  endpoint: '/api/teams/tell',
  ip: req.ip,
  timestamp: Date.now()
});

// Failure
auditLog('auth:failed', {
  reason: 'Invalid JWT signature',
  token: token.substring(0, 20) + '...', // Truncated for security
  endpoint: req.path,
  ip: req.ip,
  timestamp: Date.now()
});
```

---

## Configuration

### Complete Example

```json
{
  "api": {
    "enabled": true,
    "port": 1615,
    "host": "127.0.0.1",

    "auth": {
      // Enabled strategies (can enable multiple)
      "strategies": ["apikey", "oauth2", "spiffe"],

      // Strategy priority (for ambiguous tokens)
      "strategyPriority": ["spiffe", "oauth2", "apikey"],

      // Require authentication (if false, all requests allowed)
      "requireAuth": true,

      // API Key configuration
      "apikey": {
        "enabled": true,
        "keyStorePath": "${IRIS_HOME}/keys.db"
      },

      // OAuth2/OIDC configuration
      "oauth2": {
        "enabled": true,
        "provider": "auth0",
        "discoveryUrl": "https://example.auth0.com/.well-known/openid-configuration",
        "clientId": "abc123...",
        "clientSecret": "${OAUTH2_CLIENT_SECRET}",
        "audience": "https://iris-api.example.com",
        "validationMode": "jwt",
        "jwksCacheTtl": 3600,
        "scopeMapping": {
          "iris:teams:write": ["team:tell", "team:wake", "team:sleep"],
          "iris:teams:read": ["status:read"],
          "iris:cache:read": ["cache:read"],
          "iris:admin": ["admin"]
        }
      },

      // SPIFFE/SPIRE configuration
      "spiffe": {
        "enabled": true,
        "workloadApiSocket": "unix:///run/spire/sockets/agent.sock",
        "trustDomain": "iris.example.com",
        "spireServerUrl": "https://spire-server.example.com",
        "audiences": ["spiffe://iris.example.com/api"],
        "idMapping": {
          "spiffe://iris.example.com/team/frontend": ["team:tell", "status:read"],
          "spiffe://iris.example.com/dashboard": ["status:read", "cache:read", "team:wake"],
          "spiffe://iris.example.com/admin": ["admin"]
        },
        "idPatterns": [
          {
            "pattern": "spiffe://iris.example.com/team/*",
            "permissions": ["team:tell", "status:read"]
          }
        ]
      }
    },

    "rateLimit": {
      "enabled": true,
      "windowMs": 900000,
      "maxRequests": 100
    },

    "auditLog": {
      "enabled": true,
      "path": "${IRIS_HOME}/audit.db"
    }
  }
}
```

### Environment Variables

**Secrets should never be in `config.json`**. Use environment variables:

```bash
# OAuth2 client secret
export OAUTH2_CLIENT_SECRET="your-secret-here"

# SPIRE server URL (if not in config)
export SPIRE_SERVER_URL="https://spire-server.example.com"

# API key database encryption key (future)
export IRIS_KEYSTORE_ENCRYPTION_KEY="..."
```

**Variable interpolation** in config:
```json
{
  "oauth2": {
    "clientSecret": "${OAUTH2_CLIENT_SECRET}"
  }
}
```

---

## Security Considerations

### Defense in Depth

**Multiple security layers**:

1. **Network** - Firewall, VPN, private subnet
2. **TLS** - HTTPS with modern ciphers (TLS 1.3)
3. **Rate Limiting** - Per-identity, configurable limits
4. **Authentication** - One of: API key, OAuth2, SPIFFE
5. **Authorization** - Granular permission checks
6. **Input Validation** - Existing `src/utils/validation.ts`
7. **Audit Logging** - All auth events logged

### Token Security

| Strategy | Token Lifetime | Rotation | Revocation |
|----------|---------------|----------|------------|
| **API Key** | Long-lived (90+ days) | Manual (CLI) | Immediate (DB update) |
| **OAuth2 JWT** | Short-lived (15m-1h) | Automatic (refresh token) | Delayed (until expiry) or immediate (introspection) |
| **SPIFFE X.509** | Very short (1h-24h) | Automatic (SPIRE) | Immediate (revocation list) |
| **SPIFFE JWT** | Very short (5m-1h) | Automatic (SPIRE) | Immediate (SPIRE) |

### Best Practices

1. **Principle of Least Privilege**
   - Grant minimum permissions needed
   - Use role presets (`viewer`, `operator`, `developer`)
   - Avoid `admin` for routine tasks

2. **Token Hygiene**
   - API keys: Rotate every 90 days
   - OAuth2: Use short-lived access tokens (15m-1h)
   - SPIFFE: Let SPIRE auto-rotate (default 1h)

3. **Audit Everything**
   - Log all successful authentications
   - Log all failed attempts
   - Alert on suspicious patterns (e.g., repeated failures)

4. **Network Isolation**
   - Default to `host: "127.0.0.1"` (localhost only)
   - Use reverse proxy (nginx, Caddy) for TLS termination
   - Firewall rules to restrict API access

5. **Secret Management**
   - Never commit secrets to git
   - Use environment variables or secret managers (Vault, AWS Secrets Manager)
   - API keys hashed in database (SHA-256)

---

## Implementation Roadmap

### Phase 1: API Key Foundation (Week 1)
- [ ] SQLite key store schema
- [ ] Key generation (CLI)
- [ ] Key validation middleware
- [ ] Permission model
- [ ] Unit tests

### Phase 2: OAuth2/OIDC Integration (Week 2)
- [ ] OIDC discovery client
- [ ] JWT validation (local + introspection modes)
- [ ] Scope-to-permission mapping
- [ ] OAuth2 flows (authorization code + client credentials)
- [ ] Integration tests

### Phase 3: SPIFFE/SPIRE Integration (Week 3)
- [ ] SPIRE Workload API client
- [ ] X.509-SVID validation
- [ ] JWT-SVID validation
- [ ] SPIFFE ID mapping
- [ ] mTLS server support
- [ ] SPIFFE federation (optional)

### Phase 4: Hybrid Mode (Week 4)
- [ ] Token type detection
- [ ] Multi-strategy routing
- [ ] Strategy priority configuration
- [ ] Conflict resolution
- [ ] End-to-end tests

### Phase 5: Hardening & Docs (Week 5)
- [ ] Rate limiting per identity
- [ ] Audit logging (SQLite + Wonder)
- [ ] Security audit
- [ ] Documentation (this file + implementation plan)
- [ ] Example configurations for common scenarios

---

## References

### Standards & Specifications

- **OAuth 2.0**: [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- **OpenID Connect**: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html)
- **JWT**: [RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
- **SPIFFE**: [SPIFFE Specification](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE.md)
- **SPIRE**: [SPIRE Documentation](https://spiffe.io/docs/latest/spire/)

### Libraries

- **API Keys**: `crypto` (Node.js built-in), `better-sqlite3`
- **OAuth2/OIDC**: `jose` (JWT verification), `openid-client`, `passport`
- **SPIFFE**: [`spiffe` npm package](https://www.npmjs.com/package/spiffe)

### Identity Providers

- **SaaS**: [Auth0](https://auth0.com), [Okta](https://okta.com), [Azure AD](https://azure.microsoft.com/en-us/services/active-directory/)
- **Self-hosted**: [Keycloak](https://www.keycloak.org/), [ORY Hydra](https://www.ory.sh/hydra/), [Authelia](https://www.authelia.com/)
- **SPIRE**: [SPIRE Installation](https://spiffe.io/docs/latest/spire/installing/)

### Related Iris MCP Docs

- [API_IMPLEMENTATION_PLAN.md](./API_IMPLEMENTATION_PLAN.md) - Phase 3 API server plan
- [API.md](./API.md) - API endpoint documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
- `src/utils/validation.ts` - Existing input validation
- `src/utils/errors.ts` - Error hierarchy

---

**Document Version:** 1.0
**Last Updated:** 2025-01-16
**Status:** Design Phase
**Next Steps:** Create `API_AUTH_IMPLEMENTATION_PLAN.md` with detailed implementation tasks
