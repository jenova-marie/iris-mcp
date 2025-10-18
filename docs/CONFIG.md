# Configuration Management Documentation

**Location:** `src/config/`
**Purpose:** Load, validate, and hot-reload configuration with Zod schemas
**Technology:** YAML configuration with environment variable interpolation and fs.watchFile hot-reload

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration Structure](#configuration-structure)
3. [File Locations](#file-locations)
4. [Environment Variable Interpolation](#environment-variable-interpolation)
5. [Component Details](#component-details)
6. [Hot-Reload Mechanism](#hot-reload-mechanism)
7. [Validation with Zod](#validation-with-zod)
8. [Path Resolution](#path-resolution)
9. [Permission Approval System](#permission-approval-system)
10. [CLI Integration](#cli-integration)

---

## Overview

The Configuration subsystem provides **validated, hot-reloadable settings** using:

- **YAML Configuration File:** `config.yaml` with settings and team definitions
- **Environment Variable Interpolation:** `${VAR:-default}` syntax for dynamic configuration
- **Zod Validation:** Type-safe runtime validation with clear error messages
- **Hot-Reload:** Automatic reload on file changes (1s poll interval)
- **Path Resolution:** Relative paths resolved relative to config file
- **Default Config:** Built-in `default.config.yaml` template with extensive documentation

---

## Configuration Structure

### Example config.yaml

```yaml
settings:
  sessionInitTimeout: 30000
  responseTimeout: 120000
  idleTimeout: 3600000
  maxProcesses: 10
  healthCheckInterval: 30000
  httpPort: 1615
  defaultTransport: http
  hotReloadConfig: true  # Enable automatic config reload

dashboard:
  enabled: true
  http: 3100
  https: 0
  host: localhost

database:
  path: data/team-sessions.db
  inMemory: false

teams:
  team-alpha:
    path: /Users/jenova/projects/alpha
    description: Alpha team - Frontend development
    idleTimeout: 3600000
    grantPermission: yes
    color: "#FF6B9D"

  team-beta:
    path: ./projects/beta
    description: Beta team - Backend services
    sessionInitTimeout: 45000
    grantPermission: ask
    color: "#4ECDC4"
```

---

## File Locations

### Search Order

1. **Environment Variable:** `IRIS_CONFIG_PATH`
   ```bash
   export IRIS_CONFIG_PATH=/custom/path/config.yaml
   iris start
   ```

2. **IRIS_HOME:** `$IRIS_HOME/config.yaml`
   ```bash
   export IRIS_HOME=/opt/iris
   # Looks for /opt/iris/config.yaml
   ```

3. **Default:** `~/.iris/config.yaml`
   ```bash
   # Default location on macOS/Linux
   /Users/jenova/.iris/config.yaml
   ```

### Directory Structure

```
~/.iris/                           # IRIS_HOME (default)
├── config.yaml                    # Main configuration
├── data/
│   └── team-sessions.db           # SQLite database
└── logs/                          # Future: log files
```

### Creating Default Config

```bash
# Install command creates default config
iris install

# Or manually copy
cp src/default.config.yaml ~/.iris/config.yaml
```

---

## Environment Variable Interpolation

### Syntax

Iris configuration supports environment variable interpolation using the `${VAR}` syntax:

**Required Variable:**
```yaml
httpPort: ${IRIS_HTTP_PORT}
```
Throws error if `IRIS_HTTP_PORT` is not set.

**Optional Variable with Default:**
```yaml
httpPort: ${IRIS_HTTP_PORT:-1615}
```
Uses `1615` if `IRIS_HTTP_PORT` is not set.

### Common Use Cases

**Development vs Production:**
```yaml
settings:
  idleTimeout: ${IRIS_IDLE_TIMEOUT:-300000}  # 5 min dev, custom prod
  maxProcesses: ${IRIS_MAX_PROCESSES:-10}

database:
  path: ${IRIS_DB_PATH:-data/team-sessions.db}
```

**Dynamic Port Configuration:**
```yaml
settings:
  httpPort: ${PORT:-1615}

dashboard:
  http: ${DASHBOARD_PORT:-3100}
```

**Team-Specific Overrides:**
```yaml
teams:
  team-production:
    path: ${PROD_PATH:-/opt/app}
    idleTimeout: ${PROD_TIMEOUT:-1800000}
```

### Environment File Example

Create `.env` file:
```bash
# Iris MCP Configuration
IRIS_HTTP_PORT=1615
IRIS_MAX_PROCESSES=20
IRIS_IDLE_TIMEOUT=600000
IRIS_DB_PATH=/var/lib/iris/sessions.db
```

Load before starting:
```bash
source .env
iris-mcp
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
      this.configPath = getConfigPath(); // ~/.iris/config.yaml
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
│         2. Read and parse YAML                                  │
│  content = readFileSync(configPath, 'utf8')                     │
│  parsed = parseYaml(content)                                    │
│  → Catches YAMLParseError for invalid syntax                    │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         3. Interpolate environment variables                    │
│  interpolated = interpolateObject(parsed, true)                 │
│  → Replaces ${VAR:-default} with env values                     │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         4. Validate with Zod                                    │
│  validated = TeamsConfigSchema.parse(interpolated)              │
│  → Catches ZodError with detailed path/message                  │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         5. Check if teams configured                            │
│  if (Object.keys(validated.teams).length === 0):                │
│    Print team configuration instructions                        │
│    exit(0)                                                       │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         6. Resolve team paths                                   │
│  configDir = dirname(resolve(configPath))                       │
│  for each team:                                                 │
│    if (!isAbsolute(team.path)):                                 │
│      team.path = resolve(configDir, team.path)                  │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         7. Validate team paths exist                            │
│  for each team:                                                 │
│    if (!existsSync(team.path)):                                 │
│      logger.warn("Team path does not exist", ...)               │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         8. Store and return                                     │
│  this.config = validated                                        │
│  logger.info("Configuration loaded successfully")               │
│  return config                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Error Handling:**

```typescript
try {
  const parsed = parseYaml(content);
  const interpolated = interpolateObject(parsed, true);
  const validated = TeamsConfigSchema.parse(interpolated);
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

  if (error instanceof Error && error.name === 'YAMLParseError') {
    throw new ConfigurationError(
      `Invalid YAML in configuration file: ${error.message}`
    );
  }

  if (error instanceof Error && error.message.includes('Environment variable')) {
    throw new ConfigurationError(error.message);
  }

  throw error;
}
```

---

## Hot-Reload Mechanism

### Overview

Hot reload allows Iris to automatically detect and apply configuration changes without restarting the server. This is controlled by the `hotReloadConfig` setting in your configuration file.

**Key Behavior:**
- Configuration changes are applied to **new sessions only**
- Existing sessions and running processes are **not affected**
- Hot reload is **opt-in** (disabled by default for safety)

### Enabling Hot Reload

Add `hotReloadConfig: true` to your settings:

```yaml
settings:
  hotReloadConfig: true  # Enable automatic config reload
  sessionInitTimeout: 30000
  maxProcesses: 10
```

When enabled, Iris will log:
```
[iris:cli] Hot reload enabled - watching config.yaml for changes
```

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
// Enable hot reload if configured
if (config.settings.hotReloadConfig) {
  logger.info("Hot reload enabled - watching config.yaml for changes");
  configManager.watch((newConfig) => {
    logger.info(
      {
        teams: Object.keys(newConfig.teams),
        maxProcesses: newConfig.settings.maxProcesses,
      },
      "Configuration reloaded - changes will apply to new sessions",
    );
  });
}
```

### What Gets Reloaded?

When the config file changes, Iris reloads:
- ✅ Team definitions (added, removed, or modified teams)
- ✅ Team paths and descriptions
- ✅ Permission modes (`grantPermission`)
- ✅ Timeout values (`sessionInitTimeout`, `idleTimeout`, etc.)
- ✅ Process pool limits (`maxProcesses`)
- ✅ Tool allowlists/denylists (`allowedTools`, `disallowedTools`)
- ✅ System prompt customizations (`appendSystemPrompt`)

### What Doesn't Get Reloaded?

The following require a server restart:
- ❌ Dashboard settings (`dashboard.http`, `dashboard.https`)
- ❌ Database path (`database.path`)
- ❌ HTTP port (`settings.httpPort`)
- ❌ Transport mode (`settings.defaultTransport`)
- ❌ Wonder Logger configuration (`settings.wonderLoggerConfig`)

### Example: Adding a Team Without Restart

**Before** (config.yaml):
```yaml
settings:
  hotReloadConfig: true

teams:
  team-alpha:
    path: /path/to/alpha
    description: Alpha team
```

**Edit config.yaml** (while server is running):
```yaml
settings:
  hotReloadConfig: true

teams:
  team-alpha:
    path: /path/to/alpha
    description: Alpha team

  team-beta:  # Add new team
    path: /path/to/beta
    description: Beta team
    grantPermission: ask
```

**Server logs:**
```
[config:teams] Configuration file changed, reloading...
[config:teams] Configuration loaded successfully { teams: ['team-alpha', 'team-beta'], maxProcesses: 10 }
[iris:cli] Configuration reloaded - changes will apply to new sessions { teams: ['team-alpha', 'team-beta'], maxProcesses: 10 }
```

**Result:**
- `team-beta` is immediately available for new sessions
- Existing `team-alpha` sessions continue unaffected

### Security Considerations

**Why Disabled by Default?**

Hot reload is disabled by default because:
1. **Unexpected Changes:** Configuration changes may not be immediately visible if processes are cached
2. **Permission Changes:** A team's permission mode could change mid-session
3. **Production Safety:** Production environments often want explicit restart for config changes

**When to Enable:**

Enable hot reload when:
- ✅ Actively developing or testing
- ✅ Frequently adding/removing teams
- ✅ Experimenting with timeout values
- ✅ Non-critical environments

**When to Disable:**

Keep hot reload disabled when:
- ❌ Production deployments
- ❌ You want explicit control over when config changes take effect
- ❌ Running in CI/CD environments
- ❌ Stability is critical

### Error Handling

**Invalid Configuration:**

If you save an invalid config while hot reload is enabled, the error is logged but the server continues with the last valid configuration:

```
[config:teams] Configuration file changed, reloading...
[config:teams] Failed to reload configuration {
  err: ConfigurationError: Configuration validation failed:
    teams.beta.path: String must contain at least 1 character(s)
}
```

The server continues running with the previous valid configuration.

**YAML Syntax Errors:**

```
[config:teams] Failed to reload configuration {
  err: ConfigurationError: Invalid YAML in configuration file: bad indentation
}
```

Fix the YAML syntax and save again - the watcher will retry automatically.

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
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
    .optional(),
  // Phase 2: Remote execution via SSH
  remote: z.string().optional(),
  ssh2: z.boolean().optional(),
  remoteOptions: z.object({
    identity: z.string().optional(),
    passphrase: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    strictHostKeyChecking: z.boolean().optional(),
    connectTimeout: z.number().positive().optional(),
    serverAliveInterval: z.number().positive().optional(),
    serverAliveCountMax: z.number().int().positive().optional(),
    compression: z.boolean().optional(),
    forwardAgent: z.boolean().optional(),
    extraSshArgs: z.array(z.string()).optional(),
  }).optional(),
  claudePath: z.string().optional(),
  // Reverse MCP tunneling
  enableReverseMcp: z.boolean().optional(),
  reverseMcpPort: z.number().int().min(1).max(65535).optional(),
  allowHttp: z.boolean().optional(),
  mcpConfigScript: z.string().optional(),
  // Permission approval mode
  grantPermission: z.enum(["yes", "no", "ask", "forward"]).optional().default("ask"),
  // Tool allowlist/denylist
  allowedTools: z.string().optional(),
  disallowedTools: z.string().optional(),
  // System prompt customization
  appendSystemPrompt: z.string().optional(),
})
.refine((data) => {
  if (data.remote && !data.claudePath) return false;
  return true;
}, {
  message: "claudePath is required when remote is specified",
  path: ["claudePath"],
})
.refine((data) => {
  if (data.enableReverseMcp && !data.remote) return false;
  return true;
}, {
  message: "enableReverseMcp requires remote execution to be configured",
  path: ["enableReverseMcp"],
});

const TeamsConfigSchema = z.object({
  settings: z.object({
    sessionInitTimeout: z.number().positive().optional().default(30000),
    spawnTimeout: z.number().positive().optional().default(20000),
    responseTimeout: z.number().positive().optional().default(120000),
    idleTimeout: z.number().positive().optional().default(3600000),
    maxProcesses: z.number().int().min(1).max(50).optional().default(10),
    healthCheckInterval: z.number().positive().optional().default(30000),
    httpPort: z.number().int().min(1).max(65535).optional().default(1615),
    defaultTransport: z.enum(["stdio", "http"]).optional().default("stdio"),
    wonderLoggerConfig: z.string().optional().default("./wonder-logger.yaml"),
  }),
  dashboard: z.object({
    enabled: z.boolean().default(true),
    host: z.string().default("localhost"),
    http: z.number().int().min(0).max(65535).optional().default(0),
    https: z.number().int().min(0).max(65535).optional().default(3100),
    selfsigned: z.boolean().optional().default(false),
    certPath: z.string().optional(),
    keyPath: z.string().optional(),
  }).optional(),
  database: z.object({
    path: z.string().optional().default("data/team-sessions.db"),
    inMemory: z.boolean().optional().default(false),
  }).optional(),
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
```yaml
settings:
  maxProcesses: "ten"  # ❌ Error: Expected number, received string
```

**Clear Error Messages:**
```
Configuration validation failed:
settings.maxProcesses: Expected number, received string
teams.alpha.path: String must contain at least 1 character(s)
teams.beta.color: Invalid hex color
teams.gamma.grantPermission: Invalid enum value. Expected 'yes' | 'no' | 'ask' | 'forward', received 'maybe'
```

---

## Path Resolution

### Absolute vs Relative Paths

**Absolute Path (Recommended):**
```yaml
teams:
  alpha:
    path: /Users/jenova/projects/alpha
```

**Relative Path (Resolved from config file location):**
```yaml
teams:
  beta:
    path: ../projects/beta
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
Config file: /Users/jenova/.iris/config.yaml
Team path:   "./projects/alpha"
Resolved:    /Users/jenova/.iris/projects/alpha
```

---

## Permission Approval System

### grantPermission Field

The `grantPermission` field controls how Claude handles permission requests for file operations and tool usage. This is **Phase 1** (schema only) - the implementation is planned for a future release.

**Type:** `enum ["yes", "no", "ask", "forward"]`
**Default:** `"ask"` (manual approval for safety)

### Permission Modes

**`yes` - Auto-Approve**
```yaml
teams:
  team-dev:
    grantPermission: yes
```
- All Claude actions are automatically approved
- No user interaction required
- **Use case:** Trusted development environments
- **Warning:** Claude has full file system access

**`no` - Auto-Deny**
```yaml
teams:
  team-readonly:
    grantPermission: no
```
- All Claude actions are automatically denied
- Claude can only read files, not modify
- **Use case:** Read-only analysis, code review teams
- **Note:** May limit Claude's effectiveness

**`ask` - Interactive Prompt (Default)**
```yaml
teams:
  team-prod:
    grantPermission: ask
```
- User is prompted for each action
- Interactive approval via terminal/UI
- **Use case:** Production environments, sensitive codebases
- **Note:** Requires user presence

**`forward` - Relay to Calling Team**
```yaml
teams:
  team-remote:
    grantPermission: forward
```
- Permission request is forwarded to the calling team
- Useful for remote execution scenarios
- **Use case:** Cross-team coordination with delegation
- **Note:** Requires Reverse MCP to be enabled

### Configuration Examples

**Development Team (Trusted):**
```yaml
team-frontend:
  path: /Users/you/projects/frontend
  description: Frontend development team
  grantPermission: yes  # Auto-approve all actions
```

**Production Team (Careful):**
```yaml
team-prod:
  path: /opt/production/app
  description: Production deployment team
  grantPermission: ask  # Prompt for each action
```

**Read-Only Analysis:**
```yaml
team-security:
  path: /Users/you/projects/audit
  description: Security audit team (read-only)
  grantPermission: no  # Deny all write operations
```

**Remote Execution with Delegation:**
```yaml
team-remote:
  remote: ssh user@remote-host
  claudePath: ~/.local/bin/claude
  path: /home/user/projects/app
  grantPermission: forward  # Forward to calling team
  enableReverseMcp: true
```

**Old (deprecated):**
```yaml
teams:
  team-alpha:
```

**New (recommended):**
```yaml
teams:
  team-alpha:
    grantPermission: yes  # Auto-approve (explicit)
```

**Compatibility:** Both fields are supported during the transition period. `grantPermission` takes precedence if both are set.

---

## MCP Configuration File System

### Overview

When `enableReverseMcp: true` is set, Iris writes MCP configuration files to enable Claude Code instances to communicate back with the Iris MCP server. The configuration file contains server connection details and must be passed to Claude via the `--mcp-config` flag.

**Architecture:** All filesystem operations are delegated to external shell scripts, keeping TypeScript code free of direct file I/O. TypeScript streams JSON to script stdin, scripts handle file writing and return file paths via stdout.

### Default Scripts

Iris provides four bundled scripts in `examples/scripts/`:

**Local Execution (Unix):**
- `mcp-cp.sh` - Writes config to team's `.claude/iris/mcp` directory
- Location: `<team-path>/.claude/iris/mcp/iris-mcp-{sessionId}.json`
- Creates directory with `chmod 700`, sets file to `chmod 600` (owner-only)

**Local Execution (Windows):**
- `mcp-cp.ps1` - PowerShell version for Windows
- Location: `<team-path>\.claude\iris\mcp\iris-mcp-{sessionId}.json`
- Creates directory and sets ACLs for owner-only access

**Remote Execution via SCP (Unix):**
- `mcp-scp.sh` - Writes to local temp, SCPs to remote host, cleans up local file
- Remote location: `<remote-team-path>/.claude/iris/mcp/iris-mcp-{sessionId}.json`
- Creates remote directory with `chmod 700`, sets file to `chmod 600`

**Remote Execution via SCP (Windows):**
- `mcp-scp.ps1` - PowerShell version for Windows
- Uses OpenSSH for Windows (ssh, scp commands)
- Same remote location as Unix version

### Script Interface

All scripts follow the same contract:

**Input (stdin):** JSON configuration object
```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["/path/to/iris-mcp/dist/index.js"],
      "env": {
        "IRIS_REVERSE_MCP_SESSION_ID": "abc123"
      }
    }
  }
}
```

**Output (stdout):** File path where config was written
```
/path/to/team/.claude/iris/mcp/iris-mcp-abc123.json
```

**Arguments:**
- **Local scripts**: `<sessionId> <team-path>`
- **Remote scripts**: `<sessionId> <sshHost> <remote-team-path>`

### Custom Scripts

Users can provide custom scripts via the `mcpConfigScript` field:

```yaml
teams:
  team-custom:
    path: /path/to/project
    enableReverseMcp: true
    mcpConfigScript: /path/to/custom-mcp-writer.sh
```

**Requirements:**
1. Script must accept JSON on stdin
2. Script must output file path to stdout (last non-empty line)
3. Script must exit with code 0 on success
4. For remote teams, script receives `<sessionId> <sshHost> <remote-team-path>` args
5. For local teams, script receives `<sessionId> <team-path>` args

**Example Custom Script:**
```bash
#!/usr/bin/env bash
# custom-mcp-writer.sh - Write to team's .claude/iris/mcp directory

SESSION_ID="$1"
TEAM_PATH="$2"

if [ -z "$SESSION_ID" ] || [ -z "$TEAM_PATH" ]; then
  echo "ERROR: Session ID and team path required" >&2
  exit 1
fi

# Create .claude/iris/mcp directory
MCP_DIR="${TEAM_PATH}/.claude/iris/mcp"
mkdir -p "$MCP_DIR"
chmod 700 "$MCP_DIR"

FILE_PATH="$MCP_DIR/iris-mcp-${SESSION_ID}.json"

# Read JSON from stdin
cat > "$FILE_PATH"
chmod 600 "$FILE_PATH"

# Output file path to stdout
echo "$FILE_PATH"
```

### Configuration Examples

**Default (bundled scripts):**
```yaml
teams:
  team-local:
    path: /path/to/project
    enableReverseMcp: true
    # Uses bundled mcp-cp.sh or mcp-cp.ps1
```

**Custom local directory:**
```yaml
teams:
  team-local:
    path: /path/to/project
    enableReverseMcp: true
    mcpConfigScript: /path/to/scripts/mcp-custom.sh
```

**Remote execution:**
```yaml
teams:
  team-remote:
    path: /remote/path/to/project
    remote: user@remote-host
    enableReverseMcp: true
    # Uses bundled mcp-scp.sh or mcp-scp.ps1
```

**Remote with custom script:**
```yaml
teams:
  team-remote:
    path: /remote/path/to/project
    remote: user@remote-host
    enableReverseMcp: true
    mcpConfigScript: /path/to/scripts/mcp-custom-scp.sh
```

### File Lifecycle

1. **Spawn:** Before spawning Claude process, transport writes MCP config file
2. **Execution:** File path passed to Claude via `--mcp-config <filepath>`
3. **Termination:** When transport terminates, config file is deleted
   - **Local:** `fs.unlink()` via Node.js
   - **Remote:** `ssh <host> rm -f <filepath>` for cleanup

### Security Considerations

**File Permissions:**
- Config files contain server connection details
- Default scripts set restrictive permissions (600 / owner-only)
- Remote directories created with 700 permissions

**Temporary Files:**
- Local configs written to `/tmp` or `%TEMP%` by default
- Remote scripts use `mktemp` for secure temp file creation
- Cleanup on both success and failure (trap EXIT)

**SSH Security:**
- Remote scripts use existing SSH configuration
- No passwords or keys stored in config files
- Relies on user's `~/.ssh/config` and agent

### Troubleshooting

**Script Not Found:**
```
Failed to execute MCP config script: ENOENT
```
- Verify script path in `mcpConfigScript` is absolute
- Ensure script has execute permissions (`chmod +x`)

**Permission Denied:**
```
MCP config script failed (exit code 1): Permission denied
```
- Check script execute permissions
- For remote: verify SSH key authentication works
- For remote: ensure remote directory is writable

**Config File Not Created:**
```
MCP config script did not output a file path
```
- Script must output file path to stdout
- Check script exits with code 0
- Verify script's stdout isn't being redirected

**Remote SCP Failures:**
```
scp: Connection refused
```
- Verify SSH connection works: `ssh <host> echo test`
- Check `remote` field is correctly formatted
- Ensure remote host has scp installed

---

## CLI Integration

### Installation Command

```bash
iris install
```

**Actions:**
1. Create `~/.iris/` directory
2. Copy `src/default.config.yaml` to `~/.iris/config.yaml`
3. Register Iris with Claude CLI config (`~/.claude/config.yaml`)

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
```yaml
teams:
  frontend:
    path: /Users/jenova/projects/frontend
    description: frontend team
    grantPermission: yes
```

---

## Configuration Reference

### Settings Section

```typescript
interface Settings {
  sessionInitTimeout: number;     // 30000ms (30s) - session file creation
  spawnTimeout: number;           // 20000ms (20s) - process spawn timeout
  responseTimeout: number;        // 120000ms (2min) - process health timeout
  idleTimeout: number;            // 3600000ms (1hr) - idle process cleanup
  maxProcesses: number;           // 10 - pool size limit (LRU eviction)
  healthCheckInterval: number;    // 30000ms (30s) - health check frequency
  httpPort?: number;              // 1615 - HTTP transport port (Phase 3)
  defaultTransport?: "stdio" | "http";  // "stdio" - MCP transport mode
  wonderLoggerConfig?: string;    // "./wonder-logger.yaml" - observability config
  hotReloadConfig?: boolean;      // false - enable automatic config reload
}
```

### Dashboard Section (Phase 2)

```typescript
interface Dashboard {
  enabled: boolean;    // true - enable web dashboard
  host: string;        // "localhost" - bind address
  http: number;        // 3100 - HTTP port (0 = disabled)
  https: number;       // 0 - HTTPS port (0 = disabled)
  selfsigned: boolean; // false - use self-signed cert
  certPath?: string;   // Path to SSL certificate
  keyPath?: string;    // Path to SSL private key
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

```yaml
database:
  path: /var/lib/iris/sessions.db
```

**Example - In-Memory (Testing):**

```yaml
database:
  inMemory: true
```

### Team Configuration

```typescript
interface IrisConfig {
  path: string;                   // Absolute or relative path to project
  description: string;            // Human-readable description
  idleTimeout?: number;           // Optional override for this team
  sessionInitTimeout?: number;    // Optional override for this team
  color?: string;                 // Hex color for UI (#FF6B9D)
  // Remote execution
  remote?: string;                // SSH connection string (e.g., "user@host")
  ssh2?: boolean;                 // Use ssh2 library instead of OpenSSH (default: false)
  remoteOptions?: RemoteOptions;  // SSH connection options
  claudePath?: string;            // Custom Claude CLI path (supports ~ expansion)
  // Reverse MCP tunneling
  enableReverseMcp?: boolean;     // Enable reverse MCP tunnel for this team
  reverseMcpPort?: number;        // Port to tunnel (default: 1615)
  allowHttp?: boolean;            // Allow HTTP for reverse MCP (dev only)
  mcpConfigScript?: string;       // Custom script path for writing MCP config files
  // Permission approval mode
  grantPermission?: "yes" | "no" | "ask" | "forward";  // Permission mode (default: "ask")
  // Tool allowlist/denylist
  allowedTools?: string;          // Comma-separated list of allowed MCP tools
  disallowedTools?: string;       // Comma-separated list of denied MCP tools
  // System prompt customization
  appendSystemPrompt?: string;    // Additional system prompt to append
}
```

**Per-Team Overrides:**

Teams can override global settings:

```yaml
settings:
  idleTimeout: 3600000

teams:
  long-running:
    path: /path/to/project
    idleTimeout: 86400000  # 24 hours (overrides global)
    grantPermission: ask   # Require approval for this team
```

---

## Error Messages

### Config File Not Found

```
╔════════════════════════════════════════════════════════════════════╗
║           Iris MCP - Configuration Not Found                      ║
╚════════════════════════════════════════════════════════════════════╝

Configuration file not found: /Users/jenova/.iris/config.yaml

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

Configuration file: /Users/jenova/.iris/config.yaml

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
teams.gamma.grantPermission: Invalid enum value. Expected 'yes' | 'no' | 'ask' | 'forward', received 'auto'
```

### Environment Variable Errors

```
Configuration validation failed:
Environment variable IRIS_HTTP_PORT is not set (required)
```

```
Configuration validation failed:
Environment variable PROD_PATH is not set and no default provided
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
// Get default config path (~/.iris/config.yaml)
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
    const manager = new TeamsConfigManager("test-config.yaml");
    const config = manager.load();
    expect(config.settings.maxProcesses).toBe(10);
  });

  it("should reject invalid YAML", () => {
    expect(() => {
      manager.load();
    }).toThrow("Invalid YAML");
  });

  it("should validate with Zod", () => {
    expect(() => {
      manager.load();
    }).toThrow("Expected number, received string");
  });

  it("should interpolate environment variables", () => {
    process.env.IRIS_HTTP_PORT = "8080";
    const config = manager.load();
    expect(config.settings.httpPort).toBe(8080);
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

### 4. Permission Approval Implementation

**Current:** Schema only (grantPermission field defined)

**Planned:** Full implementation with:
- Interactive prompts for `ask` mode
- Permission forwarding for `forward` mode
- Audit logging for all permission decisions
- Dashboard UI for permission management

See [PERMISSION_APPROVAL_PLAN.md](./future/PERMISSION_APPROVAL_PLAN.md) for implementation details.

---

## Tech Writer Notes

**Coverage Areas:**
- YAML configuration format and structure
- Environment variable interpolation syntax (`${VAR:-default}`)
- Zod schema validation and error handling
- Hot-reload mechanism with fs.watchFile
- Path resolution (absolute vs relative)
- Permission approval system (grantPermission field)
- CLI integration (install, add-team commands)
- TeamsConfigManager API and methods
- Dashboard and database configuration options

**Keywords:** config.yaml, YAML, environment variables, interpolation, Zod validation, hot-reload, hotReloadConfig, grantPermission, permission approval, TeamsConfigManager, paths.ts, env-interpolation, teams configuration, MCP config scripts, mcpConfigScript, mcp-cp.sh, mcp-scp.sh, reverse MCP, ClaudeCommandBuilder, getMcpConfigPath

**Last Updated:** 2025-10-18
**Change Context:** Updated MCP config file location from temporary directories to team-specific `.claude/iris/mcp` directory. All MCP config scripts (mcp-cp.sh, mcp-cp.ps1, mcp-scp.sh, mcp-scp.ps1) now write to `<team-path>/.claude/iris/mcp/iris-mcp-{sessionId}.json` instead of `/tmp` or `~/.iris/mcp-configs`. Added `ClaudeCommandBuilder.getMcpConfigPath()` helper method to generate the MCP config file path. Scripts now create the `.claude/iris/mcp` directory if it doesn't exist. Updated script interfaces to require team path as a mandatory argument instead of optional destination directory.
**Related Files:** GETTING_STARTED.md (config references), FEATURES.md (configuration management section), CLAUDE.md (config path references), README.md (config snippets), ARCHITECTURE.md (config system design), src/config/iris-config.ts (schema), src/index.ts (implementation), src/utils/command-builder.ts (getMcpConfigPath method), examples/scripts/mcp-*.sh (script implementations)
