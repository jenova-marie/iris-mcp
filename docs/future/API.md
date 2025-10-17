# Iris MCP: Programmatic API Addendum

**Programmatic Streaming Interaction with Team Agents**

---

## 🎯 Overview

Iris MCP exposes a **programmatic API** that allows external services, scripts, and applications to interact with Claude Code instances as if they were microservices. This closes the gap of "I wish there was a programmatic way to control Claude Code."

**What This Enables:**
- CI/CD pipeline integration
- Webhook-driven automations
- Scheduled cron jobs using Claude Code
- Multi-language SDK support
- Custom orchestration layers
- Claude Code as a Service (CCaaS)

---

## 📋 For README.md

### Add after "Web Dashboard" section:

---

## 🔌 Programmatic API

Iris MCP provides a **RESTful API and WebSocket interface** for programmatic interaction with team agents, enabling you to integrate Claude Code into your automation workflows.

### Quick Example

```bash
# Ask the backend team a question programmatically
curl -X POST http://localhost:3100/api/v1/teams/backend/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "question": "What database migration system do you use?",
    "timeout": 30000
  }'

# Response:
{
  "messageId": "msg_abc123",
  "team": "backend",
  "response": "We use Prisma for database migrations...",
  "duration": 2847,
  "timestamp": 1704067200000
}
```

### Use Cases

#### 1. CI/CD Integration

```yaml
# .github/workflows/code-review.yml
name: AI Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Get AI Review
        run: |
          curl -X POST http://iris.internal/api/v1/teams/code-reviewer/ask \
            -H "Authorization: Bearer ${{ secrets.IRIS_API_KEY }}" \
            -d "{\"question\": \"Review PR #${{ github.event.pull_request.number }}\"}" \
            | jq -r '.response' > review.md

      - name: Comment on PR
        uses: actions/github-script@v6
        with:
          script: |
            const review = require('fs').readFileSync('review.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: review
            });
```

#### 2. Slack Bot Integration

```typescript
// slack-bot.ts
import { WebClient } from '@slack/web-api';
import axios from 'axios';

const slack = new WebClient(process.env.SLACK_TOKEN);
const irisApi = axios.create({
  baseURL: 'http://localhost:3100/api/v1',
  headers: { 'Authorization': `Bearer ${process.env.IRIS_API_KEY}` }
});

slack.on('message', async (event) => {
  if (event.text.startsWith('/ask-backend')) {
    const question = event.text.replace('/ask-backend', '').trim();

    const response = await irisApi.post('/teams/backend/ask', { question });

    await slack.chat.postMessage({
      channel: event.channel,
      text: `Backend team says: ${response.data.response}`
    });
  }
});
```

#### 3. Scheduled Code Maintenance

```typescript
// cron-job.ts
import cron from 'node-cron';
import { IrisClient } from '@iris-mcp/client';

const iris = new IrisClient({
  baseUrl: 'http://localhost:3100',
  apiKey: process.env.IRIS_API_KEY
});

// Every Monday at 9am: Check for dependency updates
cron.schedule('0 9 * * 1', async () => {
  const result = await iris.teams.backend.ask(
    'Check for outdated npm dependencies and create a PR if any are found'
  );

  console.log('Dependency check result:', result);
});

// Every day at 2am: Run security audit
cron.schedule('0 2 * * *', async () => {
  await iris.teams.backend.execute(
    'Run npm audit and fix any vulnerabilities with auto-fixable patches'
  );
});
```

#### 4. Monitoring Alert Response

```python
# alert_handler.py
from iris_mcp import IrisClient

iris = IrisClient(
    base_url="http://localhost:3100",
    api_key=os.environ["IRIS_API_KEY"]
)

def handle_alert(alert):
    """Automatically diagnose and potentially fix production issues"""

    if alert.severity == "critical":
        # Ask backend team to investigate
        response = iris.teams.backend.ask(
            f"We have a critical alert: {alert.message}. "
            f"Check logs and suggest a fix. Alert details: {alert.details}"
        )

        # Post to incident channel
        slack.post_message(
            channel="#incidents",
            text=f"🚨 AI Analysis:\n{response.response}"
        )

        # If Claude suggests a fix, ask for confirmation
        if "suggested_fix" in response.metadata:
            # Human approval workflow...
            pass
```

### API Authentication

Generate an API key in the dashboard or via CLI:

```bash
# Generate new API key
iris-mcp api-key create --name "ci-cd-pipeline" --scope teams:read,teams:write

# Output:
# API Key: iris_sk_abc123def456...
# Save this key securely - it won't be shown again!
```

Configure authentication:

```json
// iris-config.yaml
{
  "api": {
    "enabled": true,
    "port": 3100,
    "auth": {
      "type": "bearer", // or "basic", "jwt"
      "keys": [
        {
          "name": "ci-cd-pipeline",
          "key": "iris_sk_abc123...",
          "scopes": ["teams:read", "teams:write"],
          "rateLimit": {
            "requests": 100,
            "window": "1m"
          }
        }
      ]
    }
  }
}
```

### Official SDKs

#### TypeScript/Node.js

```bash
npm install @iris-mcp/client
```

```typescript
import { IrisClient } from '@iris-mcp/client';

const iris = new IrisClient({
  baseUrl: 'http://localhost:3100',
  apiKey: process.env.IRIS_API_KEY
});

// Ask a question
const response = await iris.teams.backend.ask(
  'What database indexes do we have on the users table?'
);

console.log(response.response);

// Execute a task
await iris.teams.frontend.execute(
  'Update all deprecated React patterns to use React 19 features'
);

// Stream responses in real-time
for await (const chunk of iris.teams.backend.stream(
  'Explain the authentication flow step by step'
)) {
  process.stdout.write(chunk.text);
}
```

#### Python

```bash
pip install iris-mcp-client
```

```python
from iris_mcp import IrisClient, StreamMode

iris = IrisClient(
    base_url="http://localhost:3100",
    api_key=os.environ["IRIS_API_KEY"]
)

# Ask a question
response = iris.teams.backend.ask(
    "What database indexes do we have on the users table?"
)
print(response.response)

# Execute a task
iris.teams.frontend.execute(
    "Update all deprecated React patterns to use React 19 features"
)

# Stream responses in real-time
for chunk in iris.teams.backend.stream(
    "Explain the authentication flow step by step"
):
    print(chunk.text, end='', flush=True)
```

#### Go

```bash
go get github.com/iris-mcp/go-client
```

```go
package main

import (
    "context"
    "fmt"
    "os"

    iris "github.com/iris-mcp/go-client"
)

func main() {
    client := iris.NewClient(
        iris.WithBaseURL("http://localhost:3100"),
        iris.WithAPIKey(os.Getenv("IRIS_API_KEY")),
    )

    // Ask a question
    response, err := client.Teams.Backend.Ask(context.Background(),
        "What database indexes do we have on the users table?",
    )
    if err != nil {
        panic(err)
    }

    fmt.Println(response.Response)
}
```

### API Rate Limits

```
Rate Limits (per API key):
- Standard: 100 requests/minute
- Premium: 1000 requests/minute
- Enterprise: Unlimited

Headers returned:
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067200
```

---

## 📋 For ARCHITECTURE.md

### Add new section after "Web Dashboard Architecture":

---

## 🔌 Programmatic API Architecture

### Overview

The Iris Programmatic API provides **HTTP REST endpoints** and **WebSocket streaming** for external services to interact with team agents. This enables Claude Code to function as a programmable service that can be integrated into any workflow.

### API Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  External Services (CI/CD, Webhooks, Cron, Custom Apps)     │
└────────────┬─────────────────────────────────────────────────┘
             │
             │ HTTP/REST + WebSocket
             │
┌────────────▼─────────────────────────────────────────────────┐
│           API Gateway & Router                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Authentication Middleware                               │ │
│  │  • Bearer token validation                               │ │
│  │  • API key verification                                  │ │
│  │  • Scope checking (teams:read, teams:write, etc.)       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Rate Limiting                                           │ │
│  │  • Token bucket algorithm                                │ │
│  │  • Per-API-key limits                                    │ │
│  │  • Sliding window counters                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Request Validation & Sanitization                       │ │
│  │  • JSON schema validation                                │ │
│  │  • Input sanitization                                    │ │
│  │  • Parameter normalization                               │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│              API Endpoint Handlers                            │
│                                                               │
│  POST   /api/v1/teams/:team/ask                              │
│  POST   /api/v1/teams/:team/execute                          │
│  POST   /api/v1/teams/:team/stream                           │
│  GET    /api/v1/teams/:team/status                           │
│  GET    /api/v1/messages/:messageId                          │
│  GET    /api/v1/messages/history                             │
│  WS     /api/v1/stream                                        │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│           Message Queue & Job Processor                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Request Queue (Redis/In-Memory)                         │ │
│  │  • Queued requests with priority                         │ │
│  │  • Retry logic for failed requests                       │ │
│  │  • Request deduplication                                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Job Processor                                           │ │
│  │  • Worker pool for concurrent requests                   │ │
│  │  • Timeout management                                    │ │
│  │  • Error handling & retry                                │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│              Process Pool Manager                             │
│  (Same as MCP Server - Shared Instance)                      │
│                                                               │
│  • getOrCreateProcess(team)                                  │
│  • sendMessage(team, message)                                │
│  • streamResponse(team, message, callback)                   │
└──────────────────────────────────────────────────────────────┘
```

### API Endpoints Specification

#### 1. Ask Team (Synchronous)

**Endpoint:** `POST /api/v1/teams/:team/ask`

**Description:** Ask a team a question and wait for complete response.

**Request:**
```json
{
  "question": "What database migration system do you use?",
  "timeout": 30000,
  "context": {
    "source": "github-webhook",
    "metadata": {
      "pr_number": 123,
      "author": "john.doe"
    }
  }
}
```

**Response:**
```json
{
  "messageId": "msg_abc123",
  "team": "backend",
  "question": "What database migration system do you use?",
  "response": "We use Prisma for database migrations. Our migration files are located in prisma/migrations/ and we run them using 'npx prisma migrate deploy' in production.",
  "duration": 2847,
  "timestamp": 1704067200000,
  "metadata": {
    "filesAccessed": ["prisma/schema.prisma", "package.json"],
    "toolsUsed": ["Read", "Grep"]
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid request
- `401 Unauthorized` - Missing/invalid API key
- `404 Not Found` - Team not found
- `408 Request Timeout` - Response timeout exceeded
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

#### 2. Execute Task (Fire & Forget)

**Endpoint:** `POST /api/v1/teams/:team/execute`

**Description:** Execute a task without waiting for completion. Returns immediately with job ID.

**Request:**
```json
{
  "task": "Run npm audit and fix any vulnerabilities with auto-fixable patches",
  "priority": "normal",
  "callback": {
    "url": "https://api.example.com/webhooks/iris",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer webhook-secret"
    }
  }
}
```

**Response:**
```json
{
  "jobId": "job_xyz789",
  "team": "backend",
  "status": "queued",
  "estimatedCompletion": 1704067500000,
  "position": 3
}
```

**Webhook Callback (on completion):**
```json
POST https://api.example.com/webhooks/iris
{
  "jobId": "job_xyz789",
  "team": "backend",
  "status": "completed",
  "result": {
    "summary": "Fixed 3 vulnerabilities, 0 require manual review",
    "details": "..."
  },
  "duration": 15234,
  "timestamp": 1704067515234
}
```

#### 3. Stream Response (Server-Sent Events)

**Endpoint:** `POST /api/v1/teams/:team/stream`

**Description:** Stream response in real-time as it's generated.

**Request:**
```json
{
  "message": "Explain the authentication flow step by step",
  "stream": true
}
```

**Response:** (Server-Sent Events stream)
```
event: start
data: {"messageId":"msg_stream_123","team":"backend"}

event: chunk
data: {"text":"The authentication flow consists of several steps:\n\n"}

event: chunk
data: {"text":"1. User submits credentials to POST /auth/login\n"}

event: chunk
data: {"text":"2. Server validates credentials against database\n"}

event: chunk
data: {"text":"3. If valid, generate JWT token with user claims\n"}

event: tool_use
data: {"tool":"Read","file":"src/auth/jwt.ts"}

event: chunk
data: {"text":"4. Return token to client in response body\n"}

event: complete
data: {"duration":4532,"timestamp":1704067200000}
```

**Client Example:**
```typescript
const eventSource = new EventSource(
  'http://localhost:3100/api/v1/teams/backend/stream',
  {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  }
);

eventSource.addEventListener('chunk', (e) => {
  const data = JSON.parse(e.data);
  process.stdout.write(data.text);
});

eventSource.addEventListener('complete', (e) => {
  console.log('\nCompleted in', JSON.parse(e.data).duration, 'ms');
  eventSource.close();
});
```

#### 4. WebSocket Streaming (Bidirectional)

**Endpoint:** `WS /api/v1/stream`

**Description:** Bidirectional streaming for interactive sessions.

**Connection:**
```typescript
const ws = new WebSocket('ws://localhost:3100/api/v1/stream', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});

ws.on('open', () => {
  // Subscribe to team
  ws.send(JSON.stringify({
    type: 'subscribe',
    team: 'backend'
  }));

  // Send message
  ws.send(JSON.stringify({
    type: 'message',
    team: 'backend',
    message: 'What database indexes do we have?'
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);

  switch(event.type) {
    case 'chunk':
      process.stdout.write(event.text);
      break;
    case 'complete':
      console.log('\nDone!');
      break;
    case 'error':
      console.error('Error:', event.error);
      break;
  }
});
```

**Message Types:**

**Client → Server:**
```typescript
// Subscribe to team
{
  type: 'subscribe',
  team: 'backend'
}

// Send message
{
  type: 'message',
  team: 'backend',
  message: 'Your question here',
  sessionId?: 'optional-session-id' // For multi-turn conversations
}

// Interrupt/cancel
{
  type: 'cancel',
  messageId: 'msg_123'
}
```

**Server → Client:**
```typescript
// Response chunk
{
  type: 'chunk',
  messageId: 'msg_123',
  text: 'Partial response text',
  timestamp: 1704067200000
}

// Tool usage notification
{
  type: 'tool_use',
  messageId: 'msg_123',
  tool: 'Read',
  input: { path: 'src/file.ts' }
}

// Completion
{
  type: 'complete',
  messageId: 'msg_123',
  duration: 2847,
  timestamp: 1704067200000
}

// Error
{
  type: 'error',
  messageId: 'msg_123',
  error: 'Error message',
  code: 'TIMEOUT'
}
```

#### 5. Get Message Status

**Endpoint:** `GET /api/v1/messages/:messageId`

**Description:** Check status of async message/job.

**Response:**
```json
{
  "messageId": "msg_abc123",
  "jobId": "job_xyz789",
  "team": "backend",
  "status": "processing", // queued, processing, completed, failed
  "progress": {
    "current": 3,
    "total": 5,
    "percentage": 60
  },
  "createdAt": 1704067200000,
  "startedAt": 1704067205000,
  "estimatedCompletion": 1704067220000
}
```

#### 6. Get Message History

**Endpoint:** `GET /api/v1/messages/history`

**Query Parameters:**
- `team` (optional) - Filter by team
- `from` (optional) - Filter by source team
- `to` (optional) - Filter by target team
- `status` (optional) - Filter by status
- `limit` (default: 50) - Results per page
- `page` (default: 1) - Page number
- `since` (optional) - Timestamp to filter from

**Response:**
```json
{
  "messages": [
    {
      "messageId": "msg_abc123",
      "from": "api",
      "to": "backend",
      "message": "What database indexes exist?",
      "response": "We have indexes on...",
      "status": "completed",
      "duration": 2847,
      "timestamp": 1704067200000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 247,
    "hasNext": true
  }
}
```

### Authentication & Authorization

#### API Key Authentication

```typescript
// src/api/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface ApiKey {
  name: string;
  key: string;
  scopes: string[];
  rateLimit: {
    requests: number;
    window: string;
  };
  expiresAt?: number;
}

export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization header'
    });
  }

  const token = authHeader.substring(7);
  const apiKey = await validateApiKey(token);

  if (!apiKey) {
    return res.status(401).json({
      error: 'Invalid API key'
    });
  }

  if (apiKey.expiresAt && Date.now() > apiKey.expiresAt) {
    return res.status(401).json({
      error: 'API key expired'
    });
  }

  // Attach to request for downstream use
  req.apiKey = apiKey;
  next();
}

async function validateApiKey(token: string): Promise<ApiKey | null> {
  // Hash the provided token
  const hash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Look up in database or config
  const apiKey = await apiKeyStore.findByHash(hash);
  return apiKey;
}
```

#### Scope-Based Authorization

```typescript
// Check required scopes
export function requireScopes(...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.apiKey;

    const hasAllScopes = scopes.every(scope =>
      apiKey.scopes.includes(scope) || apiKey.scopes.includes('*')
    );

    if (!hasAllScopes) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: scopes,
        provided: apiKey.scopes
      });
    }

    next();
  };
}

// Usage
app.post('/api/v1/teams/:team/ask',
  authenticateApiKey,
  requireScopes('teams:read', 'messages:write'),
  handleAskTeam
);
```

#### Available Scopes

```typescript
const SCOPES = {
  // Teams
  'teams:read': 'View team information',
  'teams:write': 'Create/update teams',
  'teams:delete': 'Delete teams',

  // Messages
  'messages:read': 'Read message history',
  'messages:write': 'Send messages to teams',
  'messages:stream': 'Use streaming endpoints',

  // Processes
  'processes:read': 'View active processes',
  'processes:manage': 'Start/stop processes',

  // Admin
  'admin:*': 'Full administrative access',
  '*': 'All permissions'
};
```

### Rate Limiting Strategy

#### Token Bucket Algorithm

```typescript
// src/api/middleware/rate-limit.ts
import Redis from 'ioredis';

const redis = new Redis();

interface RateLimitConfig {
  requests: number;  // Max requests
  window: number;    // Window in ms
}

export async function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.apiKey;
  const limit = apiKey.rateLimit;

  const key = `ratelimit:${apiKey.name}`;
  const now = Date.now();
  const windowStart = now - limit.window;

  // Remove old entries
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count requests in current window
  const count = await redis.zcard(key);

  if (count >= limit.requests) {
    const oldestEntry = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const resetTime = parseInt(oldestEntry[1]) + limit.window;

    res.set('X-RateLimit-Limit', limit.requests.toString());
    res.set('X-RateLimit-Remaining', '0');
    res.set('X-RateLimit-Reset', Math.ceil(resetTime / 1000).toString());

    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit: limit.requests,
      window: limit.window,
      resetAt: resetTime
    });
  }

  // Add current request
  await redis.zadd(key, now, `${now}-${Math.random()}`);
  await redis.expire(key, Math.ceil(limit.window / 1000));

  // Set rate limit headers
  res.set('X-RateLimit-Limit', limit.requests.toString());
  res.set('X-RateLimit-Remaining', (limit.requests - count - 1).toString());
  res.set('X-RateLimit-Reset', Math.ceil((now + limit.window) / 1000).toString());

  next();
}
```

### Request Queue & Job Processing

```typescript
// src/api/queue/job-processor.ts
import { ClaudeProcessPool } from '../../process-pool/pool-manager';

interface Job {
  id: string;
  team: string;
  message: string;
  priority: 'low' | 'normal' | 'high';
  timeout: number;
  callback?: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

export class JobProcessor {
  private queue: Job[] = [];
  private processing = new Set<string>();
  private maxConcurrent = 5;

  constructor(private processPool: ClaudeProcessPool) {
    this.startWorkers();
  }

  async enqueue(job: Omit<Job, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const fullJob: Job = {
      ...job,
      id: jobId,
      status: 'queued',
      createdAt: Date.now()
    };

    // Priority queue insertion
    const insertIndex = this.queue.findIndex(j =>
      this.getPriority(j.priority) < this.getPriority(fullJob.priority)
    );

    if (insertIndex === -1) {
      this.queue.push(fullJob);
    } else {
      this.queue.splice(insertIndex, 0, fullJob);
    }

    this.processNext();
    return jobId;
  }

  private getPriority(priority: Job['priority']): number {
    return { low: 1, normal: 2, high: 3 }[priority];
  }

  private startWorkers() {
    setInterval(() => this.processNext(), 100);
  }

  private async processNext() {
    if (this.processing.size >= this.maxConcurrent) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    this.processing.add(job.id);
    job.status = 'processing';
    job.startedAt = Date.now();

    try {
      const process = await this.processPool.getOrCreateProcess(job.team);
      const result = await Promise.race([
        process.sendMessage(job.message),
        this.timeout(job.timeout)
      ]);

      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();

      if (job.callback) {
        await this.sendCallback(job);
      }

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = Date.now();

      if (job.callback) {
        await this.sendCallback(job);
      }
    } finally {
      this.processing.delete(job.id);
    }
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), ms)
    );
  }

  private async sendCallback(job: Job) {
    if (!job.callback) return;

    try {
      await fetch(job.callback.url, {
        method: job.callback.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...job.callback.headers
        },
        body: JSON.stringify({
          jobId: job.id,
          team: job.team,
          status: job.status,
          result: job.result,
          error: job.error,
          duration: (job.completedAt || 0) - (job.startedAt || 0),
          timestamp: job.completedAt
        })
      });
    } catch (error) {
      console.error('Failed to send callback:', error);
    }
  }

  getJob(jobId: string): Job | undefined {
    return this.queue.find(j => j.id === jobId) ||
           [...this.processing].find(id => id === jobId) ?
             this.queue.find(j => j.id === jobId) : undefined;
  }
}
```

### Error Handling

```typescript
// Standardized error responses
interface ApiError {
  error: string;
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}

// Error codes
const ERROR_CODES = {
  INVALID_REQUEST: 'Invalid request parameters',
  TEAM_NOT_FOUND: 'Team does not exist',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Insufficient permissions',
  RATE_LIMITED: 'Rate limit exceeded',
  TIMEOUT: 'Request timeout exceeded',
  PROCESS_ERROR: 'Claude Code process error',
  INTERNAL_ERROR: 'Internal server error'
};

// Global error handler
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  const apiError: ApiError = {
    error: error.name || 'Error',
    code: error.code || 'INTERNAL_ERROR',
    message: error.message || 'An unexpected error occurred',
    details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    timestamp: Date.now()
  };

  const statusCode = error.statusCode || 500;
  res.status(statusCode).json(apiError);
});
```

### Monitoring & Observability

```typescript
// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    logger.info('API Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      apiKey: req.apiKey?.name,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // Track metrics
    metrics.recordRequest({
      endpoint: req.path,
      method: req.method,
      status: res.statusCode,
      duration
    });
  });

  next();
});
```

### SDK Implementation Examples

#### TypeScript SDK

```typescript
// @iris-mcp/client
export class IrisClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { baseUrl: string; apiKey: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  get teams() {
    return new TeamClient(this.baseUrl, this.apiKey);
  }
}

class TeamClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  get backend() {
    return new TeamInstance('backend', this.baseUrl, this.apiKey);
  }

  get frontend() {
    return new TeamInstance('frontend', this.baseUrl, this.apiKey);
  }

  team(name: string) {
    return new TeamInstance(name, this.baseUrl, this.apiKey);
  }
}

class TeamInstance {
  constructor(
    private name: string,
    private baseUrl: string,
    private apiKey: string
  ) {}

  async ask(question: string, options?: AskOptions): Promise<Response> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/teams/${this.name}/ask`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question, ...options })
      }
    );

    if (!response.ok) {
      throw new IrisError(await response.json());
    }

    return response.json();
  }

  async *stream(message: string): AsyncGenerator<Chunk> {
    const eventSource = new EventSource(
      `${this.baseUrl}/api/v1/teams/${this.name}/stream`,
      {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      }
    );

    const queue: Chunk[] = [];
    let resolve: ((value: Chunk) => void) | null = null;
    let done = false;

    eventSource.addEventListener('chunk', (e) => {
      const chunk = JSON.parse(e.data);
      if (resolve) {
        resolve(chunk);
        resolve = null;
      } else {
        queue.push(chunk);
      }
    });

    eventSource.addEventListener('complete', () => {
      done = true;
      eventSource.close();
      if (resolve) resolve(null as any);
    });

    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<Chunk>(r => { resolve = r; });
      }
    }
  }
}
```

---

This programmatic API transforms Iris MCP into **Claude Code as a Service**! 🚀
