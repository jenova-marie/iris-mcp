# Compact Command Implementation

**Status:** Design Phase
**Created:** 2025-01-15
**Feature:** Execute `/compact` via `claude --resume --print`

---

## Problem Statement

Slash commands (`/compact`, `/help`, `/clear`) do not work in Claude Code's `--headless --stream-json` mode because they are interactive CLI features. However, we discovered that the `--print` mode DOES support slash commands:

```bash
claude --resume <session-id> --print /compact
```

This works exactly like session initialization in `ClaudeProcess.initializeSessionFile()`, which uses:

```bash
claude --session-id <session-id> --print ping
```

---

## Solution Design

### Architecture

Create a **generic `claude --print` executor** that can run any command in print mode, then use it to implement `/compact` functionality.

**Key Files:**
```
src/utils/
├── claude-print.ts        # Generic executor for claude --print commands
└── claude-print.test.ts   # Unit tests

src/actions/
├── compact.ts             # New MCP tool: team_compact
└── command.ts             # Leave as-is (non-functional for now)
```

---

## Implementation Details

### 1. Generic Claude Print Executor

**File:** `src/utils/claude-print.ts`

This utility executes any command via `claude --resume --print <command>` or `claude --session-id --print <command>`.

```typescript
/**
 * Claude Print Executor
 * Generic utility to execute commands via claude --print mode
 */

import { spawn } from "child_process";
import { getChildLogger } from "./logger.js";
import { ProcessError } from "./errors.js";

const logger = getChildLogger("utils:claude-print");

export interface ClaudePrintOptions {
  /** Project directory to run command in */
  projectPath: string;

  /** Session ID (required) */
  sessionId: string;

  /** Command to execute (e.g., "ping", "/compact", "/help") */
  command: string;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Whether to use --resume (true) or --session-id (false) */
  resume?: boolean;
}

export interface ClaudePrintResult {
  /** Exit code from claude process */
  exitCode: number;

  /** stdout output */
  stdout: string;

  /** stderr output */
  stderr: string;

  /** Duration in milliseconds */
  duration: number;

  /** Whether command completed successfully */
  success: boolean;

  /** Debug log path (if available) */
  debugLogPath?: string;
}

/**
 * Execute a command via claude --print mode
 *
 * This is based on the initializeSessionFile() algorithm but generalized
 * to support any command and both --session-id and --resume modes.
 */
export async function executeClaude--print(
  options: ClaudePrintOptions
): Promise<ClaudePrintResult> {
  const {
    projectPath,
    sessionId,
    command,
    timeout = 30000,
    resume = true,
  } = options;

  logger.info("Executing claude --print command", {
    sessionId,
    command,
    projectPath,
    resume,
    timeout,
  });

  const startTime = Date.now();

  try {
    // Build command args
    const args = [
      resume ? "--resume" : "--session-id",
      sessionId,
      "--print",
      command,
    ];

    const claudeCommand = "claude";
    const fullCommand = `${claudeCommand} ${args.join(" ")}`;

    logger.info("Spawning claude process", {
      sessionId,
      command: fullCommand,
      cwd: projectPath,
    });

    // Spawn Claude
    const claudeProcess = spawn(claudeCommand, args, {
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    // Close stdin immediately - we're not sending input
    claudeProcess.stdin!.end();

    // Capture output
    let spawnError: Error | null = null;
    let stdoutData = "";
    let stderrData = "";
    let debugLogPath: string | null = null;

    claudeProcess.on("error", (err) => {
      logger.error({ err, sessionId }, "Process spawn error");
      spawnError = err;
    });

    // Wait for process to complete
    const result = await new Promise<ClaudePrintResult>((resolve, reject) => {
      let responseReceived = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Capture stdout
      claudeProcess.stdout!.on("data", (data) => {
        const output = data.toString();
        stdoutData += output;

        logger.debug("stdout", {
          sessionId,
          output: output.substring(0, 500),
        });

        if (output.length > 0) {
          responseReceived = true;
        }
      });

      // Capture stderr
      claudeProcess.stderr!.on("data", (data) => {
        const errorOutput = data.toString();
        stderrData += errorOutput;

        // Extract debug log path if present
        const logPathMatch = errorOutput.match(/Logging to: (.+)/);
        if (logPathMatch && !debugLogPath) {
          debugLogPath = logPathMatch[1].trim();
          logger.info("Debug logs available", {
            sessionId,
            debugLogPath,
          });
        }

        logger.debug("stderr", { sessionId, stderr: errorOutput });
      });

      claudeProcess.on("exit", (code) => {
        // Clear timeout immediately
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        const duration = Date.now() - startTime;
        const exitCode = code ?? -1;

        if (spawnError) {
          logger.error(
            {
              err: spawnError,
              sessionId,
              exitCode,
              stdoutLength: stdoutData.length,
              stderrLength: stderrData.length,
            },
            "Process exited with spawn error"
          );

          reject(spawnError);
        } else if (exitCode !== 0 && exitCode !== 143) {
          // 143 is SIGTERM (ok)
          logger.error(
            {
              sessionId,
              exitCode,
              command: fullCommand,
              cwd: projectPath,
              stdout: stdoutData,
              stderr: stderrData,
              debugLogPath,
            },
            "Command failed with non-zero exit code"
          );

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: false,
            debugLogPath: debugLogPath ?? undefined,
          });
        } else if (!responseReceived) {
          logger.warn(
            {
              sessionId,
              exitCode,
              stdout: stdoutData,
              stderr: stderrData,
            },
            "Command completed but no response received"
          );

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: false,
            debugLogPath: debugLogPath ?? undefined,
          });
        } else {
          // Success
          logger.info("Command completed successfully", {
            sessionId,
            exitCode,
            stdoutLength: stdoutData.length,
            duration,
          });

          resolve({
            exitCode,
            stdout: stdoutData,
            stderr: stderrData,
            duration,
            success: true,
            debugLogPath: debugLogPath ?? undefined,
          });
        }
      });

      // Timeout
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        logger.error(
          {
            sessionId,
            timeout,
            responseReceived,
            command: fullCommand,
            stdout: stdoutData,
            stderr: stderrData,
          },
          "Command execution timed out"
        );

        claudeProcess.kill();

        const errorMsg = [
          `Command execution timed out after ${timeout}ms`,
          `Command: ${command}`,
          `Response received: ${responseReceived}`,
          debugLogPath ? `Debug logs: ${debugLogPath}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        reject(new ProcessError(errorMsg, projectPath));
      }, timeout);
    });

    return result;
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        sessionId,
        command,
      },
      "Failed to execute claude --print command"
    );
    throw error;
  }
}
```

---

### 2. Compact Action

**File:** `src/actions/compact.ts`

New MCP tool that uses `claudePrintExecutor` to run `/compact` command.

```typescript
/**
 * Iris MCP Module: compact
 * Executes /compact command to clean up conversation history
 *
 * Uses claude --resume --print /compact under the hood
 */

import type { IrisOrchestrator } from "../iris.js";
import type { SessionManager } from "../session/session-manager.js";
import type { TeamsConfigManager } from "../config/iris-config.js";
import { validateTeamName, validateTimeout } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";
import { executeClaude--print } from "../utils/claude-print.js";
import { TeamNotFoundError } from "../utils/errors.js";

const logger = getChildLogger("action:compact");

export interface CompactInput {
  /** Team whose session to compact */
  team: string;

  /** Team requesting the compact */
  fromTeam: string;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export interface CompactOutput {
  /** Team that was compacted */
  team: string;

  /** Whether the compact was successful */
  success: boolean;

  /** Response from compact command */
  response?: string;

  /** Duration in milliseconds */
  duration: number;

  /** Timestamp of operation */
  timestamp: number;

  /** Debug log path (if available) */
  debugLogPath?: string;
}

export async function compact(
  input: CompactInput,
  iris: IrisOrchestrator,
  sessionManager: SessionManager,
  configManager: TeamsConfigManager,
): Promise<CompactOutput> {
  const { team, fromTeam, timeout = 30000 } = input;

  // Validate inputs
  validateTeamName(team);
  validateTeamName(fromTeam);
  validateTimeout(timeout);

  logger.info({ team, fromTeam, timeout }, "Compacting team session");

  const startTime = Date.now();

  try {
    // Get team configuration
    const config = configManager.getConfig();
    const teamConfig = config.teams[team];

    if (!teamConfig) {
      throw new TeamNotFoundError(team);
    }

    // Get session for this team pair
    const session = sessionManager.getSession(fromTeam, team);

    if (!session) {
      logger.warn({ team, fromTeam }, "No session found - cannot compact");

      return {
        team,
        success: false,
        response: `No active session found for ${fromTeam} -> ${team}. Cannot compact.`,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    // Execute /compact via claude --resume --print
    const result = await executeClaude--print({
      projectPath: teamConfig.path,
      sessionId: session.sessionId,
      command: "/compact",
      timeout,
      resume: true, // Use --resume for existing sessions
    });

    const duration = Date.now() - startTime;

    if (result.success) {
      logger.info(
        {
          team,
          sessionId: session.sessionId,
          duration,
          stdoutLength: result.stdout.length,
        },
        "Session compacted successfully"
      );

      return {
        team,
        success: true,
        response: result.stdout.trim() || "Session compacted successfully",
        duration,
        timestamp: Date.now(),
        debugLogPath: result.debugLogPath,
      };
    } else {
      logger.warn(
        {
          team,
          sessionId: session.sessionId,
          exitCode: result.exitCode,
          stderr: result.stderr,
        },
        "Compact command failed"
      );

      return {
        team,
        success: false,
        response: `Compact failed: ${result.stderr || "Unknown error"}`,
        duration,
        timestamp: Date.now(),
        debugLogPath: result.debugLogPath,
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        team,
        fromTeam,
      },
      "Failed to compact session"
    );

    return {
      team,
      success: false,
      response: error instanceof Error ? error.message : String(error),
      duration,
      timestamp: Date.now(),
    };
  }
}
```

---

### 3. MCP Tool Registration

**File:** `src/index.ts`

Add new `team_compact` tool to MCP server:

```typescript
// Add to tool definitions
const tools: Tool[] = [
  // ... existing tools ...
  {
    name: "team_compact",
    description: "Compact a team's conversation history to reduce memory usage. This executes the /compact command for the team's session.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Team whose session to compact",
        },
        fromTeam: {
          type: "string",
          description: "Team requesting the compact operation",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["team", "fromTeam"],
    },
  },
];

// Add to tool handler
case "team_compact":
  return await compact(
    args as CompactInput,
    iris,
    sessionManager,
    configManager
  );
```

**File:** `src/actions/index.ts`

Export compact action:

```typescript
export * from "./tell.js";
export * from "./quick_tell.js";
export * from "./cancel.js";
export * from "./reboot.js";
export * from "./compact.js";  // NEW
export * from "./report.js";
export * from "./command.js";
export * from "./wake.js";
export * from "./sleep.js";
export * from "./isAwake.js";
export * from "./wake-all.js";
export * from "./teams.js";
```

---

## Usage Examples

### Via MCP Tool

```typescript
// Compact team-backend's session
const result = await mcp.callTool("team_compact", {
  team: "team-backend",
  fromTeam: "team-iris",
  timeout: 30000
});

console.log(result);
// {
//   team: "team-backend",
//   success: true,
//   response: "Conversation history compacted successfully",
//   duration: 2500,
//   timestamp: 1697567890123
// }
```

### Via API (Phase 3)

```bash
curl -X POST http://localhost:1615/api/teams/team-backend/compact \
  -H "Content-Type: application/json" \
  -d '{
    "fromTeam": "team-iris",
    "timeout": 30000
  }'
```

Response:
```json
{
  "team": "team-backend",
  "success": true,
  "response": "Conversation history compacted successfully",
  "duration": 2500,
  "timestamp": 1697567890123
}
```

---

## Design Rationale

### Why Separate Utility?

The `claudePrintExecutor` utility is separate from `ClaudeProcess` because:

1. **Single Responsibility**: `ClaudeProcess` manages the headless streaming process, not one-off print commands
2. **Reusability**: Other commands can use the same executor (future: `/help`, custom commands)
3. **Testing**: Easier to unit test in isolation
4. **No State Pollution**: Print commands don't affect the streaming process state

### Why Not Use `command.ts`?

The existing `command.ts` action tries to send slash commands via stdio to the headless process, which doesn't work. We're leaving it as-is because:

1. **Future Compatibility**: Claude Code may support slash commands in streaming mode later
2. **API Consistency**: Having a generic `command` tool is good UX, even if only `/compact` works now
3. **Clear Separation**: `compact.ts` is a working implementation, `command.ts` is aspirational

### --resume vs --session-id

- **--session-id**: Creates NEW session (used in `initializeSessionFile()`)
- **--resume**: Resumes EXISTING session (used for `/compact`)

For `/compact`, we always use `--resume` because we're operating on an existing session.

---

## Testing Strategy

### Unit Tests

**File:** `tests/unit/utils/claude-print.test.ts`

```typescript
describe("claudePrintExecutor", () => {
  it("should execute /compact successfully", async () => {
    const result = await executeClaude--print({
      projectPath: "/path/to/project",
      sessionId: "test-session-id",
      command: "/compact",
      timeout: 10000,
      resume: true,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("should handle timeout", async () => {
    await expect(
      executeClaude--print({
        projectPath: "/path/to/project",
        sessionId: "test-session-id",
        command: "/compact",
        timeout: 1, // 1ms timeout
        resume: true,
      })
    ).rejects.toThrow("timed out");
  });

  it("should capture debug log path", async () => {
    const result = await executeClaude--print({
      projectPath: "/path/to/project",
      sessionId: "test-session-id",
      command: "/compact",
      resume: true,
    });

    if (result.debugLogPath) {
      expect(result.debugLogPath).toContain(".claude");
    }
  });
});
```

### Integration Tests

**File:** `tests/integration/compact.test.ts`

```typescript
describe("team_compact integration", () => {
  it("should compact an active session", async () => {
    // Setup: Create session and send some messages
    await iris.sendMessage("test-from", "test-to", "Hello");
    await iris.sendMessage("test-from", "test-to", "World");

    // Compact
    const result = await compact(
      {
        team: "test-to",
        fromTeam: "test-from",
        timeout: 30000,
      },
      iris,
      sessionManager,
      configManager
    );

    expect(result.success).toBe(true);
  });

  it("should fail gracefully when no session exists", async () => {
    const result = await compact(
      {
        team: "nonexistent-team",
        fromTeam: "test-from",
      },
      iris,
      sessionManager,
      configManager
    );

    expect(result.success).toBe(false);
    expect(result.response).toContain("No active session");
  });
});
```

---

## Future Enhancements

### 1. Support Other Slash Commands

Once Claude Code adds support, extend `claudePrintExecutor` for:
- `/help` - Get help information
- `/clear` - Clear conversation (vs `/compact` which keeps context)
- Custom slash commands defined in project

### 2. Auto-Compact on Idle

Add configuration option to automatically compact sessions before they're evicted from pool:

```json
{
  "settings": {
    "autoCompactOnIdle": true,
    "autoCompactThreshold": 100  // Compact after 100 messages
  }
}
```

### 3. Compact Metrics

Track compact operations:
- Number of compacts per session
- Size reduction (before/after message count)
- Performance impact on response times

---

## Migration Path

### Phase 1: Core Implementation (Week 1)
- [ ] Create `src/utils/claude-print.ts`
- [ ] Create `src/actions/compact.ts`
- [ ] Register `team_compact` MCP tool
- [ ] Update `src/actions/index.ts`

### Phase 2: Testing (Week 1-2)
- [ ] Unit tests for `claudePrintExecutor`
- [ ] Integration tests for `compact` action
- [ ] Manual testing with real sessions

### Phase 3: Documentation (Week 2)
- [ ] Update MCP tool documentation
- [ ] Add usage examples to README
- [ ] Document `/compact` behavior and use cases

### Phase 4: API Integration (Phase 3)
- [ ] Add `POST /api/teams/:team/compact` endpoint
- [ ] WebSocket event for compact completion
- [ ] Dashboard UI button to compact sessions

---

## Open Questions

1. **Backwards Compatibility**: Should `claudePrintExecutor` support `--session-id` mode for future use cases?
   - **Answer**: Yes, include `resume` boolean parameter (default: true)

2. **Error Handling**: What if `/compact` fails mid-operation and corrupts session?
   - **Answer**: Claude Code handles this internally. We just report the error.

3. **Concurrent Operations**: Can we compact while a tell is in progress?
   - **Answer**: No - check process is idle before compacting. Return error if busy.

4. **Logging**: Should we log the full stdout/stderr or truncate?
   - **Answer**: Log full output at debug level, truncate at info level (first 500 chars)

---

**Document Version:** 1.0
**Last Updated:** 2025-01-15
**Status:** Design Phase
**Next Steps:** Implement `src/utils/claude-print.ts`
