# Iris MCP: Web Dashboard Addendum

**Sections to merge into existing README.md and ARCHITECTURE.md documents**

---

## 📋 For README.md

### Add after "Features" section:

---

## 🌐 Web Dashboard

Iris MCP includes a built-in **React web dashboard** for managing and monitoring your multi-agent coordination platform.

### Dashboard Features

- **Real-Time Team Overview** - See all configured teams and their status at a glance
- **Live Message Monitoring** - Watch messages flow between agents in real-time
- **Process Management** - View active Claude Code instances, their health, and resource usage
- **Interactive Team Management** - Add, edit, and remove teams through the UI
- **Message History Browser** - Search and review past conversations between teams
- **Analytics & Insights** - Track coordination patterns, response times, and team interactions
- **Manual Message Sending** - Send messages to teams directly from the dashboard
- **Process Controls** - Restart, terminate, or inspect individual agent processes
- **Notification Queue Viewer** - See pending async notifications per team
- **Health Monitoring** - Real-time health checks with visual status indicators

### Accessing the Dashboard

The dashboard runs alongside the MCP server on **http://localhost:3100** by default.

```bash
# Start Iris MCP (includes dashboard)
iris-mcp --port 3100

# Access dashboard in browser
open http://localhost:3100
```

### Dashboard Configuration

Configure dashboard settings in `iris-config.json`:

```json
{
  "dashboard": {
    "enabled": true,
    "port": 3100,
    "host": "localhost",
    "auth": {
      "enabled": false,
      "username": "admin",
      "password": "changeme"
    },
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000"]
    }
  }
}
```

### Dashboard Screenshots

**Team Overview:**
```
┌─────────────────────────────────────────────────────────────┐
│  Iris MCP Dashboard                                    🌈    │
├─────────────────────────────────────────────────────────────┤
│  Teams (3)                     Active Processes (2/10)      │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ 🟢 Frontend      │  │ 🟢 Backend       │               │
│  │                  │  │                  │               │
│  │ Status: Idle     │  │ Status: Active   │               │
│  │ Messages: 47     │  │ Messages: 132    │               │
│  │ Uptime: 2h 15m   │  │ Uptime: 3h 42m   │               │
│  │                  │  │                  │               │
│  │ [View] [Message] │  │ [View] [Message] │               │
│  └──────────────────┘  └──────────────────┘               │
│                                                              │
│  ┌──────────────────┐                                       │
│  │ ⚪ Mobile        │  [+ Add New Team]                    │
│  │                  │                                       │
│  │ Status: Stopped  │                                       │
│  │ Messages: 23     │                                       │
│  │ Last Active: 1h  │                                       │
│  │                  │                                       │
│  │ [Start] [View]   │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

**Live Message Stream:**
```
┌─────────────────────────────────────────────────────────────┐
│  Live Message Stream                           [Pause] [◼]  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  14:32:15  Frontend → Backend                               │
│  ├─ "What's your API versioning strategy?"                  │
│  └─ Status: Waiting for response...                         │
│                                                              │
│  14:31:42  Backend → Frontend                               │
│  ├─ "We use semantic versioning with /v1/, /v2/ prefixes"   │
│  └─ Completed in 3.2s                                       │
│                                                              │
│  14:28:09  Mobile → Backend                                 │
│  ├─ "Do you support push notifications?"                    │
│  └─ "Yes, using FCM and APNs"                              │
│                                                              │
│  [Load More] [Export] [Filter]                              │
└─────────────────────────────────────────────────────────────┘
```

**Analytics Dashboard:**
```
┌─────────────────────────────────────────────────────────────┐
│  Analytics & Insights                        Last 7 Days    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Total Messages: 1,247        Avg Response Time: 2.8s       │
│  Active Teams: 3              Peak Concurrent: 8            │
│                                                              │
│  Most Active Team Pairs:                                     │
│  ┌────────────────────────────────────────────┐            │
│  │ Frontend ↔ Backend     847 messages  █████ │            │
│  │ Backend ↔ Mobile       234 messages  ██    │            │
│  │ Frontend ↔ Mobile      166 messages  █     │            │
│  └────────────────────────────────────────────┘            │
│                                                              │
│  Response Time Trends:                                       │
│  [Interactive Chart showing response times over time]       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### Add to "Installation" section:

#### With Dashboard Enabled (Default)

```bash
# Install globally
npm install -g iris-mcp

# Start server with dashboard
iris-mcp

# Dashboard available at http://localhost:3100
# MCP server running on stdio
```

#### Dashboard-Only Mode

For monitoring existing Iris MCP instances:

```bash
# Run dashboard without starting MCP server
iris-mcp dashboard --connect stdio

# Or connect to remote MCP instance
iris-mcp dashboard --connect ws://remote-server:8080
```

---

### Add new "Configuration" section:

## ⚙️ Configuration

### iris-config.json

Complete configuration reference:

```json
{
  "version": "1.0.0",

  "mcp": {
    "name": "iris-mcp",
    "version": "1.0.0"
  },

  "processPool": {
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },

  "dashboard": {
    "enabled": true,
    "port": 3100,
    "host": "localhost",
    "auth": {
      "enabled": false,
      "username": "admin",
      "passwordHash": "$2b$10$..."
    },
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000"]
    },
    "websocket": {
      "enabled": true,
      "path": "/ws"
    },
    "rateLimit": {
      "windowMs": 60000,
      "maxRequests": 100
    }
  },

  "teams": {
    "frontend": {
      "path": "/projects/acme-frontend",
      "description": "React TypeScript frontend",
      "idleTimeout": 600000,
      "skipPermissions": true,
      "color": "#61dafb"
    },
    "backend": {
      "path": "/projects/acme-backend",
      "description": "Node.js Express API",
      "idleTimeout": 300000,
      "skipPermissions": true,
      "color": "#68a063"
    }
  },

  "notifications": {
    "enabled": true,
    "dbPath": "./data/notifications.db",
    "retentionDays": 30
  },

  "logging": {
    "level": "info",
    "format": "json",
    "outputs": ["stderr", "file"],
    "file": {
      "path": "./logs/iris-mcp.log",
      "maxSize": "10m",
      "maxFiles": 5
    }
  }
}
```

### Environment Variables

Override configuration with environment variables:

```bash
# Dashboard settings
IRIS_DASHBOARD_PORT=3100
IRIS_DASHBOARD_ENABLED=true
IRIS_DASHBOARD_AUTH_ENABLED=false

# Process pool settings
IRIS_IDLE_TIMEOUT=300000
IRIS_MAX_PROCESSES=10

# Paths
IRIS_CONFIG_PATH=/path/to/iris-config.json
IRIS_DATA_DIR=/path/to/data

# Logging
IRIS_LOG_LEVEL=debug
IRIS_LOG_FORMAT=json
```

---

## 📋 For ARCHITECTURE.md

### Add new top-level section after "System Components":

---

## 🌐 Web Dashboard Architecture

### Overview

The Iris MCP web dashboard is a **React SPA** served by an **Express.js server** that runs alongside the MCP server. It provides real-time monitoring, management, and analytics for your multi-agent coordination platform.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                          │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  React Dashboard App (SPA)                                  │ │
│  │                                                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │ │
│  │  │ Team Manager │  │ Live Monitor │  │ Analytics View  │  │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘  │ │
│  │                                                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │ │
│  │  │ Process View │  │ Message Send │  │ Settings Panel  │  │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│         │ HTTP/REST API              │ WebSocket (real-time)     │
└─────────┼────────────────────────────┼──────────────────────────┘
          │                            │
          ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              Express.js HTTP + WebSocket Server                  │
│                      (Port 3100)                                 │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  REST API Routes                                            │ │
│  │  • GET  /api/teams              - List all teams           │ │
│  │  • POST /api/teams              - Create team              │ │
│  │  • PUT  /api/teams/:id          - Update team              │ │
│  │  • GET  /api/processes          - List active processes    │ │
│  │  • POST /api/messages/send      - Send message             │ │
│  │  • GET  /api/messages/history   - Get message history      │ │
│  │  • GET  /api/analytics          - Get analytics data       │ │
│  │  • GET  /api/health             - Health check             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  WebSocket Server (/ws)                                     │ │
│  │  • Real-time process status updates                         │ │
│  │  • Live message stream                                      │ │
│  │  • Health check broadcasts                                  │ │
│  │  • Event notifications                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Static File Server                                         │ │
│  │  • Serves built React app (dist/)                           │ │
│  │  • Handles SPA routing fallback                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        │ IPC / Shared Memory
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                    Iris MCP Server Core                          │
│                   (stdio MCP Protocol)                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Shared State Manager                                       │ │
│  │  • ProcessPool reference                                    │ │
│  │  • NotificationQueue reference                              │ │
│  │  • TeamsConfig reference                                    │ │
│  │  • EventEmitter for updates                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Claude Process Pool                                        │ │
│  │  • Frontend (PID 12345, idle)                               │ │
│  │  • Backend  (PID 12346, processing)                         │ │
│  │  • Mobile   (PID 12347, idle)                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. Express.js Server (`src/dashboard/server.ts`)

**Responsibilities:**
- Serve React SPA
- Provide REST API for dashboard
- Handle WebSocket connections for real-time updates
- Manage authentication (optional)
- CORS and security middleware

**Key Routes:**

```typescript
// REST API
app.get('/api/teams', getTeams);
app.post('/api/teams', createTeam);
app.put('/api/teams/:id', updateTeam);
app.delete('/api/teams/:id', deleteTeam);

app.get('/api/processes', getActiveProcesses);
app.post('/api/processes/:team/restart', restartProcess);
app.delete('/api/processes/:team', terminateProcess);

app.post('/api/messages/send', sendMessage);
app.get('/api/messages/history', getMessageHistory);
app.get('/api/messages/stream', streamMessages);

app.get('/api/analytics', getAnalytics);
app.get('/api/health', healthCheck);

// WebSocket
io.on('connection', handleWebSocketConnection);
```

#### 2. React Dashboard (`src/dashboard/client/`)

**Tech Stack:**
- React 18 with TypeScript
- Vite for build tooling
- TanStack Query for data fetching
- Zustand for state management
- Recharts for analytics visualizations
- Socket.io-client for WebSocket
- Tailwind CSS for styling
- Lucide React for icons

**Key Components:**

```
src/dashboard/client/
├── src/
│   ├── App.tsx                    # Main app component
│   ├── main.tsx                   # Entry point
│   ├── components/
│   │   ├── TeamCard.tsx           # Individual team display
│   │   ├── TeamGrid.tsx           # Grid of all teams
│   │   ├── ProcessTable.tsx       # Active processes table
│   │   ├── MessageStream.tsx      # Live message feed
│   │   ├── MessageHistoryBrowser.tsx
│   │   ├── AnalyticsDashboard.tsx
│   │   ├── TeamEditor.tsx         # Add/edit team form
│   │   └── HealthIndicator.tsx    # Status badges
│   ├── pages/
│   │   ├── Dashboard.tsx          # Main dashboard view
│   │   ├── Teams.tsx              # Team management page
│   │   ├── Messages.tsx           # Message history page
│   │   ├── Analytics.tsx          # Analytics page
│   │   └── Settings.tsx           # Configuration page
│   ├── hooks/
│   │   ├── useWebSocket.ts        # WebSocket connection
│   │   ├── useTeams.ts            # Team data fetching
│   │   ├── useProcesses.ts        # Process data
│   │   └── useMessages.ts         # Message data
│   ├── api/
│   │   └── client.ts              # API client setup
│   └── stores/
│       └── dashboardStore.ts      # Global state
└── package.json
```

#### 3. Shared State Manager (`src/dashboard/state-manager.ts`)

**Responsibilities:**
- Bridge between MCP Server and Express Server
- Emit events when state changes
- Provide read access to internal state
- Track message history
- Aggregate analytics data

**Interface:**

```typescript
class StateManager extends EventEmitter {
  constructor(
    private processPool: ClaudeProcessPool,
    private notificationQueue: NotificationQueue,
    private config: TeamsConfig
  ) {
    super();
    this.setupListeners();
  }

  // Emit events for dashboard
  private setupListeners() {
    this.processPool.on('process-created', (team, pid) => {
      this.emit('process-status-change', { team, status: 'created', pid });
    });

    this.processPool.on('process-terminated', (team) => {
      this.emit('process-status-change', { team, status: 'terminated' });
    });

    this.processPool.on('message-sent', (from, to, message) => {
      this.emit('message', { from, to, message, timestamp: Date.now() });
      this.recordMessage(from, to, message);
    });
  }

  // API methods for dashboard
  getTeams(): Team[] { ... }
  getActiveProcesses(): ProcessInfo[] { ... }
  getMessageHistory(filters?: any): Message[] { ... }
  getAnalytics(timeRange?: string): Analytics { ... }

  // Write operations
  async sendMessage(from: string, to: string, message: string): Promise<void> { ... }
  async restartProcess(team: string): Promise<void> { ... }
}
```

#### 4. WebSocket Event System

**Real-time Events:**

```typescript
// Server → Client events
{
  'process-status': {
    team: string;
    status: 'spawning' | 'idle' | 'processing' | 'terminating';
    pid?: number;
    metrics?: ProcessMetrics;
  },

  'message-sent': {
    id: string;
    from: string;
    to: string;
    message: string;
    timestamp: number;
  },

  'message-response': {
    id: string;
    from: string;
    to: string;
    response: string;
    duration: number;
    timestamp: number;
  },

  'health-check': {
    team: string;
    healthy: boolean;
    lastCheck: number;
  },

  'analytics-update': {
    totalMessages: number;
    activeProcesses: number;
    avgResponseTime: number;
  }
}

// Client → Server events
{
  'subscribe': {
    channels: string[]; // ['teams', 'messages', 'processes']
  },

  'send-message': {
    from: string;
    to: string;
    message: string;
  }
}
```

### Data Flow Examples

#### 1. User Sends Message via Dashboard

```
User clicks "Send Message" in dashboard
         ↓
React Component → API POST /api/messages/send
         ↓
Express Route Handler
         ↓
StateManager.sendMessage(from, to, message)
         ↓
ProcessPool.getOrCreateProcess(to)
         ↓
ClaudeProcess.sendMessage(message)
         ↓
Claude Code Instance processes via stdio
         ↓
Response received
         ↓
StateManager emits 'message-response' event
         ↓
WebSocket broadcasts to all connected clients
         ↓
React Component updates UI with response
```

#### 2. Real-time Process Status Update

```
ClaudeProcess changes status to 'processing'
         ↓
Emits 'status-change' event
         ↓
ProcessPool listener catches event
         ↓
ProcessPool emits to StateManager
         ↓
StateManager emits 'process-status' event
         ↓
WebSocket server broadcasts to clients
         ↓
React useWebSocket hook receives update
         ↓
Zustand store updates state
         ↓
UI re-renders with new status badge
```

### Database Schema for Message History

```sql
-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_team TEXT NOT NULL,
  to_team TEXT NOT NULL,
  message TEXT NOT NULL,
  response TEXT,
  status TEXT DEFAULT 'pending', -- pending, completed, failed
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);

CREATE INDEX idx_messages_teams ON messages(from_team, to_team);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_status ON messages(status);

-- Analytics aggregations (materialized view)
CREATE TABLE message_stats (
  date TEXT PRIMARY KEY,
  total_messages INTEGER,
  avg_response_time REAL,
  by_team TEXT, -- JSON object
  by_pair TEXT  -- JSON object
);
```

### Security Considerations

#### Authentication (Optional)

```typescript
// Basic authentication
app.use('/api', (req, res, next) => {
  if (!config.dashboard.auth.enabled) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const [username, password] = Buffer
    .from(authHeader.split(' ')[1], 'base64')
    .toString()
    .split(':');

  if (username === config.dashboard.auth.username &&
      bcrypt.compareSync(password, config.dashboard.auth.passwordHash)) {
    next();
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});
```

#### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: config.dashboard.rateLimit.windowMs,
  max: config.dashboard.rateLimit.maxRequests,
  message: 'Too many requests from this IP'
});

app.use('/api', limiter);
```

#### CORS Configuration

```typescript
import cors from 'cors';

app.use(cors({
  origin: config.dashboard.cors.origins,
  credentials: true
}));
```

### Performance Optimizations

#### 1. Message History Pagination

```typescript
app.get('/api/messages/history', async (req, res) => {
  const { page = 1, limit = 50, from, to } = req.query;

  const offset = (page - 1) * limit;
  const messages = await db.getMessages({
    from,
    to,
    limit,
    offset
  });

  res.json({
    messages,
    pagination: {
      page,
      limit,
      total: await db.countMessages({ from, to })
    }
  });
});
```

#### 2. WebSocket Connection Pooling

```typescript
// Only broadcast to subscribed clients
const subscriptions = new Map<string, Set<string>>();

socket.on('subscribe', ({ channels }) => {
  const socketId = socket.id;
  channels.forEach(channel => {
    if (!subscriptions.has(channel)) {
      subscriptions.set(channel, new Set());
    }
    subscriptions.get(channel)!.add(socketId);
  });
});

function broadcast(channel: string, data: any) {
  const subscribers = subscriptions.get(channel);
  if (subscribers) {
    subscribers.forEach(socketId => {
      io.to(socketId).emit(channel, data);
    });
  }
}
```

#### 3. Analytics Caching

```typescript
const analyticsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

app.get('/api/analytics', (req, res) => {
  const cacheKey = 'analytics';
  const cached = analyticsCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  const data = stateManager.getAnalytics();
  analyticsCache.set(cacheKey, { data, timestamp: Date.now() });
  res.json(data);
});
```

### Build & Deployment

#### Development Mode

```bash
# Terminal 1: Start MCP server with dashboard
npm run dev

# Terminal 2: Start React dev server (hot reload)
cd src/dashboard/client
npm run dev

# Dashboard available at http://localhost:5173 (Vite dev server)
# Proxies API requests to http://localhost:3100
```

#### Production Build

```bash
# Build React app
cd src/dashboard/client
npm run build
# Output: dist/

# Copy to Express static directory
cp -r dist ../../dist/dashboard/public/

# Build entire project
npm run build

# Start production server
npm start
```

#### Docker Deployment

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY src/dashboard/client/package*.json ./src/dashboard/client/

# Install dependencies
RUN npm ci --production
RUN cd src/dashboard/client && npm ci

# Build dashboard
COPY src/dashboard/client ./src/dashboard/client
RUN cd src/dashboard/client && npm run build

# Copy server code
COPY . .
RUN npm run build

EXPOSE 3100

CMD ["npm", "start"]
```

---

### Add to "Testing & Debugging" section:

#### Dashboard Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/dashboard/server';

describe('Dashboard API', () => {
  it('GET /api/teams returns all teams', async () => {
    const response = await request(app)
      .get('/api/teams')
      .expect(200);

    expect(response.body).toHaveProperty('teams');
    expect(Array.isArray(response.body.teams)).toBe(true);
  });

  it('POST /api/messages/send sends message', async () => {
    const response = await request(app)
      .post('/api/messages/send')
      .send({
        from: 'frontend',
        to: 'backend',
        message: 'Test message'
      })
      .expect(200);

    expect(response.body).toHaveProperty('messageId');
  });

  it('GET /api/processes returns active processes', async () => {
    const response = await request(app)
      .get('/api/processes')
      .expect(200);

    expect(response.body).toHaveProperty('processes');
  });
});
```

#### WebSocket Testing

```typescript
import { io, Socket } from 'socket.io-client';

describe('WebSocket Events', () => {
  let socket: Socket;

  beforeEach((done) => {
    socket = io('http://localhost:3100');
    socket.on('connect', done);
  });

  afterEach(() => {
    socket.close();
  });

  it('receives process-status events', (done) => {
    socket.on('process-status', (data) => {
      expect(data).toHaveProperty('team');
      expect(data).toHaveProperty('status');
      done();
    });

    // Trigger a process status change
    // ...
  });
});
```

---

## 🎨 Dashboard UI/UX Design

### Design System

**Colors (Iris Theme):**
```css
:root {
  /* Primary - Iridescent gradient */
  --iris-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --iris-accent: #667eea;

  /* Status colors */
  --status-idle: #10b981;      /* Green */
  --status-processing: #f59e0b; /* Amber */
  --status-error: #ef4444;      /* Red */
  --status-offline: #6b7280;    /* Gray */

  /* Background */
  --bg-primary: #0f172a;        /* Dark blue */
  --bg-secondary: #1e293b;
  --bg-card: #334155;

  /* Text */
  --text-primary: #f1f5f9;
  --text-secondary: #cbd5e1;
}
```

**Typography:**
- Headings: Inter (sans-serif)
- Body: Inter
- Code: JetBrains Mono

### Component Library

All dashboard components use Tailwind CSS with the iris theme and Lucide React icons for consistency.

---
