# Iris MCP API Implementation Plan (Phase 3)

**Status:** Planning Phase
**Created:** 2025-01-15
**Target Release:** Phase 3

---

## Architecture Overview

**Key Decision**: Create a **separate Express server** (`src/api_server.ts`) independent from the dashboard web server (`src/web_server.ts`). This maintains clean separation of concerns:

- **Dashboard Server** (Port 3100): React SPA for monitoring/management UI
- **API Server** (Port 1615): RESTful + WebSocket API for external integrations

Both servers will share the same core components:
- `ClaudeProcessPool`
- `SessionManager`
- `TeamsConfigManager`
- `IrisOrchestrator`

---

## Implementation Structure

### Phase 3.1: Core API Infrastructure

**Files to Create:**
```
src/api_server.ts          # Main Express + Socket.io server (parallel to web_server.ts)
src/api/
├── middleware/
│   ├── auth.ts           # API key authentication
│   ├── rate-limit.ts     # Rate limiting configuration
│   ├── error-handler.ts  # Centralized error handling
│   └── validation.ts     # Request validation middleware
├── routes/
│   ├── teams.ts          # Team communication routes
│   ├── process.ts        # Process management routes
│   ├── cache.ts          # Cache management routes
│   └── status.ts         # System status routes
├── websocket/
│   ├── handlers.ts       # WebSocket event handlers
│   └── rooms.ts          # Socket.io room management
└── types.ts              # API-specific TypeScript types
```

---

## REST Endpoint Mapping

All MCP tools map 1:1 to HTTP endpoints:

| MCP Tool | HTTP Endpoint | Method | Action File |
|----------|--------------|--------|-------------|
| `team_tell` | `/api/teams/tell` | POST | tell.ts |
| `team_quick_tell` | `/api/teams/quick-tell` | POST | quick_tell.ts |
| `team_cancel` | `/api/teams/:team/cancel` | POST | cancel.ts |
| `team_clear` | `/api/teams/:team/clear` | DELETE | clear.ts |
| `team_wake` | `/api/teams/:team/wake` | POST | wake.ts |
| `team_sleep` | `/api/teams/:team/sleep` | POST | sleep.ts |
| `team_wake_all` | `/api/teams/wake-all` | POST | wake-all.ts |
| `team_isAwake` | `/api/teams/status` | GET | isAwake.ts |
| `team_report` | `/api/teams/:team/report` | GET | report.ts |
| `team_teams` | `/api/teams` | GET | teams.ts |

**Additional Endpoints:**
- `GET /api/status` - Overall system health
- `GET /api/health` - Basic health check
- `GET /api/cache/:sessionId` - Read cache
- `DELETE /api/cache/:sessionId` - Clear cache

---

## Configuration Changes

### Update `src/example.config.json`

Add new `api` section:

```json
{
  "settings": { /* existing */ },
  "dashboard": { /* existing */ },
  "database": { /* existing */ },
  "api": {
    "enabled": true,
    "port": 1615,
    "host": "0.0.0.0",
    "requireAuth": false,
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000", "http://localhost:3100"]
    },
    "rateLimit": {
      "enabled": true,
      "windowMs": 900000,
      "maxRequests": 100
    },
    "apiKeys": [
      {
        "key": "iris_sk_example_abc123",
        "name": "Example API Key",
        "permissions": ["tell", "wake", "status"],
        "enabled": true
      }
    ]
  },
  "teams": { /* existing */ }
}
```

### Update `src/config/iris-config.ts`

Add Zod schema for API configuration:

```typescript
const ApiKeySchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  permissions: z.array(z.enum([
    "tell",
    "wake",
    "sleep",
    "status",
    "cache:read",
    "cache:write",
    "admin"
  ])),
  enabled: z.boolean().default(true)
});

const ApiConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(1615),
  host: z.string().default("0.0.0.0"),
  requireAuth: z.boolean().default(false),
  cors: z.object({
    enabled: z.boolean().default(true),
    origins: z.array(z.string()).default(["*"])
  }).optional().default({
    enabled: true,
    origins: ["*"]
  }),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().positive().default(900000), // 15 minutes
    maxRequests: z.number().int().positive().default(100)
  }).optional().default({
    enabled: true,
    windowMs: 900000,
    maxRequests: 100
  }),
  apiKeys: z.array(ApiKeySchema).optional().default([])
});

// Add to TeamsConfigSchema
const TeamsConfigSchema = z.object({
  settings: { /* existing */ },
  dashboard: { /* existing */ },
  database: { /* existing */ },
  api: ApiConfigSchema.optional().default({
    enabled: true,
    port: 1615,
    host: "0.0.0.0",
    requireAuth: false
  }),
  teams: { /* existing */ }
});
```

### Update `src/process-pool/types.ts`

Add API configuration type:

```typescript
export interface ApiKey {
  key: string;
  name: string;
  permissions: Array<
    "tell" | "wake" | "sleep" | "status" |
    "cache:read" | "cache:write" | "admin"
  >;
  enabled: boolean;
}

export interface ApiConfig {
  enabled: boolean;
  port: number;
  host: string;
  requireAuth: boolean;
  cors?: {
    enabled: boolean;
    origins: string[];
  };
  rateLimit?: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
  };
  apiKeys?: ApiKey[];
}

export interface TeamsConfig {
  settings: GlobalSettings;
  dashboard?: DashboardConfig;
  database?: DatabaseConfig;
  api?: ApiConfig;
  teams: Record<string, IrisConfig>;
}
```

---

## Authentication & Security

### API Key Format

`iris_sk_{random_string}`

Example: `iris_sk_abc123def456ghi789jkl012`

### Permission Model

- `tell` - Send messages via team_tell, team_quick_tell
- `wake` - Start processes (wake, wake_all)
- `sleep` - Stop processes (sleep, clear, cancel)
- `status` - Read system status (isAwake, teams, report)
- `cache:read` - View cache contents
- `cache:write` - Clear cache
- `admin` - All permissions (bypass all checks)

### Middleware Stack

```typescript
app.use(helmet());                          // Security headers
app.use(cors(config.api.cors));             // CORS
app.use(express.json({ limit: '10mb' }));   // JSON parsing
app.use('/api/', apiRateLimiter);           // Rate limiting
app.use('/api/', authenticateApiKey);       // Auth (if enabled)
app.use('/api/', errorHandler);             // Error handling
```

### Authentication Middleware

```typescript
// src/api/middleware/auth.ts
export function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Skip if auth not required
  if (!config.api.requireAuth) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Missing or invalid Authorization header',
      statusCode: 401,
      timestamp: Date.now()
    });
  }

  const apiKey = authHeader.replace('Bearer ', '');
  const key = config.api.apiKeys?.find(k => k.key === apiKey && k.enabled);

  if (!key) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Invalid API key',
      statusCode: 401,
      timestamp: Date.now()
    });
  }

  // Attach key to request for permission checks
  req.apiKey = key;
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.api.requireAuth) {
      return next();
    }

    const key = req.apiKey;
    if (!key) {
      return res.status(403).json({
        error: 'ForbiddenError',
        message: 'No API key found',
        statusCode: 403,
        timestamp: Date.now()
      });
    }

    // Admin has all permissions
    if (key.permissions.includes('admin')) {
      return next();
    }

    if (!key.permissions.includes(permission)) {
      return res.status(403).json({
        error: 'ForbiddenError',
        message: `Insufficient permissions. Required: ${permission}`,
        statusCode: 403,
        timestamp: Date.now()
      });
    }

    next();
  };
}
```

---

## WebSocket Implementation

### Event Types

**Cache Streaming:**
```typescript
socket.emit('cache:message', {
  sessionId: string,
  message: CacheMessage
});
```

**Process Lifecycle:**
```typescript
socket.emit('process:spawned', { team: string, pid: number });
socket.emit('process:terminated', { team: string });
socket.emit('process:error', { team: string, error: string });
```

**Tell Streaming (Real-Time Response):**
```typescript
socket.emit('tell:chunk', { chunk: string });
socket.emit('tell:complete', { response: string });
socket.emit('tell:error', { error: string });
```

**System Health:**
```typescript
socket.emit('health:check', {
  totalProcesses: number,
  maxProcesses: number,
  uptime: number
});
```

### Room Structure

Clients subscribe to specific rooms for targeted broadcasts:

- `session:{sessionId}` - Subscribe to specific session cache messages
- `team:{teamName}` - Subscribe to team process lifecycle events
- `system` - Subscribe to system-wide health checks

**Client-Side Subscription:**
```javascript
socket.emit('cache:subscribe', { sessionId: 'abc123-...' });
socket.emit('process:subscribe', { team: 'backend' });
```

### WebSocket Authentication

```typescript
const io = new Server(httpServer, {
  cors: config.api.cors
});

io.use((socket, next) => {
  if (!config.api.requireAuth) {
    return next();
  }

  const token = socket.handshake.auth.token;
  const key = config.api.apiKeys?.find(k => k.key === token && k.enabled);

  if (!key) {
    return next(new Error('Invalid API key'));
  }

  socket.data.apiKey = key;
  next();
});
```

---

## Error Response Format

All error responses follow this standardized format:

```typescript
interface ErrorResponse {
  error: string;           // Error class name (e.g., "ValidationError")
  message: string;         // Human-readable error message
  statusCode: number;      // HTTP status code
  timestamp: number;       // Unix timestamp in milliseconds
  details?: Record<string, any>;  // Optional additional context
}
```

### HTTP Status Code Mapping

Map existing errors from `src/utils/errors.ts` to HTTP status codes:

| Error Class | Status Code | Description |
|-------------|-------------|-------------|
| `ValidationError` | 400 | Invalid input parameters |
| `UnauthorizedError` | 401 | Missing/invalid API key |
| `ForbiddenError` | 403 | Insufficient permissions |
| `TeamNotFoundError` | 404 | Team not in configuration |
| `TimeoutError` | 408 | Operation timeout |
| `TooManyRequestsError` | 429 | Rate limit exceeded |
| `ProcessError` | 500 | Process spawn/communication failure |
| `ConfigurationError` | 500 | Config file issues |
| `ProcessPoolLimitError` | 503 | Max processes reached |

### Error Handling Middleware

```typescript
// src/api/middleware/error-handler.ts
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  let statusCode = 500;
  let errorName = err.constructor.name;

  // Map custom errors to status codes
  if (err instanceof ValidationError) statusCode = 400;
  else if (err instanceof TeamNotFoundError) statusCode = 404;
  else if (err instanceof TimeoutError) statusCode = 408;
  else if (err instanceof ProcessPoolLimitError) statusCode = 503;
  // ... etc

  const response: ErrorResponse = {
    error: errorName,
    message: err.message,
    statusCode,
    timestamp: Date.now()
  };

  logger.error({ err, statusCode, path: req.path }, 'API error');
  res.status(statusCode).json(response);
}
```

---

## Implementation Steps

### Step 1: Configuration Schema
**Files:** `src/config/iris-config.ts`, `src/process-pool/types.ts`

- Add `ApiConfigSchema` to Zod validation
- Add `api` field to `TeamsConfigSchema`
- Export `ApiConfig` and `ApiKey` types in types.ts
- Update `example.config.json` with API section

### Step 2: API Server Boilerplate
**Files:** `src/api_server.ts`

```typescript
/**
 * Iris API Server
 * Standalone HTTP/WebSocket API server for external integrations
 * Runs independently from the MCP server, sharing process pool and session manager
 */

import type { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { TeamsConfigManager } from "./config/iris-config.js";
import type { IrisOrchestrator } from "./iris.js";
import type { ApiConfig } from "./process-pool/types.js";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { createServer } from "http";
import { getChildLogger } from "./utils/logger.js";

const logger = getChildLogger("iris:api");

export class IrisApiServer {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketServer;

  constructor(
    private processPool: ClaudeProcessPool,
    private sessionManager: SessionManager,
    private configManager: TeamsConfigManager,
    private iris: IrisOrchestrator,
  ) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketServer(this.httpServer);

    logger.info("Iris API Server initialized");
  }

  async start(config: ApiConfig): Promise<void> {
    try {
      logger.info(
        {
          host: config.host,
          port: config.port,
          authRequired: config.requireAuth,
        },
        "Starting API server...",
      );

      // Setup middleware, routes, websocket handlers
      await this.setupMiddleware(config);
      await this.setupRoutes();
      await this.setupWebSocket(config);

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        this.httpServer.listen(config.port, config.host, () => {
          resolve();
        });
        this.httpServer.on('error', reject);
      });

      logger.info(
        {
          url: `http://${config.host}:${config.port}`,
        },
        "API server started successfully",
      );
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to start API server",
      );
      throw error;
    }
  }

  private async setupMiddleware(config: ApiConfig): Promise<void> {
    // Implementation in Step 3
  }

  private async setupRoutes(): Promise<void> {
    // Implementation in Step 4
  }

  private async setupWebSocket(config: ApiConfig): Promise<void> {
    // Implementation in Step 5
  }
}
```

### Step 3: Middleware
**Files:** `src/api/middleware/*.ts`

Create:
- `auth.ts` - API key validation with permission checks
- `rate-limit.ts` - express-rate-limit configuration
- `error-handler.ts` - Convert errors to standard JSON format
- `validation.ts` - Request body/params validation helpers

### Step 4: Route Handlers
**Files:** `src/api/routes/*.ts`

Create route modules:
- `teams.ts` - Team communication endpoints
- `process.ts` - Process management endpoints
- `status.ts` - System status endpoints
- `cache.ts` - Cache management endpoints

**Route Handler Pattern:**
```typescript
// src/api/routes/teams.ts
import { Router } from 'express';
import { tell } from '../../actions/tell.js';
import { requirePermission } from '../middleware/auth.js';

export function createTeamsRouter(iris: IrisOrchestrator) {
  const router = Router();

  router.post('/tell',
    requirePermission('tell'),
    async (req, res, next) => {
      try {
        const result = await tell(req.body, iris);
        res.json(result);
      } catch (error) {
        next(error); // Handled by error middleware
      }
    }
  );

  return router;
}
```

### Step 5: WebSocket Handlers
**Files:** `src/api/websocket/*.ts`

- Connect existing `ClaudeProcessPool` and `ClaudeProcess` events to Socket.io rooms
- Implement cache subscription (`cache:subscribe`, `cache:unsubscribe`)
- Implement process subscription (`process:subscribe`)
- Implement tell streaming (`tell:start` → chunks → `tell:complete`)

### Step 6: Integration in src/index.ts
- Import `IrisApiServer`
- Check if `config.api.enabled === true`
- Start API server alongside MCP server and dashboard
- Pass shared `processPool`, `sessionManager`, `configManager`, `iris`

```typescript
// In src/index.ts
if (config.api?.enabled) {
  const apiServer = new IrisApiServer(
    processPool,
    sessionManager,
    configManager,
    iris
  );
  await apiServer.start(config.api);
}
```

### Step 7: Documentation & Examples
**Files:** `examples/api/*.{sh,js,py,tsx}`

Create usage examples:
- `curl-examples.sh` - Bash script with all endpoints
- `node-client.js` - Node.js example with Socket.io
- `python-client.py` - Python requests example
- `react-integration.tsx` - React hooks example

---

## Testing Strategy

### Integration Tests
**Files:** `tests/integration/api/*.test.ts`

Create test suites:
- `rest-endpoints.test.ts` - Test all REST endpoints
- `websocket-streams.test.ts` - Test Socket.io events
- `auth.test.ts` - Test API key authentication
- `rate-limiting.test.ts` - Test rate limits
- `cors.test.ts` - Test CORS configuration
- `error-handling.test.ts` - Test error response format

**Testing Dependencies:**
- `supertest` - HTTP endpoint testing
- `socket.io-client` - WebSocket testing

---

## Dependencies

All required dependencies are already installed in `package.json`:

- ✅ `express` (^4.18.2)
- ✅ `socket.io` (^4.6.0)
- ✅ `express-rate-limit` (^7.1.5)
- ✅ `helmet` (^7.1.0)
- ✅ `cors` (^2.8.5)

**Additional Type Definitions Needed:**
```bash
pnpm add -D @types/express @types/cors
```

---

## Performance Considerations

1. **Shared Process Pool** - API and MCP tools use same pool, no duplication of processes
2. **WebSocket Rooms** - Only broadcast to subscribed clients, not all connections
3. **Rate Limiting** - Prevent abuse and resource exhaustion
4. **Async Operations** - Use `timeout=-1` for async mode to avoid blocking
5. **Connection Pooling** - Socket.io handles reconnection automatically
6. **JSON Parsing Limit** - Set reasonable limit (10MB) to prevent memory issues

---

## Security Checklist

- [ ] API keys validated on every request (if auth enabled)
- [ ] Rate limiting prevents brute force attacks
- [ ] CORS restricts allowed origins
- [ ] Helmet adds security headers (X-Frame-Options, CSP, etc.)
- [ ] Input validation on all endpoints (reuse `src/utils/validation.ts`)
- [ ] Error messages don't leak sensitive information (stack traces, paths)
- [ ] WebSocket authentication via auth token
- [ ] No SQL injection (using parameterized queries)
- [ ] API keys use secure format with prefix (`iris_sk_`)
- [ ] Permissions are granular and enforced

---

## Migration Timeline

### Phase 3.1: Core Infrastructure (Week 1-2)
- [ ] Configuration schema updates
- [ ] Basic Express server setup (`api_server.ts`)
- [ ] REST endpoints (no auth)
- [ ] Error handling middleware
- [ ] Basic health check endpoint

### Phase 3.2: Security (Week 3)
- [ ] Authentication middleware
- [ ] Permission system
- [ ] Rate limiting
- [ ] CORS configuration
- [ ] Security headers (Helmet)

### Phase 3.3: WebSocket (Week 4)
- [ ] Socket.io integration
- [ ] Cache streaming
- [ ] Process lifecycle events
- [ ] Tell streaming (real-time responses)
- [ ] Room-based broadcasting

### Phase 3.4: Testing & Documentation (Week 5)
- [ ] Integration test suite
- [ ] API documentation
- [ ] Client examples (curl, Node.js, Python, React)
- [ ] Performance benchmarks
- [ ] Security audit

---

## Open Questions

1. **Port Configuration**: API on 1615 (as in docs/API.md), dashboard on 3100. Any conflicts?
2. **Authentication Default**: Should `requireAuth` default to `true` or `false` for security?
3. **WebSocket Namespace**: Use `/ws` namespace or root namespace for Socket.io?
4. **API Versioning**: Should we version the API (e.g., `/api/v1/teams`) from the start?
5. **Logging**: Should API requests have separate log context (e.g., `api:teams` vs `action:teams`)?
6. **API Key Generation**: Should we provide a CLI command to generate API keys (`iris generate-api-key`)?
7. **HTTPS Support**: Should we support SSL/TLS certificates for production deployments?

---

## References

- **API Documentation**: [docs/API.md](./API.md)
- **Existing Actions**: `src/actions/*.ts`
- **Web Server**: `src/web_server.ts`
- **Configuration**: `src/config/iris-config.ts`
- **Process Pool**: `src/process-pool/pool-manager.ts`

---

**Document Version:** 1.0
**Last Updated:** 2025-01-15
**Status:** Planning Phase
