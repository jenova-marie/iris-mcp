# HTTP/WebSocket API Documentation (Phase 3)

**Location:** `src/api/` (Future)
**Status:** Not Yet Implemented
**Purpose:** External integrations via HTTP and WebSocket
**Target Release:** Phase 3

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Design](#architecture-design)
4. [REST API Endpoints](#rest-api-endpoints)
5. [WebSocket Streams](#websocket-streams)
6. [Authentication](#authentication)
7. [Rate Limiting](#rate-limiting)
8. [Integration Examples](#integration-examples)

---

## Overview

Phase 3 will introduce **HTTP and WebSocket transports** alongside the existing MCP (stdio) transport. This enables:

- **Web Applications:** React/Vue/Angular apps coordinating teams
- **CI/CD Pipelines:** GitHub Actions, GitLab CI triggering Iris
- **Monitoring Tools:** Prometheus, Grafana querying Iris status
- **Mobile Apps:** iOS/Android interfacing with teams
- **Third-Party Integrations:** Slack, Discord, email notifications

**Design Principle:** API mirrors MCP tools exactly. Every MCP tool has corresponding HTTP endpoint.

---

## Technology Stack

**Backend:**
- **Express.js** (^4.18.2): HTTP server
- **Socket.io** (^4.6.0): WebSocket connections with fallback
- **express-rate-limit**: Rate limiting middleware
- **helmet**: Security headers
- **cors**: Cross-origin resource sharing

**Why These Choices:**
- Express: Industry standard, massive ecosystem
- Socket.io: Automatic reconnection, room support, fallback to polling
- Already installed in Phase 1 for future-proofing

---

## Architecture Design

### Dual Transport Model

```
┌────────────────────────────────────────────────────────────────┐
│                    External Clients                             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Claude Code  │  │  Web App     │  │  cURL/API    │        │
│  │   (stdio)    │  │ (WebSocket)  │  │   (HTTP)     │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
└─────────┼──────────────────┼──────────────────┼───────────────┘
          │                  │                  │
          │ MCP Protocol     │ WebSocket        │ HTTP
          │ (stdio)          │                  │
          ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────────┐
│                     Iris MCP Server                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               Transport Layer                            │  │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────────┐       │  │
│  │  │ MCP stdio │  │  Express   │  │  Socket.io   │       │  │
│  │  │  Server   │  │  REST API  │  │  WebSocket   │       │  │
│  │  └─────┬─────┘  └──────┬─────┘  └──────┬───────┘       │  │
│  └────────┼────────────────┼────────────────┼──────────────┘  │
│           │                │                │                  │
│           └────────────────┴────────────────┘                  │
│                            │                                   │
│                            ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Iris Orchestrator (THE BRAIN)                  │  │
│  │  (Same business logic regardless of transport)           │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**Key Insight:** Transport layer is **thin**. All business logic remains in Iris, Cache, ProcessPool, SessionManager. API just provides HTTP/WS interface.

---

## REST API Endpoints

### Base URL

```
http://localhost:1615/api
```

Configurable via `config.yaml`:
```json
{
  "settings": {
    "httpPort": 1615
  }
}
```

### Endpoint Catalog

#### Team Communication

**POST /api/teams/tell**
Send message to team

```bash
curl -X POST http://localhost:1615/api/teams/tell \
  -H "Content-Type: application/json" \
  -d '{
    "toTeam": "backend",
    "message": "What is the API status?",
    "fromTeam": "frontend",
    "timeout": 30000
  }'
```

Response:
```json
{
  "from": "frontend",
  "to": "backend",
  "message": "What is the API status?",
  "response": "All APIs operational",
  "duration": 2500,
  "timestamp": 1697567890123,
  "async": false
}
```

#### Process Management

**POST /api/teams/:teamName/wake**
Wake up team

```bash
curl -X POST http://localhost:1615/api/teams/backend/wake
```

Response:
```json
{
  "team": "backend",
  "status": "awake",
  "sessionId": "abc123-...",
  "duration": 150,
  "timestamp": 1697567890123
}
```

**POST /api/teams/:teamName/sleep**
Put team to sleep

```bash
curl -X POST http://localhost:1615/api/teams/backend/sleep \
  -H "Content-Type: application/json" \
  -d '{"force": false}'
```

**POST /api/teams/wake-all**
Wake all teams

```bash
curl -X POST http://localhost:1615/api/teams/wake-all
```

**GET /api/teams/:teamName/status**
Check if team is awake

```bash
curl http://localhost:1615/api/teams/backend/status
```

Response:
```json
{
  "team": "backend",
  "awake": true,
  "timestamp": 1697567890123
}
```

#### System Queries

**GET /api/teams**
List all teams

```bash
curl http://localhost:1615/api/teams?includeProcessDetails=true
```

Response:
```json
{
  "teams": [
    {
      "name": "backend",
      "status": "awake",
      "config": {
        "path": "/Users/jenova/projects/backend",
        "description": "Backend services"
      },
      "process": {
        "messageCount": 42
      }
    }
  ],
  "totalTeams": 3,
  "awakeTeams": 1,
  "asleepTeams": 2,
  "timestamp": 1697567890123
}
```

**GET /api/status**
Get Iris system status

```bash
curl http://localhost:1615/api/status
```

Response:
```json
{
  "sessions": {
    "total": 15,
    "active": 12
  },
  "processes": {
    "total": 8,
    "maxProcesses": 10
  },
  "uptime": 3600000,
  "version": "1.0.0"
}
```

#### Cache Management

**GET /api/cache/:sessionId**
Read cache

```bash
curl http://localhost:1615/api/cache/abc123-.../read?includeMessages=true
```

**DELETE /api/cache/:sessionId**
Clear cache

```bash
curl -X DELETE http://localhost:1615/api/cache/abc123-...
```

---

## WebSocket Streams

### Connection

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:1615', {
  transports: ['websocket', 'polling'],  // Fallback to polling
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10
});

socket.on('connect', () => {
  console.log('Connected to Iris');
});
```

### Event Types

#### 1. Real-Time Cache Messages

**Subscribe to session:**
```javascript
socket.emit('cache:subscribe', { sessionId: 'abc123-...' });

socket.on('cache:message', (data) => {
  console.log('New message:', data);
  // {
  //   sessionId: 'abc123-...',
  //   message: {
  //     timestamp: 1697567890123,
  //     type: 'assistant',
  //     data: { ... }
  //   }
  // }
});
```

**Unsubscribe:**
```javascript
socket.emit('cache:unsubscribe', { sessionId: 'abc123-...' });
```

#### 2. Process Lifecycle Events

**Subscribe to process events:**
```javascript
socket.emit('process:subscribe', { team: 'backend' });

socket.on('process:spawned', (data) => {
  console.log('Process spawned:', data);
  // { team: 'backend', pid: 12345 }
});

socket.on('process:terminated', (data) => {
  console.log('Process terminated:', data);
  // { team: 'backend' }
});

socket.on('process:error', (data) => {
  console.log('Process error:', data);
  // { team: 'backend', error: 'Spawn failed' }
});
```

#### 3. System Health

**Subscribe to health checks:**
```javascript
socket.on('health:check', (data) => {
  console.log('Health check:', data);
  // { totalProcesses: 8, maxProcesses: 10, ... }
});
```

#### 4. Tell Streaming (Real-Time Response)

**Send tell and stream response:**
```javascript
socket.emit('tell:start', {
  toTeam: 'backend',
  message: 'Generate report',
  fromTeam: 'frontend'
});

// Receive chunks as they arrive
socket.on('tell:chunk', (data) => {
  console.log('Chunk:', data.chunk);
  // Partial response text
});

// Receive completion
socket.on('tell:complete', (data) => {
  console.log('Complete:', data.response);
});

// Receive errors
socket.on('tell:error', (data) => {
  console.error('Error:', data.error);
});
```

### Room-Based Broadcasting

**Implementation uses Socket.io rooms:**

```typescript
// Iris emits events to specific rooms
io.to(`session:${sessionId}`).emit('cache:message', message);
io.to(`team:${teamName}`).emit('process:spawned', data);
io.to('system').emit('health:check', status);
```

---

## Authentication

### API Key Authentication

**Configuration:**
```json
{
  "api": {
    "enabled": true,
    "requireAuth": true,
    "apiKeys": [
      {
        "key": "iris_sk_abc123...",
        "name": "CI/CD Pipeline",
        "permissions": ["tell", "wake", "status"]
      },
      {
        "key": "iris_sk_def456...",
        "name": "Monitoring Dashboard",
        "permissions": ["status", "cache:read"]
      }
    ]
  }
}
```

**Usage:**
```bash
curl -H "Authorization: Bearer iris_sk_abc123..." \
  http://localhost:1615/api/teams
```

**WebSocket:**
```javascript
const socket = io('http://localhost:1615', {
  auth: {
    token: 'iris_sk_abc123...'
  }
});
```

### Permission System

**Permissions:**
- `tell`: Send messages
- `wake`: Start processes
- `sleep`: Stop processes
- `status`: Read system status
- `cache:read`: Read cache
- `cache:write`: Clear cache
- `admin`: All permissions

**Enforcement:**
```typescript
function requirePermission(permission: string) {
  return (req, res, next) => {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    const key = findApiKey(apiKey);

    if (!key || !key.permissions.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

app.post('/api/teams/tell', requirePermission('tell'), async (req, res) => {
  // ...
});
```

---

## Rate Limiting

**Implementation:**

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests per window
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
```

**Per-Endpoint Limits:**

```typescript
const tellLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,              // 10 tells per minute
});

app.post('/api/teams/tell', tellLimiter, async (req, res) => {
  // ...
});
```

---

## Integration Examples

### React Dashboard

```typescript
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

function TeamDashboard() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const socket = io('http://localhost:1615');

    socket.emit('cache:subscribe', { sessionId: 'abc123-...' });

    socket.on('cache:message', (data) => {
      setMessages(prev => [...prev, data.message]);
    });

    return () => socket.disconnect();
  }, []);

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.timestamp}>{msg.data.text}</div>
      ))}
    </div>
  );
}
```

### GitHub Actions Integration

```yaml
name: Deploy
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Tell DevOps team to deploy
        run: |
          curl -X POST ${{ secrets.IRIS_URL }}/api/teams/tell \
            -H "Authorization: Bearer ${{ secrets.IRIS_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "toTeam": "devops",
              "message": "Deploy main branch to production",
              "timeout": 60000
            }'
```

### Python Monitoring Script

```python
import requests
import time

IRIS_URL = "http://localhost:1615"

while True:
    # Check all teams
    response = requests.get(f"{IRIS_URL}/api/teams")
    teams = response.json()

    # Alert if any team is down
    for team in teams['teams']:
        if team['status'] == 'asleep':
            print(f"⚠️ Team {team['name']} is asleep!")

    time.sleep(60)
```

---

## Error Responses

**Standard Error Format:**

```json
{
  "error": "ValidationError",
  "message": "Team name is required",
  "statusCode": 400,
  "timestamp": 1697567890123
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (validation error)
- `401`: Unauthorized (missing/invalid API key)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (team doesn't exist)
- `408`: Request Timeout
- `429`: Too Many Requests (rate limit)
- `500`: Internal Server Error
- `503`: Service Unavailable (pool limit reached)

---

## Implementation Roadmap

**Phase 3.1: Basic REST API**
- [ ] Express server setup
- [ ] Authentication middleware
- [ ] Rate limiting
- [ ] REST endpoints for all MCP tools
- [ ] Error handling

**Phase 3.2: WebSocket Streams**
- [ ] Socket.io integration
- [ ] Real-time cache streaming
- [ ] Process lifecycle events
- [ ] Room-based broadcasting

**Phase 3.3: Advanced Features**
- [ ] Webhook support
- [ ] GraphQL API
- [ ] OpenAPI/Swagger docs
- [ ] Client SDKs (JS, Python, Go)

---

**Document Version:** 1.0 (Planned)
**Last Updated:** October 2025
**Status:** Design Phase
