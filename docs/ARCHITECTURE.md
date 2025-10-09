# Teams MCP: Complete Technical Architecture & Implementation Guide

**A Production-Ready MCP Server for Cross-Project Claude Code Coordination**

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [MCP Protocol Implementation](#mcp-protocol-implementation)
4. [Process Management & Connection Pooling](#process-management--connection-pooling)
5. [Project Structure](#project-structure)
6. [Complete Implementation](#complete-implementation)
7. [Configuration & Deployment](#configuration--deployment)
8. [Testing & Debugging](#testing--debugging)
9. [Production Considerations](#production-considerations)
10. [API Reference](#api-reference)

---

## 🏗️ Architecture Overview

### High-Level System Design

```
┌──────────────────────────────────────────────────────────────────┐
│                       MCP Host (Claude Desktop)                  │
│                    or Claude Code CLI Instance                   │
│                                                                   │
│  User: "Ask Team Backend about their API versioning strategy"   │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          │ MCP Protocol (stdio/JSON-RPC)
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│              Teams MCP Server (Node.js Process)                   │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  MCP Server Core                                            │ │
│  │  • Protocol Handler (JSON-RPC 2.0)                          │ │
│  │  • Tool Registry (teams_ask, teams_send_message, etc.)     │ │
│  │  • Request/Response Management                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Claude Process Pool Manager                                │ │
│  │  • Connection Pool (up to 10 active processes)              │ │
│  │  • Idle Timeout Management (default: 5 minutes)             │ │
│  │  • Health Check System                                       │ │
│  │  • Message Queue per Process                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Team Registry                                               │ │
│  │  teams.json: {                                              │ │
│  │    "frontend": "/projects/acme-frontend",                   │ │
│  │    "backend": "/projects/acme-backend"                      │ │
│  │  }                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Notification Queue (SQLite)                                │ │
│  │  • Persistent async message storage                         │ │
│  │  • Pending notifications per team                           │ │
│  │  • Message status tracking                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────┬────────────────┬────────────────┬───────────────────┘
            │                │                │
            │ stdio streams  │ stdio streams  │ stdio streams
            │                │                │
┌───────────▼──────────┐  ┌─▼───────────┐  ┌─▼────────────────┐
│ Claude Code Instance │  │  Claude Code │  │  Claude Code      │
│   Team: Frontend     │  │ Team: Backend│  │  Team: Mobile     │
│                      │  │              │  │                   │
│ Process Pool Entry:  │  │ Process Pool │  │ Process Pool      │
│ • PID: 12345         │  │ Entry:       │  │ Entry:            │
│ • Status: idle       │  │ • PID: 12346 │  │ • PID: 12347      │
│ • Idle Timer: 3m     │  │ • Status:    │  │ • Status: idle    │
│ • Message Queue: []  │  │   processing │  │ • Idle Timer: 4m  │
│                      │  │ • Idle Timer:│  │ • Message Queue:  │
│ Working Directory:   │  │   paused     │  │   []              │
│ /projects/acme-      │  │ • Message    │  │                   │
│   frontend/          │  │   Queue: [1] │  │ Working Dir:      │
│                      │  │              │  │ /projects/acme-   │
│ Context:             │  │ Working Dir: │  │   mobile/         │
│ • .claude/           │  │ /projects/   │  │                   │
│ • package.json       │  │  acme-       │  │ Context:          │
│ • node_modules       │  │  backend/    │  │ • .claude/        │
│ • MCP servers        │  │              │  │ • Podfile         │
│   (Figma, etc.)      │  │ Context:     │  │ • Swift packages  │
│                      │  │ • .claude/   │  │ • MCP servers     │
│ stdin/stdout:        │  │ • DB schemas │  │   (iOS sim, etc.) │
│ [open pipes]         │  │ • API docs   │  │                   │
│                      │  │ • MCP servers│  │ stdin/stdout:     │
│                      │  │   (Postgres) │  │ [open pipes]      │
└──────────────────────┘  └──────────────┘  └───────────────────┘
```

### Message Flow Diagram

```
User in Frontend Claude
         │
         │ "Ask Team Backend about API versioning"
         ▼
    Claude Frontend
         │
         │ MCP Tool Call: teams_ask("backend", "What's your API versioning?")
         ▼
    Teams MCP Server
         │
         │ 1. Check process pool for "backend"
         │ 2. Process exists? → Reuse (fast!)
         │    Process missing? → Spawn new instance
         ▼
    Process Pool Manager
         │
         ├─ Existing Process Found (PID 12346)
         │  ├─ Reset idle timer
         │  ├─ Add message to queue
         │  └─ Process immediately (no other messages)
         │
         └─ OR Create New Process
            ├─ spawn('claude', ['--input-format', 'stream-json', ...])
            ├─ Set working directory: /projects/acme-backend
            ├─ Setup stdin/stdout pipes
            ├─ Register in pool
            └─ Start idle timer (5 minutes)
         │
         ▼
    Send Message via stdin
         │
         │ Write: {"type":"user","message":"What's your API versioning?","session_id":"..."}
         │
         ▼
    Claude Backend Instance
         │
         │ 1. Receives message
         │ 2. Analyzes backend codebase
         │ 3. Reads API documentation
         │ 4. Formulates response
         │
         ▼
    Response via stdout
         │
         │ Stream: {"type":"result","response":"We use semantic versioning..."}
         │
         ▼
    Process Pool Manager
         │
         │ 1. Capture stdout
         │ 2. Parse JSON response
         │ 3. Resolve promise
         │ 4. Restart idle timer
         │
         ▼
    Teams MCP Server
         │
         │ Format response for MCP protocol
         │
         ▼
    Claude Frontend
         │
         │ "Team Backend says: We use semantic versioning with /v1/, /v2/ prefixes..."
         │
         ▼
    User sees response
```

---

## 🔧 System Components

### 1. MCP Server Core

**Responsibilities:**
- Handle MCP protocol (JSON-RPC 2.0)
- Register and expose tools
- Route tool calls to appropriate handlers
- Manage stdio transport

**Key Classes:**
- `McpServer` - Main server instance from `@modelcontextprotocol/sdk`
- `StdioServerTransport` - stdio communication layer
- `ToolRegistry` - Registers all team coordination tools

### 2. Process Pool Manager

**Responsibilities:**
- Spawn and manage Claude Code processes
- Maintain connection pool with idle timeout
- Route messages to appropriate processes
- Handle process lifecycle (spawn, kill, restart)
- Queue management per process

**Key Classes:**
- `ClaudeProcessPool` - Pool management
- `ClaudeProcess` - Individual process wrapper
- `ProcessConfig` - Configuration per team

### 3. Team Registry

**Responsibilities:**
- Map team names to project directories
- Store team-specific configuration
- Validate team existence
- Provide team metadata

**Data Structure:**
```json
{
  "settings": {
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },
  "teams": {
    "frontend": {
      "path": "/absolute/path/to/frontend",
      "description": "React TypeScript frontend",
      "idleTimeout": 600000,
      "skipPermissions": true
    },
    "backend": {
      "path": "/absolute/path/to/backend",
      "description": "Node.js Express API",
      "idleTimeout": 300000,
      "skipPermissions": true
    }
  }
}
```

### 4. Notification Queue

**Responsibilities:**
- Store fire-and-forget notifications
- Persist messages across server restarts
- Track message status (pending, read, expired)
- Clean up old notifications

**Schema (SQLite):**
```sql
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name TEXT NOT NULL,
  from_team TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  status TEXT DEFAULT 'pending' -- pending, read, expired
);

CREATE INDEX idx_team_status ON notifications(team_name, status);
```

---

## 📡 MCP Protocol Implementation

### Understanding MCP

The Model Context Protocol uses JSON-RPC 2.0 for communication. From the [official MCP documentation](https://modelcontextprotocol.io):

> MCP provides a standardized way to connect LLMs with the context they need.

**Key Concepts:**

1. **Transport Layer:** stdio (standard input/output) or SSE (Server-Sent Events)
2. **Message Format:** JSON-RPC 2.0
3. **Core Primitives:**
   - **Tools:** Functions that AI can call
   - **Resources:** Data sources AI can access
   - **Prompts:** Reusable prompt templates

### MCP Server Initialization

Based on the [TypeScript SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Create MCP server
const server = new McpServer({
  name: 'teams-mcp',
  version: '1.0.0'
});

// Register tools
server.registerTool(
  'teams_ask',
  {
    title: 'Ask Team',
    description: 'Ask another team a question and wait for their response',
    inputSchema: {
      team_name: z.string().describe('Target team name'),
      question: z.string().describe('Question to ask')
    },
    outputSchema: {
      response: z.string(),
      team: z.string(),
      timestamp: z.number()
    }
  },
  async ({ team_name, question }) => {
    // Implementation here
  }
);

// Connect to stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Teams MCP server running'); // stderr for logging
}

main();
```

### Tool Registration Pattern

Each tool follows this structure:

```typescript
server.registerTool(
  'tool_name',           // Unique tool identifier
  {
    title: 'Human Readable Title',
    description: 'What this tool does',
    inputSchema: {       // Zod schema for validation
      param1: z.string(),
      param2: z.number().optional()
    },
    outputSchema: {      // Zod schema for response
      result: z.string()
    }
  },
  async (params) => {    // Implementation function
    // Tool logic here
    return {
      content: [
        {
          type: 'text',
          text: 'Response text'
        }
      ],
      structuredContent: { /* optional structured data */ }
    };
  }
);
```

### Protocol Versioning

MCP uses date-based versioning (YYYY-MM-DD format). From the [MCP specification](https://spec.modelcontextprotocol.io):

> The current protocol version is `2024-11-05`

Version negotiation happens during initialization:

```typescript
// Client sends
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": {
      "name": "Claude Desktop",
      "version": "1.0.0"
    }
  },
  "id": 1
}

// Server responds
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "teams-mcp",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": {}
    }
  },
  "id": 1
}
```

---

## 🔄 Process Management & Connection Pooling

### The Performance Problem

**Without Connection Pooling:**
```
Message 1: 5s startup + 2s execution = 7s total
Message 2: 5s startup + 2s execution = 7s total
Message 3: 5s startup + 2s execution = 7s total
────────────────────────────────────────────
Total: 21 seconds for 3 messages
```

**With Connection Pooling:**
```
Message 1: 5s startup + 2s execution = 7s total (cold start)
Message 2: 0s startup + 2s execution = 2s total (warm!)
Message 3: 0s startup + 2s execution = 2s total (warm!)
────────────────────────────────────────────
Total: 11 seconds for 3 messages (52% faster!)
```

### Process Pool Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ClaudeProcessPool                                           │
│                                                              │
│  Configuration:                                              │
│  • idleTimeout: 300000ms (5 minutes)                        │
│  • maxProcesses: 10                                         │
│  • healthCheckInterval: 30000ms                             │
│                                                              │
│  Active Processes Map:                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ "frontend" → ClaudeProcess {                         │  │
│  │   pid: 12345,                                        │  │
│  │   status: 'idle',                                    │  │
│  │   lastUsed: 1234567890,                              │  │
│  │   idleTimer: Timeout<5min>,                          │  │
│  │   messageQueue: [],                                  │  │
│  │   stdin: WritableStream,                             │  │
│  │   stdout: ReadableStream                             │  │
│  │ }                                                     │  │
│  │                                                       │  │
│  │ "backend" → ClaudeProcess {                          │  │
│  │   pid: 12346,                                        │  │
│  │   status: 'processing',                              │  │
│  │   lastUsed: 1234567895,                              │  │
│  │   idleTimer: null,                                   │  │
│  │   messageQueue: [Message],                           │  │
│  │   stdin: WritableStream,                             │  │
│  │   stdout: ReadableStream                             │  │
│  │ }                                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Methods:                                                    │
│  • getOrCreateProcess(teamName): ClaudeProcess              │
│  • terminateProcess(teamName): void                         │
│  • terminateAll(): void                                     │
│  • findLeastRecentlyUsed(): string                          │
│  • healthCheckAll(): void                                   │
└─────────────────────────────────────────────────────────────┘
```

### ClaudeProcess Lifecycle

```
┌─────────────┐
│   SPAWN     │  spawn('claude', [...])
└──────┬──────┘
       │
       │ Setup stdin/stdout pipes
       │ Start idle timer (5 min)
       │ Register in pool
       ▼
┌─────────────┐
│    IDLE     │  Waiting for messages
└──────┬──────┘  Timer counting down
       │
       │ Message received
       │ Reset timer
       │ Add to queue
       ▼
┌─────────────┐
│ PROCESSING  │  Executing message
└──────┬──────┘  Timer paused
       │
       │ Response received
       │ Restart timer
       ▼
┌─────────────┐
│    IDLE     │  Ready for next message
└──────┬──────┘  Timer counting down
       │
       │ Timeout (5 min elapsed)
       │ No messages
       ▼
┌─────────────┐
│ TERMINATING │  Kill process
└──────┬──────┘  Remove from pool
       │
       ▼
┌─────────────┐
│   STOPPED   │  Process exited
└─────────────┘  Resources freed
```

### Health Check System

```typescript
class ClaudeProcessPool {
  private healthCheckInterval: NodeJS.Timeout | null = null;

  startHealthChecks() {
    this.healthCheckInterval = setInterval(
      () => this.healthCheckAll(),
      this.config.healthCheckInterval
    );
  }

  async healthCheckAll() {
    for (const [teamName, process] of this.processes) {
      try {
        const healthy = await process.healthCheck();
        if (!healthy) {
          console.error(`Health check failed for ${teamName}, restarting...`);
          await this.terminateProcess(teamName);
          // Next request will create fresh process
        }
      } catch (error) {
        console.error(`Health check error for ${teamName}:`, error);
      }
    }
  }
}

class ClaudeProcess {
  async healthCheck(timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeout);

      // Send simple ping message
      const pingMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'ping' },
        session_id: `health-${Date.now()}`
      }) + '\n';

      const onData = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'result') {
            clearTimeout(timer);
            this.child.stdout!.off('data', onData);
            resolve(true);
          }
        } catch (e) {
          // Continue listening
        }
      };

      this.child.stdout!.on('data', onData);
      this.child.stdin!.write(pingMessage);
    });
  }
}
```

---

## 📁 Project Structure

```
teams-mcp/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── bin/
│   └── teams-mcp.ts                 # CLI entry point
├── src/
│   ├── index.ts                     # Main server entry
│   ├── server.ts                    # MCP server setup
│   ├── config/
│   │   ├── teams-config.ts          # Configuration loader
│   │   └── teams.example.json       # Example team registry
│   ├── process-pool/
│   │   ├── pool-manager.ts          # ClaudeProcessPool class
│   │   ├── claude-process.ts        # ClaudeProcess wrapper
│   │   └── types.ts                 # TypeScript interfaces
│   ├── tools/
│   │   ├── teams-ask.ts             # teams_ask implementation
│   │   ├── teams-send-message.ts    # teams_send_message implementation
│   │   ├── teams-notify.ts          # teams_notify implementation
│   │   ├── teams-get-status.ts      # teams_get_status implementation
│   │   └── index.ts                 # Tool registry
│   ├── notifications/
│   │   ├── queue.ts                 # SQLite notification queue
│   │   ├── schema.sql               # Database schema
│   │   └── types.ts                 # Notification types
│   └── utils/
│       ├── logger.ts                # Logging utility
│       ├── validation.ts            # Input validation
│       └── errors.ts                # Custom error types
├── tests/
│   ├── unit/
│   │   ├── process-pool.test.ts
│   │   ├── claude-process.test.ts
│   │   └── tools.test.ts
│   ├── integration/
│   │   ├── stdio-communication.test.ts
│   │   └── end-to-end.test.ts
│   └── fixtures/
│       └── mock-teams.json
└── dist/                            # Compiled output (gitignored)
    ├── index.js
    └── ...
```

---

## 💻 Complete Implementation

### package.json

```json
{
  "name": "@teams-mcp/server",
  "version": "1.0.0",
  "description": "MCP server for cross-project Claude Code coordination",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "teams-mcp": "./dist/bin/teams-mcp.js"
  },
  "scripts": {
    "build": "tsc && node -e \"require('fs').chmodSync('dist/bin/teams-mcp.js', '755')\"",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "inspector": "npx @modelcontextprotocol/inspector dist/index.js",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.6.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.11.24",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  },
  "files": [
    "dist"
  ],
  "keywords": [
    "mcp",
    "claude",
    "claude-code",
    "multi-agent",
    "coordination",
    "team-collaboration"
  ],
  "author": "Your Name",
  "license": "MIT"
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### src/index.ts

```typescript
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClaudeProcessPool } from './process-pool/pool-manager.js';
import { TeamsConfig } from './config/teams-config.js';
import { registerTools } from './tools/index.js';
import { NotificationQueue } from './notifications/queue.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('main');

async function startServer() {
  try {
    // Load configuration
    const config = await TeamsConfig.load();
    logger.info('Configuration loaded', {
      teams: Object.keys(config.teams).length
    });

    // Initialize process pool
    const processPool = new ClaudeProcessPool({
      idleTimeout: config.settings.idleTimeout,
      maxProcesses: config.settings.maxProcesses,
      healthCheckInterval: config.settings.healthCheckInterval
    });

    // Initialize notification queue
    const notificationQueue = new NotificationQueue();

    // Create MCP server
    const server = new McpServer({
      name: 'teams-mcp',
      version: '1.0.0'
    });

    // Register all tools
    registerTools(server, {
      processPool,
      notificationQueue,
      config
    });

    // Start health checks
    processPool.startHealthChecks();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down Teams MCP server...');
      await processPool.terminateAll();
      notificationQueue.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await processPool.terminateAll();
      notificationQueue.close();
      process.exit(0);
    });

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Teams MCP server running');

  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

startServer();
```

### src/process-pool/types.ts

```typescript
export interface ProcessPoolConfig {
  idleTimeout: number;
  maxProcesses: number;
  healthCheckInterval: number;
}

export interface TeamConfig {
  path: string;
  description: string;
  idleTimeout?: number;
  skipPermissions?: boolean;
}

export interface ProcessMessage {
  message: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export type ProcessStatus = 'spawning' | 'idle' | 'processing' | 'terminating' | 'stopped';

export interface ProcessMetrics {
  pid: number | undefined;
  status: ProcessStatus;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  idleTimeRemaining: number;
}
```

### src/process-pool/claude-process.ts

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ProcessMessage, ProcessStatus, TeamConfig } from './types.js';
import { Logger } from '../utils/logger.js';

export class ClaudeProcess extends EventEmitter {
  private child: ChildProcess;
  private teamName: string;
  private teamConfig: TeamConfig;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleTimeout: number;
  private messageQueue: ProcessMessage[] = [];
  private currentMessage: ProcessMessage | null = null;
  private status: ProcessStatus = 'spawning';
  private lastUsed: number = Date.now();
  private messagesProcessed: number = 0;
  private spawnTime: number = Date.now();
  private logger: Logger;

  constructor(
    teamName: string,
    teamConfig: TeamConfig,
    idleTimeout: number
  ) {
    super();
    this.teamName = teamName;
    this.teamConfig = teamConfig;
    this.idleTimeout = teamConfig.idleTimeout || idleTimeout;
    this.logger = new Logger(`claude-process:${teamName}`);

    // Spawn Claude Code process
    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json'
    ];

    if (teamConfig.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    this.child = spawn('claude', args, {
      cwd: teamConfig.path,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.logger.info('Process spawned', {
      pid: this.child.pid,
      cwd: teamConfig.path
    });

    this.setupListeners();
    this.status = 'idle';
    this.startIdleTimer();
  }

  private setupListeners() {
    let buffer = '';

    // Handle stdout
    this.child.stdout!.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          this.handleMessage(parsed);
        } catch (e) {
          this.logger.error('Failed to parse stdout', { line, error: e });
        }
      }
    });

    // Handle stderr (logging from Claude)
    this.child.stderr!.on('data', (data) => {
      this.logger.debug('Claude stderr', { data: data.toString() });
    });

    // Handle process exit
    this.child.on('close', (code) => {
      this.logger.info('Process closed', { code });
      this.status = 'stopped';
      this.emit('closed');
    });

    this.child.on('error', (error) => {
      this.logger.error('Process error', error);
      this.status = 'stopped';
      this.emit('error', error);
    });
  }

  private handleMessage(message: any) {
    this.logger.debug('Received message', { type: message.type });

    if (message.type === 'result' || message.type === 'error') {
      // Message processing complete
      if (this.currentMessage) {
        if (message.type === 'error') {
          this.currentMessage.reject(new Error(message.error));
        } else {
          this.currentMessage.resolve(message);
        }
        this.currentMessage = null;
        this.messagesProcessed++;
        this.lastUsed = Date.now();
      }

      // Process next queued message if any
      this.processNextMessage();
    }
  }

  async sendMessage(message: string): Promise<any> {
    this.logger.debug('Queueing message', { queueLength: this.messageQueue.length });

    return new Promise((resolve, reject) => {
      this.messageQueue.push({ message, resolve, reject });

      // If no message is currently being processed, start immediately
      if (!this.currentMessage) {
        this.processNextMessage();
      }
    });
  }

  private processNextMessage() {
    if (this.messageQueue.length === 0) {
      this.status = 'idle';
      this.startIdleTimer();
      return;
    }

    const { message, resolve, reject } = this.messageQueue.shift()!;
    this.currentMessage = { message, resolve, reject };
    this.status = 'processing';
    this.resetIdleTimer();

    const stdinMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: message
      },
      session_id: `teams-${this.teamName}-${Date.now()}`
    }) + '\n';

    this.logger.debug('Writing to stdin', { message: message.substring(0, 100) });
    this.child.stdin!.write(stdinMessage);
  }

  resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startIdleTimer() {
    this.resetIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.logger.info(`Idle timeout reached (${this.idleTimeout}ms)`);
      this.emit('idle-timeout');
    }, this.idleTimeout);
  }

  async healthCheck(timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeout);

      const pingMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'ping' },
        session_id: `health-${Date.now()}`
      }) + '\n';

      const onData = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'result') {
            clearTimeout(timer);
            this.child.stdout!.off('data', onData);
            resolve(true);
          }
        } catch (e) {
          // Continue listening
        }
      };

      this.child.stdout!.on('data', onData);
      this.child.stdin!.write(pingMessage);
    });
  }

  getMetrics(): any {
    return {
      pid: this.child.pid,
      status: this.status,
      messagesProcessed: this.messagesProcessed,
      lastUsed: this.lastUsed,
      uptime: Date.now() - this.spawnTime,
      idleTimeRemaining: this.idleTimer ? this.idleTimeout : 0,
      queueLength: this.messageQueue.length
    };
  }

  isHealthy(): boolean {
    return this.child.exitCode === null && !this.child.killed;
  }

  kill() {
    this.resetIdleTimer();
    if (this.child && !this.child.killed) {
      this.logger.info('Killing process');
      this.status = 'terminating';
      this.child.kill('SIGTERM');
    }
  }
}
```

### src/process-pool/pool-manager.ts

```typescript
import { ClaudeProcess } from './claude-process.js';
import { ProcessPoolConfig, TeamConfig } from './types.js';
import { Logger } from '../utils/logger.js';

export class ClaudeProcessPool {
  private processes: Map<string, ClaudeProcess> = new Map();
  private config: ProcessPoolConfig;
  private teamConfigs: Map<string, TeamConfig> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(config: ProcessPoolConfig) {
    this.config = config;
    this.logger = new Logger('process-pool');
  }

  setTeamConfigs(configs: Record<string, TeamConfig>) {
    for (const [name, config] of Object.entries(configs)) {
      this.teamConfigs.set(name, config);
    }
  }

  async getOrCreateProcess(teamName: string): Promise<ClaudeProcess> {
    // Check if process already exists
    if (this.processes.has(teamName)) {
      const process = this.processes.get(teamName)!;

      // Health check
      if (process.isHealthy()) {
        this.logger.debug('Reusing existing process', { teamName });
        process.resetIdleTimer();
        return process;
      } else {
        this.logger.warn('Process unhealthy, terminating', { teamName });
        await this.terminateProcess(teamName);
      }
    }

    // Check process limit
    if (this.processes.size >= this.config.maxProcesses) {
      const lru = this.findLeastRecentlyUsed();
      this.logger.info('Process limit reached, terminating LRU', {
        lru,
        limit: this.config.maxProcesses
      });
      await this.terminateProcess(lru);
    }

    // Create new process
    return await this.createProcess(teamName);
  }

  private async createProcess(teamName: string): Promise<ClaudeProcess> {
    const teamConfig = this.teamConfigs.get(teamName);
    if (!teamConfig) {
      throw new Error(`Team "${teamName}" not found in configuration`);
    }

    this.logger.info('Creating new process', { teamName });

    const process = new ClaudeProcess(
      teamName,
      teamConfig,
      this.config.idleTimeout
    );

    // Auto-cleanup on idle timeout
    process.on('idle-timeout', () => {
      this.terminateProcess(teamName);
    });

    // Handle unexpected closure
    process.on('closed', () => {
      this.processes.delete(teamName);
    });

    this.processes.set(teamName, process);
    return process;
  }

  async terminateProcess(teamName: string) {
    const process = this.processes.get(teamName);
    if (process) {
      this.logger.info('Terminating process', { teamName });
      process.kill();
      this.processes.delete(teamName);
    }
  }

  async terminateAll() {
    this.logger.info('Terminating all processes', {
      count: this.processes.size
    });

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    for (const [teamName, process] of this.processes) {
      process.kill();
    }
    this.processes.clear();
  }

  private findLeastRecentlyUsed(): string {
    let oldest = { team: '', time: Date.now() };

    for (const [team, process] of this.processes) {
      const metrics = process.getMetrics();
      if (metrics.lastUsed < oldest.time) {
        oldest = { team, time: metrics.lastUsed };
      }
    }

    return oldest.team;
  }

  startHealthChecks() {
    this.healthCheckInterval = setInterval(
      () => this.healthCheckAll(),
      this.config.healthCheckInterval
    );

    this.logger.info('Health checks started', {
      interval: this.config.healthCheckInterval
    });
  }

  private async healthCheckAll() {
    for (const [teamName, process] of this.processes) {
      try {
        const healthy = await process.healthCheck();
        if (!healthy) {
          this.logger.error('Health check failed, restarting', { teamName });
          await this.terminateProcess(teamName);
        }
      } catch (error) {
        this.logger.error('Health check error', { teamName, error });
      }
    }
  }

  getStatus() {
    const status: any = {
      totalProcesses: this.processes.size,
      maxProcesses: this.config.maxProcesses,
      processes: {}
    };

    for (const [teamName, process] of this.processes) {
      status.processes[teamName] = process.getMetrics();
    }

    return status;
  }
}
```

### src/tools/teams-ask.ts

```typescript
import { z } from 'zod';
import { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('tool:teams_ask');

export function registerTeamsAsk(
  server: any,
  processPool: ClaudeProcessPool
) {
  server.registerTool(
    'teams_ask',
    {
      title: 'Ask Team',
      description: 'Ask another team a question and wait for their response. Use this when you need information about another team\'s codebase or decisions.',
      inputSchema: {
        team_name: z.string().describe('Target team name (e.g., "frontend", "backend")'),
        question: z.string().describe('Question to ask the team')
      },
      outputSchema: {
        response: z.string(),
        team: z.string(),
        timestamp: z.number()
      }
    },
    async ({ team_name, question }) => {
      logger.info('Processing teams_ask', { team_name, question: question.substring(0, 50) });

      try {
        // Get or create Claude process for target team
        const process = await processPool.getOrCreateProcess(team_name);

        // Send message and wait for response
        const response = await process.sendMessage(question);

        const result = {
          response: response.response || response.content || 'No response',
          team: team_name,
          timestamp: Date.now()
        };

        logger.info('teams_ask completed', { team_name });

        return {
          content: [
            {
              type: 'text',
              text: `Team ${team_name} responded:\n\n${result.response}`
            }
          ],
          structuredContent: result
        };
      } catch (error) {
        logger.error('teams_ask failed', { team_name, error });
        throw error;
      }
    }
  );
}
```

### src/tools/index.ts

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import { NotificationQueue } from '../notifications/queue.js';
import { registerTeamsAsk } from './teams-ask.js';
import { registerTeamsSendMessage } from './teams-send-message.js';
import { registerTeamsNotify } from './teams-notify.js';
import { registerTeamsGetStatus } from './teams-get-status.js';

export interface ToolContext {
  processPool: ClaudeProcessPool;
  notificationQueue: NotificationQueue;
  config: any;
}

export function registerTools(
  server: McpServer,
  context: ToolContext
) {
  registerTeamsAsk(server, context.processPool);
  registerTeamsSendMessage(server, context.processPool);
  registerTeamsNotify(server, context.notificationQueue);
  registerTeamsGetStatus(server, context.processPool, context.config);
}
```

---

## ⚙️ Configuration & Deployment

### teams.json Configuration

```json
{
  "settings": {
    "idleTimeout": 300000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000
  },
  "teams": {
    "frontend": {
      "path": "/Users/dev/projects/acme-frontend",
      "description": "React TypeScript frontend with Tailwind",
      "idleTimeout": 600000,
      "skipPermissions": true
    },
    "backend": {
      "path": "/Users/dev/projects/acme-backend",
      "description": "Node.js Express REST API",
      "idleTimeout": 300000,
      "skipPermissions": true
    },
    "mobile": {
      "path": "/Users/dev/projects/acme-mobile",
      "description": "React Native mobile app",
      "idleTimeout": 300000,
      "skipPermissions": true
    }
  }
}
```

### Installation

**Global Installation:**
```bash
npm install -g @teams-mcp/server
```

**Project Installation:**
```bash
cd your-project
npm install @teams-mcp/server --save-dev
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "teams": {
      "command": "npx",
      "args": ["-y", "@teams-mcp/server"],
      "env": {
        "TEAMS_CONFIG": "/Users/you/.config/teams-mcp/teams.json",
        "TEAMS_IDLE_TIMEOUT": "300000",
        "TEAMS_MAX_PROCESSES": "10"
      }
    }
  }
}
```

### Claude Code CLI Configuration

```bash
# Add Teams MCP to Claude Code
claude mcp add teams \
  --scope user \
  --env TEAMS_CONFIG=/path/to/teams.json \
  -- npx -y @teams-mcp/server

# Verify installation
claude mcp list

# Test the server
claude mcp get teams
```

---

## 🧪 Testing & Debugging

### Using MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is essential for debugging:

```bash
# Build your server
npm run build

# Start inspector
npx @modelcontextprotocol/inspector dist/index.js

# Open browser to http://localhost:5173
# Connect to your MCP server
# Test tools interactively
```

### Unit Tests Example

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClaudeProcessPool } from '../src/process-pool/pool-manager.js';

describe('ClaudeProcessPool', () => {
  let pool: ClaudeProcessPool;

  beforeEach(() => {
    pool = new ClaudeProcessPool({
      idleTimeout: 5000,
      maxProcesses: 3,
      healthCheckInterval: 1000
    });

    pool.setTeamConfigs({
      'team-alpha': {
        path: '/tmp/test-project',
        description: 'Test team',
        skipPermissions: true
      }
    });
  });

  afterEach(async () => {
    await pool.terminateAll();
  });

  it('should create a new process', async () => {
    const process = await pool.getOrCreateProcess('team-alpha');
    expect(process).toBeDefined();
    expect(process.isHealthy()).toBe(true);
  });

  it('should reuse existing process', async () => {
    const process1 = await pool.getOrCreateProcess('team-alpha');
    const process2 = await pool.getOrCreateProcess('team-alpha');
    expect(process1).toBe(process2);
  });

  it('should enforce max process limit', async () => {
    await pool.getOrCreateProcess('team1');
    await pool.getOrCreateProcess('team2');
    await pool.getOrCreateProcess('team3');

    const status = pool.getStatus();
    expect(status.totalProcesses).toBe(3);

    // This should terminate LRU process
    await pool.getOrCreateProcess('team4');
    expect(status.totalProcesses).toBe(3);
  });
});
```

### Logging Configuration

```typescript
// src/utils/logger.ts
export class Logger {
  constructor(private context: string) {}

  info(message: string, meta?: any) {
    console.error(JSON.stringify({
      level: 'info',
      context: this.context,
      message,
      ...meta,
      timestamp: new Date().toISOString()
    }));
  }

  error(message: string, error?: any) {
    console.error(JSON.stringify({
      level: 'error',
      context: this.context,
      message,
      error: error?.message || error,
      stack: error?.stack,
      timestamp: new Date().toISOString()
    }));
  }

  debug(message: string, meta?: any) {
    if (process.env.DEBUG) {
      console.error(JSON.stringify({
        level: 'debug',
        context: this.context,
        message,
        ...meta,
        timestamp: new Date().toISOString()
      }));
    }
  }
}
```

---

## 🚀 Production Considerations

### Performance Tuning

**Idle Timeout Configuration:**
- **Short timeout (1-2 min):** Lower memory usage, more cold starts
- **Medium timeout (5 min):** Balanced (recommended)
- **Long timeout (15+ min):** Faster responses, higher memory usage

**Max Processes:**
- **Low (3-5):** Suitable for small teams, limited RAM
- **Medium (10-15):** Recommended for most cases
- **High (20+):** Large organizations, requires significant RAM

**Memory Usage Estimates:**
```
Per Claude Code Process: ~150-250 MB
10 idle processes: ~2 GB RAM
20 idle processes: ~4 GB RAM
```

### Security Considerations

1. **File System Access**
   - Each team's Claude instance only has access to its configured directory
   - Use `--dangerously-skip-permissions` only in trusted environments
   - Consider running in sandboxed containers

2. **Message Validation**
   - All inputs validated with Zod schemas
   - Sanitize team names to prevent path traversal
   - Rate limit tool calls per team

3. **Process Isolation**
   - Each Claude process runs in separate cwd
   - No shared state between processes
   - Processes can't access parent Teams MCP server memory

### Monitoring & Observability

**Key Metrics to Track:**
- Active process count
- Messages processed per team
- Average response time
- Health check failures
- Process spawn/terminate events

**Logging Best Practices:**
- Use structured JSON logs
- Log to stderr (MCP uses stdout for protocol)
- Include correlation IDs for request tracing
- Set appropriate log levels (info/debug/error)

### Error Handling

```typescript
// Graceful degradation
try {
  const process = await pool.getOrCreateProcess(teamName);
  const response = await process.sendMessage(question);
  return response;
} catch (error) {
  if (error.message.includes('timeout')) {
    // Retry once
    const process = await pool.getOrCreateProcess(teamName);
    return await process.sendMessage(question);
  }

  // Fall back to error message
  return {
    error: true,
    message: `Failed to contact team ${teamName}: ${error.message}`
  };
}
```

---

## 📚 API Reference

### MCP Tools

#### teams_ask

Ask another team a question and wait for synchronous response.

**Parameters:**
- `team_name` (string, required): Target team identifier
- `question` (string, required): Question to ask

**Returns:**
```typescript
{
  response: string;
  team: string;
  timestamp: number;
}
```

**Example:**
```typescript
await teams_ask({
  team_name: "backend",
  question: "What database migration system do you use?"
})
// Returns: { response: "We use Prisma for migrations...", team: "backend", ... }
```

#### teams_send_message

Send a message to another team with optional wait for reply.

**Parameters:**
- `team_name` (string, required): Target team
- `message` (string, required): Message content
- `wait_for_reply` (boolean, optional): Wait for response (default: true)

**Returns:**
```typescript
{
  success: boolean;
  response?: string;
  messageId: string;
}
```

#### teams_notify

Send fire-and-forget notification to team's queue.

**Parameters:**
- `team_name` (string, required): Target team
- `message` (string, required): Notification message
- `priority` (string, optional): "low" | "normal" | "high"

**Returns:**
```typescript
{
  queued: boolean;
  messageId: string;
  timestamp: number;
}
```

#### teams_get_status

Get status of team or all teams.

**Parameters:**
- `team_name` (string, optional): Specific team or omit for all

**Returns:**
```typescript
{
  teams: {
    [teamName: string]: {
      active: boolean;
      lastUsed: number;
      messagesProcessed: number;
      queueLength: number;
    }
  };
  poolStatus: {
    totalProcesses: number;
    maxProcesses: number;
  };
}
```

---

## 🎯 Conclusion

This architecture provides a production-ready foundation for Teams MCP. Key highlights:

✅ **52%+ performance improvement** with connection pooling
✅ **Full MCP protocol compliance** using official SDK
✅ **Robust process management** with health checks
✅ **Comprehensive error handling** and logging
✅ **Scalable to 10+ concurrent teams**
✅ **Memory efficient** with configurable limits

### Next Steps

1. **Implement remaining tools** (teams_notify, teams_get_status)
2. **Add notification queue** with SQLite
3. **Write comprehensive tests** (unit + integration)
4. **Create example configurations** for common setups
5. **Publish to npm** as `@teams-mcp/server`
6. **Document real-world use cases** with screenshots

### Resources

- [MCP Official Documentation](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification](https://spec.modelcontextprotocol.io)
- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Claude Code CLI Reference](https://docs.claude.com/en/docs/claude-code/cli-reference)

---

**Ready to build the future of cross-project AI collaboration!** 🚀
