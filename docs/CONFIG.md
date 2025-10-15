# Configuration Management Documentation

**Location:** `src/config/`
**Purpose:** Load, validate, and hot-reload configuration with Zod schemas
**Technology:** JSON configuration with fs.watchFile hot-reload

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration Structure](#configuration-structure)
3. [File Locations](#file-locations)
4. [Component Details](#component-details)
5. [Hot-Reload Mechanism](#hot-reload-mechanism)
6. [Validation with Zod](#validation-with-zod)
7. [Path Resolution](#path-resolution)
8. [CLI Integration](#cli-integration)

---

## Overview

The Configuration subsystem provides **validated, hot-reloadable settings** using:

- **JSON Configuration File:** `config.json` with settings and team definitions
- **Zod Validation:** Type-safe runtime validation with clear error messages
- **Hot-Reload:** Automatic reload on file changes (1s poll interval)
- **Path Resolution:** Relative paths resolved relative to config file
- **Default Config:** Built-in `config.default.json` template

---

## Configuration Structure

### Example config.json

```json
{
  "settings": {
    "sessionInitTimeout": 30000,
    "responseTimeout": 120000,
    "idleTimeout": 30000000,
    "maxProcesses": 10,
    "healthCheckInterval": 30000,
    "httpPort": 1615,
    "defaultTransport": "http"
  },
  "dashboard": {
    "enabled": true,
    "port": 3100,
    "host": "localhost"
  },
  "database": {
    "path": "data/team-sessions.db",
    "inMemory": false
  },
  "teams": {
    "team-alpha": {
      "path": "/Users/jenova/projects/alpha",
      "description": "Alpha team - Frontend development",
      "idleTimeout": 30000000,
      "skipPermissions": true,
      "color": "#FF6B9D"
    },
    "team-beta": {
      "path": "./projects/beta",
      "description": "Beta team - Backend services",
      "sessionInitTimeout": 45000,
      "color": "#4ECDC4"
    }
  }
}
```

---

## File Locations

### Search Order

1. **Environment Variable:** `IRIS_CONFIG_PATH`
   ```bash
   export IRIS_CONFIG_PATH=/custom/path/config.json
   iris start
   ```

2. **IRIS_HOME:** `$IRIS_HOME/config.json`
   ```bash
   export IRIS_HOME=/opt/iris
   # Looks for /opt/iris/config.json
   ```

3. **Default:** `~/.iris/config.json`
   ```bash
   # Default location on macOS/Linux
   /Users/jenova/.iris/config.json
   ```

### Directory Structure

```
~/.iris/                           # IRIS_HOME (default)
├── config.json                    # Main configuration
├── data/
│   └── team-sessions.db           # SQLite database
└── logs/                          # Future: log files
```

### Creating Default Config

```bash
# Install command creates default config
iris install

# Or manually copy
cp src/config.default.json ~/.iris/config.json
```

---

## Component Details

### TeamsConfigManager (teams-config.ts)

**Responsibility:** Load, validate, and watch configuration file

**Constructor:**

```typescript
class TeamsConfigManager {
  private config: TeamsConfig | null = null;
  private configPath: string;
  private watchCallback?: (config: TeamsConfig) => void;

  constructor(configPath?: string) {
    // Priority: provided > env var > default
    if (configPath) {
      this.configPath = configPath;
    } else if (process.env.IRIS_CONFIG_PATH) {
      this.configPath = resolve(process.env.IRIS_CONFIG_PATH);
    } else {
      this.configPath = getConfigPath(); // ~/.iris/config.json
    }

    ensureIrisHome(); // Create ~/.iris if doesn't exist
  }
}
```

### Method: load()

**Purpose:** Load and validate configuration from file

**Flow:**

```
┌────────────────────────────────────────────────────────────────┐
│         1. Check if config file exists                          │
│  if (!existsSync(configPath)):                                  │
│    Print installation instructions                              │
│    exit(0)                                                       │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         2. Read and parse JSON                                  │
│  content = readFileSync(configPath, 'utf8')                     │
│  parsed = JSON.parse(content)                                   │
│  → Catches SyntaxError for invalid JSON                         │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         3. Validate with Zod                                    │
│  validated = TeamsConfigSchema.parse(parsed)                    │
│  → Catches ZodError with detailed path/message                  │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         4. Check if teams configured                            │
│  if (Object.keys(validated.teams).length === 0):                │
│    Print team configuration instructions                        │
│    exit(0)                                                       │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         5. Resolve team paths                                   │
│  configDir = dirname(resolve(configPath))                       │
│  for each team:                                                 │
│    if (!isAbsolute(team.path)):                                 │
│      team.path = resolve(configDir, team.path)                  │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         6. Validate team paths exist                            │
│  for each team:                                                 │
│    if (!existsSync(team.path)):                                 │
│      logger.warn("Team path does not exist", ...)               │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         7. Store and return                                     │
│  this.config = validated                                        │
│  logger.info("Configuration loaded successfully")               │
│  return config                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Error Handling:**

```typescript
try {
  const validated = TeamsConfigSchema.parse(parsed);
  // ...
} catch (error) {
  if (error instanceof z.ZodError) {
    // Convert Zod errors to readable messages
    const messages = error.errors.map(e =>
      `${e.path.join('.')}: ${e.message}`
    );
    throw new ConfigurationError(
      `Configuration validation failed:\n${messages.join('\n')}`
    );
  }

  if (error instanceof SyntaxError) {
    throw new ConfigurationError(
      `Invalid JSON in configuration file: ${error.message}`
    );
  }

  throw error;
}
```

---

## Hot-Reload Mechanism

### Implementation

```typescript
watch(callback: (config: TeamsConfig) => void): void {
  this.watchCallback = callback;

  watchFile(this.configPath, { interval: 1000 }, () => {
    logger.info('Configuration file changed, reloading...');

    try {
      const newConfig = this.load();
      if (this.watchCallback) {
        this.watchCallback(newConfig);
      }
    } catch (error) {
      logger.error('Failed to reload configuration', error);
    }
  });

  logger.info('Watching configuration file for changes');
}
```

**Polling Interval:** 1 second (configurable via `interval` option)

**Event Trigger:** File modification time (mtime) changes

**Why Polling?** Cross-platform compatibility (works on all OSes without native fs events)

### Usage in index.ts

```typescript
// Watch for config changes
configManager.watch((newConfig) => {
  logger.info('Configuration reloaded', {
    teams: Object.keys(newConfig.teams),
    maxProcesses: newConfig.settings.maxProcesses,
  });

  // Future: Reload process pool, update settings
});
```

**Current Limitation:** Config reload doesn't yet update running processes. Future enhancement will apply changes dynamically.

---

## Validation with Zod

### Schema Definition

```typescript
import { z } from 'zod';

const IrisConfigSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
  description: z.string(),
  idleTimeout: z.number().positive().optional(),
  sessionInitTimeout: z.number().positive().optional(),
  skipPermissions: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
    .optional(),
});

const TeamsConfigSchema = z.object({
  settings: z.object({
    sessionInitTimeout: z.number().positive(),
    responseTimeout: z.number().positive(),
    idleTimeout: z.number().positive(),
    maxProcesses: z.number().int().min(1).max(50),
    healthCheckInterval: z.number().positive(),
    httpPort: z.number().int().min(1).max(65535).optional().default(1615),
    defaultTransport: z.enum(["stdio", "http"]).optional().default("stdio"),
  }),
  dashboard: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1).max(65535).default(3100),
    host: z.string().default("localhost"),
  }).optional().default({
    enabled: true,
    port: 3100,
    host: "localhost",
  }),
  database: z.object({
    path: z.string().optional().default("data/team-sessions.db"),
    inMemory: z.boolean().optional().default(false),
  }).optional().default({
    path: "data/team-sessions.db",
    inMemory: false,
  }),
  teams: z.record(z.string(), IrisConfigSchema),
});
```

### Validation Benefits

**Type Safety:**
```typescript
const config: TeamsConfig = configManager.getConfig();
// TypeScript knows: config.settings.maxProcesses is number
```

**Runtime Validation:**
```json
{
  "settings": {
    "maxProcesses": "ten"  // ❌ Error: Expected number, received string
  }
}
```

**Clear Error Messages:**
```
Configuration validation failed:
settings.maxProcesses: Expected number, received string
teams.alpha.path: String must contain at least 1 character(s)
teams.beta.color: Invalid hex color
```

---

## Path Resolution

### Absolute vs Relative Paths

**Absolute Path (Recommended):**
```json
{
  "teams": {
    "alpha": {
      "path": "/Users/jenova/projects/alpha"
    }
  }
}
```

**Relative Path (Resolved from config file location):**
```json
{
  "teams": {
    "beta": {
      "path": "../projects/beta"
    }
  }
}
```

### Resolution Algorithm

```typescript
const configDir = dirname(resolve(this.configPath));

for (const [name, team] of Object.entries(validated.teams)) {
  if (!isAbsolute(team.path)) {
    // Resolve relative to config file directory
    team.path = resolve(configDir, team.path);
  }

  // Validate resolved path exists
  if (!existsSync(team.path)) {
    logger.warn(`Team "${name}" path does not exist: ${team.path}`);
  }
}
```

**Example:**

```
Config file: /Users/jenova/.iris/config.json
Team path:   "./projects/alpha"
Resolved:    /Users/jenova/.iris/projects/alpha
```

---

## CLI Integration

### Installation Command

```bash
iris install
```

**Actions:**
1. Create `~/.iris/` directory
2. Copy `src/config.default.json` to `~/.iris/config.json`
3. Register Iris with Claude CLI config (`~/.claude/config.json`)

### Add Team Command

```bash
iris add-team <name> [path]
```

**Actions:**
1. Load existing config
2. Add new team entry
3. Write back to config file
4. Validate with Zod

**Example:**
```bash
iris add-team frontend /Users/jenova/projects/frontend
```

**Result:**
```json
{
  "teams": {
    "frontend": {
      "path": "/Users/jenova/projects/frontend",
      "description": "frontend team"
    }
  }
}
```

---

## Configuration Reference

### Settings Section

```typescript
interface Settings {
  sessionInitTimeout: number;     // 30000ms (30s) - session file creation
  responseTimeout: number;        // 120000ms (2min) - process health timeout
  idleTimeout: number;            // 30000000ms (8.3hr) - idle process cleanup
  maxProcesses: number;           // 10 - pool size limit (LRU eviction)
  healthCheckInterval: number;    // 30000ms (30s) - health check frequency
  httpPort?: number;              // 1615 - HTTP transport port (Phase 3)
  defaultTransport?: "stdio" | "http";  // "stdio" - MCP transport mode
}
```

### Dashboard Section (Phase 2)

```typescript
interface Dashboard {
  enabled: boolean;    // true - enable web dashboard
  port: number;        // 3100 - dashboard HTTP port
  host: string;        // "localhost" - bind address
}
```

### Database Section

```typescript
interface Database {
  path?: string;       // "data/team-sessions.db" - path to database file (relative to IRIS_HOME or absolute)
  inMemory?: boolean;  // false - use in-memory database (for testing)
}
```

**Path Resolution:**

- **Relative paths** are resolved relative to `IRIS_HOME` (default: `~/.iris`)
- **Absolute paths** are used as-is
- Default: `data/team-sessions.db` (resolves to `~/.iris/data/team-sessions.db`)

**In-Memory Mode:**

Set `inMemory: true` to use SQLite in-memory database. Useful for:
- Running tests without persisting data
- Temporary sessions
- Development environments

**Example - Custom Path:**

```json
{
  "database": {
    "path": "/var/lib/iris/sessions.db"
  }
}
```

**Example - In-Memory (Testing):**

```json
{
  "database": {
    "inMemory": true
  }
}
```

### Team Configuration

```typescript
interface IrisConfig {
  path: string;                   // Absolute or relative path to project
  description: string;            // Human-readable description
  idleTimeout?: number;           // Optional override for this team
  sessionInitTimeout?: number;    // Optional override for this team
  skipPermissions?: boolean;      // Auto-approve all Claude actions
  color?: string;                 // Hex color for UI (#FF6B9D)
}
```

**Per-Team Overrides:**

Teams can override global settings:

```json
{
  "settings": {
    "idleTimeout": 30000000
  },
  "teams": {
    "long-running": {
      "path": "/path/to/project",
      "idleTimeout": 86400000  // 24 hours (overrides global)
    }
  }
}
```

---

## Error Messages

### Config File Not Found

```
╔════════════════════════════════════════════════════════════════════╗
║           Iris MCP - Configuration Not Found                      ║
╚════════════════════════════════════════════════════════════════════╝

Configuration file not found: /Users/jenova/.iris/config.json

Run the install command to create the default configuration:

  $ iris install

This will:
  1. Create the Iris MCP configuration file
  2. Install Iris to your Claude CLI configuration
```

### No Teams Configured

```
╔════════════════════════════════════════════════════════════════════╗
║           Iris MCP - No Teams Configured                          ║
╚════════════════════════════════════════════════════════════════════╝

Configuration file: /Users/jenova/.iris/config.json

No teams are configured. Add teams to get started:

Add a team using current directory:
  $ iris add-team <name>

Add a team with specific path:
  $ iris add-team <name> /path/to/project

Show add-team help:
  $ iris add-team --help
```

### Validation Errors

```
Configuration validation failed:
settings.maxProcesses: Number must be less than or equal to 50
settings.sessionInitTimeout: Expected number, received string
teams.alpha.path: String must contain at least 1 character(s)
teams.beta.color: Invalid hex color
```

---

## API Reference

### TeamsConfigManager

```typescript
class TeamsConfigManager {
  constructor(configPath?: string);

  // Load configuration from file
  load(): TeamsConfig;

  // Get current configuration (throws if not loaded)
  getConfig(): TeamsConfig;

  // Get configuration for specific team
  getIrisConfig(teamName: string): IrisConfig | null;

  // Get list of all team names
  getTeamNames(): string[];

  // Watch for config file changes
  watch(callback: (config: TeamsConfig) => void): void;
}
```

### Helper Functions

```typescript
// Get default config path (~/.iris/config.json)
function getConfigPath(): string;

// Ensure IRIS_HOME directory exists
function ensureIrisHome(): void;

// Get singleton config manager
function getConfigManager(configPath?: string): TeamsConfigManager;
```

---

## Testing

### Unit Tests

```typescript
describe("TeamsConfigManager", () => {
  it("should load valid configuration", () => {
    const manager = new TeamsConfigManager("test-config.json");
    const config = manager.load();
    expect(config.settings.maxProcesses).toBe(10);
  });

  it("should reject invalid JSON", () => {
    expect(() => {
      manager.load();
    }).toThrow("Invalid JSON");
  });

  it("should validate with Zod", () => {
    expect(() => {
      manager.load();
    }).toThrow("Expected number, received string");
  });
});
```

---

## Future Enhancements

### 1. Dynamic Config Reload

**Current:** Hot-reload logs but doesn't update running processes

**Enhancement:** Apply configuration changes to running system
- Update process pool maxProcesses
- Adjust timeout values
- Add/remove teams dynamically

### 2. Config Validation CLI

```bash
iris config validate
```

Check config file without starting server

### 3. Config Schema Export

```bash
iris config schema > schema.json
```

Export JSON Schema for editor autocomplete

---

**Document Version:** 1.0
**Last Updated:** October 2025
