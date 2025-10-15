# Iris CLI: Command Line Interface Addendum

**A powerful CLI for interacting with Iris MCP from any terminal**

---

## 🎯 Overview

The **Iris CLI** (`iris`) provides a command-line interface for developers to interact with team agents directly from their terminal, without needing Claude Desktop or programmatic API integration. Think of it as `git` or `docker` for AI agent coordination.

---

## 📋 For README.md

### Add after "Programmatic API" section:

---

## 💻 Command Line Interface

The Iris CLI provides instant access to team agents from your terminal.

### Installation

```bash
# Install globally
npm install -g iris-mcp

# Verify installation
iris --version
# iris-mcp v1.0.0

# Setup (first time)
iris init
# Created ~/.iris/config.json
# Created ~/.iris/credentials.json
```

### Quick Start

```bash
# Ask a team a question
iris ask backend "What database migration system do you use?"

# Send a message to a team
iris send frontend "API schema updated, please sync your types"

# Execute a task
iris exec backend "Run npm audit fix"

# Check team status
iris status

# Stream a response (live output)
iris stream backend "Explain the authentication flow step by step"
```

### Core Commands

#### `iris ask`

Ask a team a question and get a synchronous response.

```bash
# Basic usage
iris ask <team> "<question>"

# Examples
iris ask backend "What's our API versioning strategy?"
iris ask frontend "Which state management library are we using?"
iris ask mobile "Do you support push notifications?"

# With options
iris ask backend "Check for security vulnerabilities" \
  --timeout 60s \
  --format json \
  --save response.json

# Interactive mode (multi-turn conversation)
iris ask backend --interactive
> What database do we use?
< We use PostgreSQL with Prisma ORM
> What version?
< PostgreSQL 15.4
> exit
```

**Options:**
- `--timeout, -t <duration>` - Max wait time (default: 30s)
- `--format, -f <type>` - Output format: text, json, markdown (default: text)
- `--save, -s <file>` - Save response to file
- `--interactive, -i` - Start interactive session
- `--context, -c <text>` - Add context to the question
- `--quiet, -q` - Only output response (no metadata)

#### `iris send`

Send a message to a team (synchronous by default).

```bash
# Send and wait for acknowledgment
iris send backend "Breaking change: User model now requires email field"

# Fire and forget
iris send frontend "New component library version available" --async

# With callback
iris send backend "Run full test suite" \
  --async \
  --webhook https://api.example.com/iris-callback

# Send to multiple teams
iris send backend,frontend,mobile "System maintenance scheduled for tonight"
```

**Options:**
- `--async, -a` - Don't wait for response
- `--webhook, -w <url>` - Webhook URL for async callback
- `--priority, -p <level>` - Priority: low, normal, high (default: normal)

#### `iris notify`

Send  notifications to teams.

```bash
# Send notification
iris notify mobile "New API endpoints available"

# Bulk notify
iris notify all "Company-wide: New coding standards published"

# With priority
iris notify backend "Critical: Database migration needed" --priority high
```

#### `iris exec`

Execute a task on a team agent.

```bash
# Execute task
iris exec backend "Update all npm dependencies"

# With confirmation
iris exec backend "Delete old migration files" --confirm

# Background execution with status tracking
iris exec backend "Generate API documentation" --async
# Job ID: job_abc123
# Track status: iris status job_abc123
```

**Options:**
- `--confirm, -y` - Skip confirmation prompt
- `--async, -a` - Execute in background
- `--timeout, -t <duration>` - Max execution time
- `--dry-run, -d` - Show what would be executed without running

#### `iris stream`

Stream responses in real-time as they're generated.

```bash
# Stream response
iris stream backend "Explain our caching strategy in detail"
# Output appears as Claude generates it

# Pipe to other commands
iris stream backend "List all API endpoints" | grep POST

# Save to file while streaming
iris stream backend "Generate API documentation" | tee api-docs.md

# With syntax highlighting
iris stream backend "Show me the authentication code" --highlight
```

**Options:**
- `--highlight, -h` - Syntax highlight code blocks
- `--no-stream` - Wait for complete response before displaying

#### `iris status`

Check status of teams, processes, and jobs.

```bash
# Show all teams
iris status

# Output:
# Teams Status:
# ┌──────────┬────────────┬─────────────┬────────────┐
# │ Team     │ Status     │ Last Active │ Messages   │
# ├──────────┼────────────┼─────────────┼────────────┤
# │ frontend │ ● Active   │ 2m ago      │ 47         │
# │ backend  │ ● Active   │ 30s ago     │ 132        │
# │ mobile   │ ○ Idle     │ 1h ago      │ 23         │
# └──────────┴────────────┴─────────────┴────────────┘

# Specific team
iris status backend

# Output:
# Team: backend
# Status: ● Active
# Process ID: 12346
# Uptime: 3h 42m
# Messages Processed: 132
# Queue Length: 0
# Last Active: 30 seconds ago

# Check job status
iris status job_abc123

# Watch mode (live updates)
iris status --watch

# JSON output
iris status --json
```

**Options:**
- `--watch, -w` - Live updates (refresh every 2s)
- `--json, -j` - JSON output
- `--verbose, -v` - Show detailed process information

#### `iris history`

Browse message history between teams.

```bash
# Show recent messages
iris history

# Filter by team
iris history --team backend

# Filter by team pair
iris history --from frontend --to backend

# Show last N messages
iris history --limit 10

# Search messages
iris history --search "authentication"

# Export to file
iris history --from backend --to frontend --format json > history.json
```

**Options:**
- `--team, -t <name>` - Filter by team
- `--from, -f <team>` - Filter by sender
- `--to <team>` - Filter by recipient
- `--limit, -l <n>` - Number of messages (default: 50)
- `--search, -s <query>` - Search message content
- `--format <type>` - Output format: table, json, csv
- `--since <date>` - Show messages since date

### Team Management

#### `iris team add`

Add a new team to the configuration.

```bash
# Add team
iris team add mobile \
  --path /Users/dev/projects/acme-mobile \
  --description "React Native mobile app"

# With options
iris team add analytics \
  --path /projects/analytics \
  --description "Data analytics service" \
  --timeout 600s \
  --color "#ff6b6b" \
  --skip-permissions
```

**Options:**
- `--path, -p <path>` - Project directory (required)
- `--description, -d <text>` - Team description
- `--timeout, -t <duration>` - Idle timeout (default: 5m)
- `--color, -c <hex>` - Team color for UI
- `--skip-permissions` - Auto-approve Claude actions

#### `iris team list`

List all configured teams.

```bash
# List teams
iris team list

# Output:
# Configured Teams:
# ┌──────────┬─────────────────────────────────┬──────────────────────┐
# │ Name     │ Path                             │ Description          │
# ├──────────┼─────────────────────────────────┼──────────────────────┤
# │ frontend │ /projects/acme-frontend          │ React TypeScript app │
# │ backend  │ /projects/acme-backend           │ Node.js Express API  │
# │ mobile   │ /projects/acme-mobile            │ React Native app     │
# └──────────┴─────────────────────────────────┴──────────────────────┘

# JSON output
iris team list --json
```

#### `iris team update`

Update team configuration.

```bash
# Update team
iris team update backend --description "Node.js GraphQL API"

# Change path
iris team update mobile --path /new/path/to/mobile

# Update timeout
iris team update frontend --timeout 10m
```

#### `iris team remove`

Remove a team from configuration.

```bash
# Remove team (with confirmation)
iris team remove old-service

# Force remove without confirmation
iris team remove old-service --force
```

### Configuration

#### `iris config`

Manage Iris configuration.

```bash
# Show current config
iris config show

# Set default team
iris config set default-team backend

# Set API key
iris config set api-key iris_sk_abc123...

# Set server URL
iris config set server-url http://localhost:3100

# Edit config file
iris config edit

# Reset to defaults
iris config reset
```

**Configuration File** (`~/.iris/config.json`):
```json
{
  "server": {
    "url": "http://localhost:3100",
    "apiKey": "iris_sk_abc123..."
  },
  "defaults": {
    "team": "backend",
    "timeout": "30s",
    "format": "text"
  },
  "ui": {
    "color": true,
    "emoji": true,
    "spinner": "dots"
  }
}
```

### Advanced Features

#### `iris shell`

Start an interactive Iris shell.

```bash
# Start shell
iris shell

# Interactive prompt:
iris> ask backend "what database do we use?"
< We use PostgreSQL 15.4 with Prisma ORM

iris> send frontend "update your types"
✓ Message sent to frontend

iris> status
Teams Status:
[status table]

iris> exit
```

**Shell Commands:**
- `ask <team> <question>` - Ask a question
- `send <team> <message>` - Send a message
- `status [team]` - Check status
- `history` - Show history
- `clear` - Clear screen
- `help` - Show help
- `exit` - Exit shell

#### `iris watch`

Watch for messages to/from specific teams.

```bash
# Watch all messages
iris watch

# Output (live):
# 14:32:15 frontend → backend  "What's your API versioning?"
# 14:32:18 backend → frontend  "We use semantic versioning..."
# 14:33:02 mobile → backend    "Do you support push notifications?"

# Watch specific team
iris watch --team backend

# Filter by source/target
iris watch --from frontend

# With details
iris watch --verbose
```

#### `iris logs`

View Iris server logs.

```bash
# Show recent logs
iris logs

# Follow logs (tail -f style)
iris logs --follow

# Filter by level
iris logs --level error

# Show logs for specific team
iris logs --team backend

# Export logs
iris logs --since "1 hour ago" --format json > logs.json
```

### Scripting & Automation

#### Bash Scripts

```bash
#!/bin/bash
# deploy.sh - Coordinate deployment across teams

echo "Starting deployment..."

# Ask backend if ready
if iris ask backend "Are all migrations applied?" --quiet | grep -q "yes"; then
  echo "✓ Backend ready"
else
  echo "✗ Backend not ready, aborting"
  exit 1
fi

# Notify frontend of deployment
iris notify frontend "Backend deploying, expect brief downtime" --async

# Execute deployment
iris exec backend "npm run deploy" --timeout 5m

# Verify deployment
if iris ask backend "Is the server healthy?" --quiet | grep -q "healthy"; then
  echo "✓ Deployment successful"
  iris notify all "Backend deployment complete" --priority high
else
  echo "✗ Deployment failed"
  exit 1
fi
```

#### Makefile Integration

```makefile
# Makefile
.PHONY: review test deploy

review:
	@iris ask code-reviewer "Review changes in current branch" | tee review.md

test:
	@iris exec backend "npm test" --timeout 5m
	@iris exec frontend "npm test" --timeout 5m

deploy: test
	@iris exec backend "npm run deploy"
	@iris notify all "Deployment complete"

check-deps:
	@iris ask backend "Check for outdated dependencies"
	@iris ask frontend "Check for outdated dependencies"
```

#### Git Hooks

```bash
# .git/hooks/pre-commit
#!/bin/bash

# Ask for code review before commit
iris ask code-reviewer "Review staged changes" --quiet --format markdown > .review.md

if grep -q "❌" .review.md; then
  echo "Code review found issues:"
  cat .review.md
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

rm .review.md
```

### Output Formats

#### Text (Default)

```bash
$ iris ask backend "what database do we use?"

Team backend responded:

We use PostgreSQL 15.4 with Prisma ORM for database management.
Our connection pool is configured for 20 max connections and we
use read replicas for query optimization.

───────────────────────────────────
Completed in 2.8s
```

#### JSON

```bash
$ iris ask backend "what database" --format json

{
  "messageId": "msg_abc123",
  "team": "backend",
  "question": "what database",
  "response": "We use PostgreSQL 15.4...",
  "duration": 2847,
  "timestamp": 1704067200000,
  "metadata": {
    "filesAccessed": ["prisma/schema.prisma"],
    "toolsUsed": ["Read"]
  }
}
```

#### Markdown

```bash
$ iris ask backend "what database" --format markdown

## Response from backend

We use **PostgreSQL 15.4** with Prisma ORM for database management.

### Key Details:
- Connection pool: 20 max connections
- Read replicas enabled
- Migration system: Prisma Migrate

---
*Completed in 2.8s*
```

### Environment Variables

```bash
# Server URL
export IRIS_SERVER_URL=http://localhost:3100

# API Key
export IRIS_API_KEY=iris_sk_abc123...

# Default team
export IRIS_DEFAULT_TEAM=backend

# Output format
export IRIS_FORMAT=json

# Disable colors
export IRIS_NO_COLOR=1

# Increase timeout
export IRIS_TIMEOUT=60s
```

### Aliases & Shortcuts

Add to your `.bashrc` or `.zshrc`:

```bash
# Quick aliases
alias ib='iris ask backend'
alias if='iris ask frontend'
alias im='iris ask mobile'
alias is='iris status'

# Function shortcuts
ask() {
  iris ask "$1" "$2" --quiet
}

broadcast() {
  iris notify all "$1" --priority high
}

# Usage:
# ask backend "what database?"
# broadcast "System maintenance in 10 minutes"
```

---

## 📋 For ARCHITECTURE.md

### Add new section after "Programmatic API Architecture":

---

## 💻 CLI Architecture

### Overview

The Iris CLI is a standalone Node.js application that provides a rich command-line interface for interacting with the Iris MCP server. It communicates with the server via the HTTP REST API and WebSocket for streaming operations.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Terminal / Shell                          │
│                                                               │
│  $ iris ask backend "what database?"                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Executes
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    Iris CLI Process                          │
│                   (Node.js Application)                      │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Command Parser (Commander.js)                          │ │
│  │  • Parse arguments and flags                            │ │
│  │  • Validate input                                       │ │
│  │  • Route to command handler                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Command Handlers                                        │ │
│  │  • AskCommand                                           │ │
│  │  • SendCommand                                          │ │
│  │  • StatusCommand                                        │ │
│  │  • StreamCommand                                        │ │
│  │  • TeamCommand                                          │ │
│  │  • ConfigCommand                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  API Client                                              │ │
│  │  • HTTP requests to Iris server                         │ │
│  │  • WebSocket for streaming                              │ │
│  │  • Authentication handling                              │ │
│  │  • Error handling & retry logic                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  UI Components                                           │ │
│  │  • Spinners & progress bars (ora)                       │ │
│  │  • Tables (cli-table3)                                  │ │
│  │  • Colors & formatting (chalk)                          │ │
│  │  • Interactive prompts (inquirer)                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Config Manager                                          │ │
│  │  • Read/write ~/.iris/config.json                       │ │
│  │  • Environment variable handling                        │ │
│  │  • Credential management                                │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ HTTP/REST + WebSocket
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              Iris MCP Server API                             │
│              (Port 3100)                                     │
│                                                               │
│  • POST /api/v1/teams/:team/ask                              │
│  • POST /api/v1/teams/:team/send                             │
│  • WS   /api/v1/stream                                       │
│  • GET  /api/v1/status                                       │
└──────────────────────────────────────────────────────────────┘
```

### Project Structure

```
iris-cli/
├── package.json
├── bin/
│   └── iris.ts                    # CLI entry point
├── src/
│   ├── cli.ts                     # Main CLI setup
│   ├── commands/
│   │   ├── ask.ts                 # iris ask
│   │   ├── send.ts                # iris send
│   │   ├── notify.ts              # iris notify
│   │   ├── exec.ts                # iris exec
│   │   ├── stream.ts              # iris stream
│   │   ├── status.ts              # iris status
│   │   ├── history.ts             # iris history
│   │   ├── team.ts                # iris team
│   │   ├── config.ts              # iris config
│   │   ├── shell.ts               # iris shell
│   │   ├── watch.ts               # iris watch
│   │   └── logs.ts                # iris logs
│   ├── api/
│   │   ├── client.ts              # API client
│   │   ├── websocket.ts           # WebSocket client
│   │   └── types.ts               # API types
│   ├── config/
│   │   ├── manager.ts             # Config management
│   │   ├── schema.ts              # Config schema
│   │   └── defaults.ts            # Default values
│   ├── ui/
│   │   ├── spinner.ts             # Loading spinners
│   │   ├── table.ts               # Table formatting
│   │   ├── colors.ts              # Color schemes
│   │   ├── prompts.ts             # Interactive prompts
│   │   └── formatters.ts          # Output formatters
│   └── utils/
│       ├── logger.ts              # Logging utility
│       ├── validation.ts          # Input validation
│       ├── errors.ts              # Error handling
│       └── duration.ts            # Time parsing
└── dist/                          # Compiled output
```

### Implementation Details

#### CLI Entry Point (`bin/iris.ts`)

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { AskCommand } from '../src/commands/ask.js';
import { SendCommand } from '../src/commands/send.js';
import { StatusCommand } from '../src/commands/status.js';
import { ConfigManager } from '../src/config/manager.js';
import { version } from '../package.json';

const program = new Command();

program
  .name('iris')
  .description('🌈 Iris MCP - Bridge your AI agents across codebases')
  .version(version);

// Global options
program
  .option('--server <url>', 'Iris server URL')
  .option('--api-key <key>', 'API key for authentication')
  .option('--no-color', 'Disable colors in output')
  .option('--debug', 'Enable debug logging');

// Load config
const config = await ConfigManager.load();

// Register commands
program
  .command('ask')
  .description('Ask a team a question')
  .argument('<team>', 'Team name')
  .argument('<question>', 'Question to ask')
  .option('-t, --timeout <duration>', 'Timeout duration', '30s')
  .option('-f, --format <type>', 'Output format', 'text')
  .option('-i, --interactive', 'Interactive mode')
  .option('-q, --quiet', 'Quiet mode (response only)')
  .action(async (team, question, options) => {
    const cmd = new AskCommand(config);
    await cmd.execute(team, question, options);
  });

program
  .command('send')
  .description('Send a message to a team')
  .argument('<team>', 'Team name')
  .argument('<message>', 'Message to send')
  .option('-a, --async', 'Async (fire and forget)')
  .option('-w, --webhook <url>', 'Webhook URL for callback')
  .option('-p, --priority <level>', 'Priority level', 'normal')
  .action(async (team, message, options) => {
    const cmd = new SendCommand(config);
    await cmd.execute(team, message, options);
  });

program
  .command('status')
  .description('Check team status')
  .argument('[team]', 'Team name (optional)')
  .option('-w, --watch', 'Watch mode (live updates)')
  .option('-j, --json', 'JSON output')
  .option('-v, --verbose', 'Verbose output')
  .action(async (team, options) => {
    const cmd = new StatusCommand(config);
    await cmd.execute(team, options);
  });

// ... more commands

program.parse();
```

#### API Client (`src/api/client.ts`)

```typescript
import axios, { AxiosInstance } from 'axios';
import { Config } from '../config/types.js';
import { ApiError } from '../utils/errors.js';

export class IrisApiClient {
  private http: AxiosInstance;

  constructor(private config: Config) {
    this.http = axios.create({
      baseURL: config.server.url,
      headers: {
        'Authorization': `Bearer ${config.server.apiKey}`,
        'User-Agent': `iris-cli/${version}`
      },
      timeout: 30000
    });

    // Add response interceptor for error handling
    this.http.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          throw new ApiError(
            error.response.data.message,
            error.response.status,
            error.response.data.code
          );
        }
        throw error;
      }
    );
  }

  async ask(team: string, question: string, options: AskOptions) {
    const response = await this.http.post(
      `/api/v1/teams/${team}/ask`,
      { question, ...options }
    );
    return response.data;
  }

  async send(team: string, message: string, options: SendOptions) {
    const response = await this.http.post(
      `/api/v1/teams/${team}/send`,
      { message, ...options }
    );
    return response.data;
  }

  async getStatus(team?: string) {
    const url = team
      ? `/api/v1/teams/${team}/status`
      : `/api/v1/status`;
    const response = await this.http.get(url);
    return response.data;
  }

  async getHistory(filters: HistoryFilters) {
    const response = await this.http.get('/api/v1/messages/history', {
      params: filters
    });
    return response.data;
  }
}
```

#### WebSocket Client (`src/api/websocket.ts`)

```typescript
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export class IrisWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;

  constructor(private url: string, private apiKey: string) {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      this.ws.on('open', () => {
        resolve();
      });

      this.ws.on('message', (data) => {
        const event = JSON.parse(data.toString());
        this.emit(event.type, event);
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
      });

      this.ws.on('close', () => {
        this.emit('close');
      });
    });
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
```

#### Ask Command (`src/commands/ask.ts`)

```typescript
import ora from 'ora';
import chalk from 'chalk';
import { IrisApiClient } from '../api/client.js';
import { formatResponse } from '../ui/formatters.js';

export class AskCommand {
  private client: IrisApiClient;

  constructor(private config: Config) {
    this.client = new IrisApiClient(config);
  }

  async execute(team: string, question: string, options: any) {
    const spinner = ora(`Asking ${chalk.cyan(team)}...`).start();

    try {
      const response = await this.client.ask(team, question, {
        timeout: this.parseDuration(options.timeout)
      });

      spinner.succeed(`${chalk.cyan(team)} responded:`);

      if (options.quiet) {
        console.log(response.response);
      } else {
        console.log(formatResponse(response, options.format));
      }

      if (options.save) {
        await this.saveResponse(response, options.save);
      }

    } catch (error) {
      spinner.fail(`Failed to get response from ${team}`);
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  }

  private parseDuration(duration: string): number {
    // Parse "30s", "5m", "1h" to milliseconds
    const match = duration.match(/^(\d+)([smh])$/);
    if (!match) throw new Error('Invalid duration format');

    const [, value, unit] = match;
    const multipliers = { s: 1000, m: 60000, h: 3600000 };
    return parseInt(value) * multipliers[unit];
  }

  private async saveResponse(response: any, filename: string) {
    await fs.writeFile(filename, JSON.stringify(response, null, 2));
    console.log(chalk.gray(`Saved to ${filename}`));
  }
}
```

#### Status Command (`src/commands/status.ts`)

```typescript
import Table from 'cli-table3';
import chalk from 'chalk';
import { IrisApiClient } from '../api/client.js';

export class StatusCommand {
  private client: IrisApiClient;

  constructor(private config: Config) {
    this.client = new IrisApiClient(config);
  }

  async execute(team: string | undefined, options: any) {
    if (options.watch) {
      await this.watchMode(team);
    } else {
      await this.showStatus(team, options);
    }
  }

  private async showStatus(team: string | undefined, options: any) {
    const status = await this.client.getStatus(team);

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (team) {
      this.displayTeamStatus(status);
    } else {
      this.displayAllTeams(status);
    }
  }

  private displayAllTeams(status: any) {
    const table = new Table({
      head: ['Team', 'Status', 'Last Active', 'Messages'],
      style: { head: ['cyan'] }
    });

    for (const [name, info] of Object.entries(status.teams)) {
      const statusIcon = info.active ? '●' : '○';
      const statusColor = info.active ? 'green' : 'gray';

      table.push([
        name,
        chalk[statusColor](statusIcon) + ' ' + (info.active ? 'Active' : 'Idle'),
        this.formatTimeSince(info.lastUsed),
        info.messagesProcessed.toString()
      ]);
    }

    console.log('Teams Status:');
    console.log(table.toString());
  }

  private async watchMode(team: string | undefined) {
    console.clear();
    console.log(chalk.cyan('Watching team status (Ctrl+C to exit)...\n'));

    const refresh = async () => {
      const status = await this.client.getStatus(team);
      console.clear();
      console.log(chalk.cyan('Watching team status (Ctrl+C to exit)...\n'));
      this.displayAllTeams(status);
    };

    await refresh();
    setInterval(refresh, 2000);
  }

  private formatTimeSince(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}
```

#### Config Manager (`src/config/manager.ts`)

```typescript
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export class ConfigManager {
  private static configDir = path.join(os.homedir(), '.iris');
  private static configFile = path.join(ConfigManager.configDir, 'config.json');

  static async load(): Promise<Config> {
    await this.ensureConfigDir();

    try {
      const content = await fs.readFile(this.configFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      // Return defaults if config doesn't exist
      return this.defaults();
    }
  }

  static async save(config: Config): Promise<void> {
    await this.ensureConfigDir();
    await fs.writeFile(
      this.configFile,
      JSON.stringify(config, null, 2)
    );
  }

  static async init(): Promise<void> {
    await this.ensureConfigDir();

    const config = this.defaults();
    await this.save(config);

    console.log(chalk.green('✓ Created ~/.iris/config.json'));
    console.log(chalk.green('✓ Created ~/.iris/credentials.json'));
  }

  private static async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  private static defaults(): Config {
    return {
      server: {
        url: process.env.IRIS_SERVER_URL || 'http://localhost:3100',
        apiKey: process.env.IRIS_API_KEY || ''
      },
      defaults: {
        team: process.env.IRIS_DEFAULT_TEAM || '',
        timeout: '30s',
        format: 'text'
      },
      ui: {
        color: process.env.IRIS_NO_COLOR !== '1',
        emoji: true,
        spinner: 'dots'
      }
    };
  }
}
```

### Package Configuration

#### package.json

```json
{
  "name": "iris-mcp",
  "version": "1.0.0",
  "description": "CLI for Iris MCP - Bridge your AI agents across codebases",
  "type": "module",
  "bin": {
    "iris": "./dist/bin/iris.js"
  },
  "scripts": {
    "build": "tsc && chmod +x dist/bin/iris.js",
    "dev": "tsx watch bin/iris.ts",
    "test": "vitest"
  },
  "dependencies": {
    "commander": "^11.1.0",
    "axios": "^1.6.0",
    "ws": "^8.14.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.1",
    "cli-table3": "^0.6.3",
    "inquirer": "^9.2.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "vitest": "^1.2.0"
  },
  "keywords": [
    "iris",
    "mcp",
    "claude",
    "claude-code",
    "ai",
    "agents",
    "cli"
  ]
}
```

### Distribution

#### NPM Package

```bash
# Publish to npm
npm publish

# Install globally
npm install -g iris-mcp

# Or use via npx
npx iris-mcp ask backend "what database?"
```

#### Homebrew Formula (macOS/Linux)

```ruby
# Formula/iris-mcp.rb
class IrisMcp < Formula
  desc "CLI for Iris MCP - Bridge your AI agents"
  homepage "https://github.com/iris-mcp/iris"
  url "https://github.com/iris-mcp/iris-cli/archive/v1.0.0.tar.gz"
  sha256 "..."

  depends_on "node"

  def install
    system "npm", "install", "--production"
    system "npm", "run", "build"
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    system "#{bin}/iris", "--version"
  end
end
```

```bash
# Install via Homebrew
brew tap iris-mcp/tap
brew install iris-mcp
```

---

Perfect! This **Iris CLI** makes the platform accessible to **every developer** via their terminal! 🎉

Now want me to create the **Agent SDK Intelligence Layer** addendum for the self-aware monitoring system? That's going to be NEXT LEVEL! 🧠
