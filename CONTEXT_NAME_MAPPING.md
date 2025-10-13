# Context Name Mapping - Old to New

## Standardized Namespace Convention

Format: `category:subcategory:identifier`

## Complete Mapping Table

| File | Old Context | New Context | Notes |
|------|------------|-------------|-------|
| **Core System** |
| `src/index.ts:21` | `cli` | `iris:cli` | Main CLI entry point |
| `src/iris.ts:26` | `iris` | `iris:core` | Main orchestrator |
| `src/mcp_server.ts:31` | `server` | `iris:mcp` | MCP server |
| `src/web_server.ts:15` | `web-server` | `iris:web` | Web server |
| **Process Pool** |
| `src/process-pool/pool-manager.ts:21` | `pool` | `pool:manager` | Pool manager |
| `src/process-pool/claude-process.ts:80` | `process:${teamName}` | `pool:process:${teamName}` | Individual process (dynamic) |
| `src/process-pool/claude-process.ts:92` | `session-init:${teamConfig.path}` | `pool:session-init:${teamConfig.path}` | Session initialization (static method) |
| **Session Management** |
| `src/session/session-manager.ts:32` | `session-manager` | `session:manager` | Session manager |
| `src/session/session-store.ts:21` | `session-store` | `session:store` | Session store |
| `src/session/metrics.ts:11` | `session-metrics` | `session:metrics` | Session metrics |
| `src/session/validation.ts:14` | `session-validation` | `session:validation` | Session validation |
| **Cache System** |
| `src/cache/cache-manager.ts:8` | `cache-manager` | `cache:manager` | Cache manager |
| `src/cache/cache-entry.ts:15` | `cache-entry` | `cache:entry` | Cache entries |
| `src/cache/cache-session.ts:10` | `cache-session` | `cache:session` | Cache sessions |
| **MCP Actions** |
| `src/actions/tell.ts:18` | `mcp:tell` | `action:tell` | Send message action |
| `src/actions/wake.ts:13` | `mcp:wake` | `action:wake` | Wake team action |
| `src/actions/sleep.ts:11` | `mcp:sleep` | `action:sleep` | Sleep team action |
| `src/actions/wake-all.ts:11` | `mcp:wake-all` | `action:wake-all` | Wake all teams action |
| `src/actions/isAwake.ts:13` | `mcp:isAwake` | `action:is-awake` | Check awake status action |
| `src/actions/report.ts:11` | `mcp:report` | `action:report` | View team report action |
| `src/actions/teams.ts:9` | `mcp:teams` | `action:teams` | List teams action |
| `src/actions/command.ts:17` | `mcp:command` | `action:command` | Send command action |
| `src/actions/getTeamName.ts:10` | `mcp:getTeamName` | `action:get-team-name` | Get team name action |
| **Configuration** |
| `src/config/teams-config.ts:14` | `config` | `config:teams` | Teams configuration |
| **Dashboard (Phase 2)** |
| `src/dashboard/server/index.ts:16` | `dashboard-server` | `dashboard:server` | Dashboard server |
| `src/dashboard/server/state-bridge.ts:19` | `dashboard-bridge` | `dashboard:state` | State bridge |
| `src/dashboard/server/routes/processes.ts:10` | `api:processes` | `dashboard:routes:processes` | Process routes |
| `src/dashboard/server/routes/config.ts:13` | `api:config` | `dashboard:routes:config` | Config routes |
| **CLI Commands (Phase 4)** |
| `src/cli/commands/install.ts:13` | `cli:install` | `cli:install` | ✓ Already correct |
| `src/cli/commands/uninstall.ts:11` | `cli:uninstall` | `cli:uninstall` | ✓ Already correct |
| `src/cli/commands/add-team.ts:11` | `cli:add-team` | `cli:add-team` | ✓ Already correct |

## Summary Statistics

- **Total contexts to update:** 29
- **Already correct (no change needed):** 3 (CLI commands)
- **Requires update:** 26
- **Dynamic contexts (with variables):** 2

## Dynamic Context Patterns

### Pattern 1: Process-specific loggers
```typescript
// Old
this.logger = new Logger(`process:${teamName}`);

// New
this.logger = getChildLogger(`pool:process:${teamName}`);
```

### Pattern 2: Session initialization
```typescript
// Old
const logger = new Logger(`session-init:${teamConfig.path}`);

// New
const logger = getChildLogger(`pool:session-init:${teamConfig.path}`);
```

## Context Hierarchy

```
iris:
  ├── cli          (Main CLI entry)
  ├── core         (Main orchestrator)
  ├── mcp          (MCP server)
  └── web          (Web server)

pool:
  ├── manager                      (Pool manager)
  ├── process:${teamName}          (Individual processes - dynamic)
  └── session-init:${teamPath}     (Session initialization - dynamic)

session:
  ├── manager      (Session manager)
  ├── store        (Session store)
  ├── metrics      (Session metrics)
  └── validation   (Session validation)

cache:
  ├── manager      (Cache manager)
  ├── entry        (Cache entries)
  └── session      (Cache sessions)

action:
  ├── tell             (Send message)
  ├── wake             (Wake team)
  ├── sleep            (Sleep team)
  ├── wake-all         (Wake all teams)
  ├── is-awake         (Check awake status)
  ├── report           (View team report)
  ├── teams            (List teams)
  ├── command          (Send command)
  └── get-team-name    (Get team name)

config:
  └── teams        (Teams configuration)

dashboard:
  ├── server                (Dashboard server)
  ├── state                 (State bridge)
  └── routes:
      ├── processes         (Process routes)
      └── config            (Config routes)

cli:
  ├── install      (Install command)
  ├── uninstall    (Uninstall command)
  └── add-team     (Add team command)
```

## Grep Patterns for Verification

### Find all old patterns (should return 0 after migration)
```bash
# Check for old context patterns
grep -r "new Logger.*('pool')" src/
grep -r "new Logger.*('iris')" src/
grep -r "new Logger.*('mcp:" src/
grep -r "new Logger.*('cache-" src/
grep -r "new Logger.*('session-" src/
grep -r "new Logger.*('config')" src/
grep -r "new Logger.*('dashboard-" src/
grep -r "new Logger.*('api:" src/
```

### Find all new patterns (should match file count after migration)
```bash
# Check for new context patterns
grep -r "getChildLogger.*('iris:" src/
grep -r "getChildLogger.*('pool:" src/
grep -r "getChildLogger.*('session:" src/
grep -r "getChildLogger.*('cache:" src/
grep -r "getChildLogger.*('action:" src/
grep -r "getChildLogger.*('config:" src/
grep -r "getChildLogger.*('dashboard:" src/
grep -r "getChildLogger.*('cli:" src/
```

## Log Filtering Examples

Once migrated, you can filter logs by category:

```bash
# All pool-related logs
grep '"context":"pool:' logs/iris.log

# All action logs
grep '"context":"action:' logs/iris.log

# Specific team's process logs
grep '"context":"pool:process:team-frontend"' logs/iris.log

# All session-related logs
grep '"context":"session:' logs/iris.log

# Dashboard and its routes
grep '"context":"dashboard:' logs/iris.log
```

## Usage in Code

```typescript
// Static context
const logger = getChildLogger('action:tell');

// Dynamic context with team name
const logger = getChildLogger(`pool:process:${teamName}`);

// Dynamic context with path (session init)
const logger = getChildLogger(`pool:session-init:${teamConfig.path}`);
```

---

**Next Step**: Use this mapping when converting each file in Phases 2-6.
