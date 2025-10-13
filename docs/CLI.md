# Terminal CLI Documentation (Phase 4)

**Location:** `src/cli/` (Future)
**Status:** Not Yet Implemented
**Purpose:** Human-friendly terminal interface using Ink (React for terminals)
**Target Release:** Phase 4

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Command Catalog](#command-catalog)
4. [Interactive UI](#interactive-ui)
5. [Design Mockups](#design-mockups)
6. [Implementation Plan](#implementation-plan)

---

## Overview

Phase 4 will introduce a **terminal user interface** for human operators to interact with Iris. Built with **Ink** (React components for CLIs), this enables:

- **Live Monitoring:** Real-time dashboard in the terminal
- **Interactive Commands:** Arrow key navigation, autocomplete
- **Rich Formatting:** Colors, tables, progress bars, spinners
- **Component Reuse:** Share React components with Phase 2 web dashboard

**Design Principle:** CLI is a thin wrapper around Phase 3 API. All logic remains in core Iris.

---

## Technology Stack

**CLI Framework:**
- **Commander.js** (^11.1.0): Command-line argument parsing
- **Ink** (^5.0.1): React components for terminal UIs
- **React** (^18.2.0): Shared with web dashboard
- **ink-text-input**: Text input component
- **ink-select-input**: Arrow key selection
- **ink-spinner**: Loading spinners
- **ink-table**: Formatted tables
- **chalk**: Terminal colors (used by Ink)

**Why Ink?**
- React paradigm (familiar to developers)
- Reuse components from Phase 2 dashboard
- Rich ecosystem of pre-built components
- Automatic terminal resize handling

---

## Command Catalog

### Installation & Setup

```bash
# Install globally
npm install -g @iris-mcp/cli

# Initialize configuration
iris install

# Add team
iris add-team <name> [path]
iris add-team frontend /Users/jenova/projects/frontend

# Remove team
iris remove-team <name>

# Edit configuration
iris config edit

# Validate configuration
iris config validate
```

### Process Management

```bash
# Start Iris server (stdio transport)
iris start

# Start with HTTP transport
iris start --http --port 1615

# Stop Iris server
iris stop

# Restart Iris server
iris restart
```

### Team Communication

```bash
# Send message to team (blocking)
iris tell <team> <message>
iris tell backend "What is the API status?"

# Send message with timeout
iris tell backend "Run tests" --timeout 60000

# Send async message (fire and forget)
iris tell backend "Generate report" --async

# Interactive message (opens editor)
iris tell backend --interactive
```

### Team Management

```bash
# List all teams
iris teams

# List with process details
iris teams --details

# Check if team is awake
iris status <team>
iris status backend

# Wake team
iris wake <team>
iris wake frontend

# Wake all teams
iris wake-all

# Put team to sleep
iris sleep <team>
iris sleep staging
```

### Cache Inspection

```bash
# Read cache for session
iris cache read <sessionId>

# Read with message history
iris cache read <sessionId> --messages 20

# Clear cache
iris cache clear <sessionId>

# List all caches
iris cache list
```

### Monitoring

```bash
# Live dashboard (TUI)
iris monitor

# Show process pool status
iris pool

# Show session statistics
iris sessions

# Show logs (tail -f style)
iris logs
iris logs --follow
iris logs --level error
```

---

## Interactive UI

### Command: iris monitor

**Live dashboard with real-time updates:**

```
┌────────────────────────────────────────────────────────────────┐
│                    Iris MCP Monitor                             │
│                   Press 'q' to quit                             │
└────────────────────────────────────────────────────────────────┘

  System Status                          │  Process Pool
────────────────────────────────────────┼─────────────────────────
  Uptime:          2h 34m 12s            │  Active:      8 / 10
  Sessions:        15 active             │  Idle:        5
  Messages:        1,234 total           │  Processing:  3
  Cache Entries:   342                   │

  Teams (5 total, 3 awake, 2 asleep)
────────────────────────────────────────────────────────────────
  Name          Status     PID      Messages  Last Activity
  frontend      ● AWAKE    12345    42        2s ago
  backend       ● AWAKE    67890    18        5s ago
  mobile        ● AWAKE    11223    9         1m ago
  devops        ○ ASLEEP   -        -         -
  staging       ○ ASLEEP   -        -         -

  Recent Messages
────────────────────────────────────────────────────────────────
  [14:23:15] frontend → backend: "What is the API status?"
  [14:23:17] backend → frontend: "All APIs operational"
  [14:24:01] mobile → backend: "Push notification test"

  Legend: ● Awake  ○ Asleep  ⚙ Processing  ⚠ Error
```

**Implementation with Ink:**

```typescript
import React, { useEffect, useState } from 'react';
import { render, Box, Text } from 'ink';

function MonitorDashboard() {
  const [stats, setStats] = useState({});

  useEffect(() => {
    // Poll API every second
    const interval = setInterval(async () => {
      const response = await fetch('http://localhost:1615/api/status');
      setStats(await response.json());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={2}>
        <Text bold>Iris MCP Monitor</Text>
      </Box>

      <Box marginTop={1}>
        <Text>Uptime: </Text>
        <Text color="green">{stats.uptime}</Text>
      </Box>

      {/* ... rest of dashboard */}
    </Box>
  );
}

render(<MonitorDashboard />);
```

### Command: iris tell --interactive

**Interactive message editor:**

```
┌────────────────────────────────────────────────────────────────┐
│  Tell Team: backend                                             │
└────────────────────────────────────────────────────────────────┘

  Enter message (Ctrl+D to send, Ctrl+C to cancel):

  ┌──────────────────────────────────────────────────────────────┐
  │ Please review the authentication middleware changes in       │
  │ PR #123. Key changes:                                        │
  │                                                              │
  │ 1. Added JWT validation                                      │
  │ 2. Implemented refresh token rotation                        │
  │ 3. Updated session expiry to 7 days                          │
  │                                                              │
  │ Let me know if you have any concerns.                        │
  └──────────────────────────────────────────────────────────────┘

  [✓] Send  [✗] Cancel
```

### Command: iris teams (Interactive)

**Arrow key navigation:**

```
┌────────────────────────────────────────────────────────────────┐
│  Select a team (↑↓ to navigate, Enter to view, q to quit)      │
└────────────────────────────────────────────────────────────────┘

  › ● frontend    (AWAKE)   - Frontend development
    ● backend     (AWAKE)   - Backend services
    ○ mobile      (ASLEEP)  - Mobile applications
    ○ devops      (ASLEEP)  - DevOps automation
    ● staging     (AWAKE)   - Staging environment

  Actions:
  [Enter] View Details  [w] Wake  [s] Sleep  [t] Tell  [q] Quit
```

**On Enter (View Details):**

```
┌────────────────────────────────────────────────────────────────┐
│  Team: frontend                                                 │
└────────────────────────────────────────────────────────────────┘

  Configuration
────────────────────────────────────────────────────────────────
  Path:           /Users/jenova/projects/frontend
  Description:    Frontend development team
  Color:          #FF6B9D
  Idle Timeout:   8.3 hours
  Skip Perms:     Yes

  Process Status
────────────────────────────────────────────────────────────────
  Status:         ● AWAKE
  PID:            12345
  Session ID:     abc123-def4-5678-90ab-cdef12345678
  Uptime:         2h 15m
  Messages:       42

  Recent Activity
────────────────────────────────────────────────────────────────
  [14:23:15] Received: "What is the build status?"
  [14:23:17] Sent: "Build passing, all tests green"
  [14:24:01] Received: "Deploy to staging"
  [14:24:03] Sent: "Deploying..."

  [←] Back  [t] Tell  [s] Sleep  [c] Clear Cache  [q] Quit
```

---

## Design Mockups

### Spinner Components

**Loading indicator:**

```
⠋ Waking up team backend...
```

**Progress bar:**

```
Waking all teams...
████████████████░░░░░░░░ 60% (3/5)
```

**Implementation:**

```typescript
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

function WakingTeam({ team }) {
  return (
    <Box>
      <Text color="green">
        <Spinner type="dots" />
      </Text>
      <Text> Waking up team {team}...</Text>
    </Box>
  );
}
```

### Table Component

**Team list:**

```typescript
import { render } from 'ink';
import Table from 'ink-table';

const teams = [
  { name: 'frontend', status: '● AWAKE', messages: 42 },
  { name: 'backend', status: '● AWAKE', messages: 18 },
  { name: 'mobile', status: '○ ASLEEP', messages: 0 },
];

render(<Table data={teams} />);
```

**Output:**

```
┌───────────┬──────────┬──────────┐
│ name      │ status   │ messages │
├───────────┼──────────┼──────────┤
│ frontend  │ ● AWAKE  │ 42       │
│ backend   │ ● AWAKE  │ 18       │
│ mobile    │ ○ ASLEEP │ 0        │
└───────────┴──────────┴──────────┘
```

---

## Implementation Plan

### Phase 4.1: Basic Commands

**Milestone 1:**
- [ ] Commander.js command parsing
- [ ] Configuration commands (install, add-team, etc.)
- [ ] Basic team commands (tell, wake, sleep)
- [ ] Output formatting with chalk

**Example:**
```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('iris')
  .description('Iris MCP CLI')
  .version('1.0.0');

program
  .command('tell <team> <message>')
  .description('Send message to team')
  .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
  .option('--async', 'Send asynchronously')
  .action(async (team, message, options) => {
    const result = await fetch('http://localhost:1615/api/teams/tell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toTeam: team,
        message,
        timeout: parseInt(options.timeout),
      }),
    });

    const data = await result.json();
    console.log(data.response);
  });

program.parse();
```

### Phase 4.2: Interactive UI (Ink)

**Milestone 2:**
- [ ] Ink setup with React
- [ ] Live monitor dashboard
- [ ] Interactive team selection
- [ ] Message editor with text input
- [ ] Real-time WebSocket updates

**Component Library:**
```typescript
// src/cli/components/
├── Dashboard.tsx         // Main monitor dashboard
├── TeamList.tsx          // Interactive team selection
├── TeamDetails.tsx       // Detailed team view
├── MessageEditor.tsx     // Multi-line message input
├── StatusBadge.tsx       // Awake/Asleep indicator
├── ProcessMetrics.tsx    // Process stats display
└── LogViewer.tsx         // Scrollable log tail
```

### Phase 4.3: Advanced Features

**Milestone 3:**
- [ ] Configuration wizard (interactive prompts)
- [ ] Autocomplete for team names
- [ ] Command history (up/down arrows)
- [ ] Keyboard shortcuts
- [ ] Color themes (light/dark)
- [ ] Export/import configurations

---

## Component Reuse with Dashboard

**Shared Components (Phase 2 & 4):**

```typescript
// Shared React component
function TeamStatusBadge({ status }: { status: 'awake' | 'asleep' }) {
  return (
    <Badge color={status === 'awake' ? 'green' : 'gray'}>
      {status === 'awake' ? '● AWAKE' : '○ ASLEEP'}
    </Badge>
  );
}

// Use in Web Dashboard (Phase 2)
import { TeamStatusBadge } from '@iris/shared/components';

function WebTeamList() {
  return <div><TeamStatusBadge status="awake" /></div>;
}

// Use in CLI (Phase 4)
import { TeamStatusBadge } from '@iris/shared/components';
import { Text } from 'ink';

function CLITeamList() {
  return <Text><TeamStatusBadge status="awake" /></Text>;
}
```

**Benefits:**
- Single source of truth for UI logic
- Consistent UX between web and terminal
- Faster development (write once, use twice)

---

## Error Handling

**User-Friendly Error Messages:**

```
✗ Failed to send message to team backend

  Reason: Team is currently processing another request
  Suggestion: Wait a moment and try again, or use --async flag

  For more details, run:
    iris logs --level error

  Need help? Visit https://docs.iris-mcp.com/troubleshooting
```

**Implementation:**

```typescript
try {
  const result = await iris.tell(team, message);
  console.log(`✓ ${result.response}`);
} catch (error) {
  console.error(`✗ Failed to send message to team ${team}\n`);
  console.error(`  Reason: ${error.message}`);
  console.error(`  Suggestion: ${getSuggestion(error)}\n`);
  process.exit(1);
}
```

---

## Configuration

**CLI-Specific Settings:**

```json
{
  "cli": {
    "theme": "dark",
    "editor": "vim",
    "defaultTimeout": 30000,
    "showSpinners": true,
    "colorOutput": true,
    "history": {
      "enabled": true,
      "maxSize": 1000
    }
  }
}
```

---

**Document Version:** 1.0 (Planned)
**Last Updated:** October 2025
**Status:** Design Phase
