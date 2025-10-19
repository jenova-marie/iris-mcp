/**
 * Claude Command Builder - Single source of truth for building Claude CLI commands
 *
 * Extracts command building logic from transport layer for better testability and DRY.
 * This module is transport-agnostic - it builds the command, transports execute it.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { IrisConfig } from "../process-pool/types.js";

/**
 * Command information for transports to execute
 */
export interface CommandInfo {
  /** Claude executable path (e.g., 'claude', '~/.local/bin/claude') */
  executable: string;

  /** CLI arguments to pass to Claude */
  args: string[];

  /** Working directory (project path) */
  cwd: string;
}

/**
 * MCP server configuration structure
 */
export interface McpConfig {
  mcpServers: {
    [serverName: string]: {
      type: string;
      url: string;
    };
  };
}

/**
 * Load and render team identity prompt template
 */
function loadTeamIdentityPrompt(teamName: string): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const templatePath = join(
      __dirname,
      "../templates",
      "team-identity-prompt.txt",
    );
    const template = readFileSync(templatePath, "utf8");

    // Simple template rendering: replace {{teamName}} with actual team name
    return template.replace(/\{\{teamName\}\}/g, teamName);
  } catch (error) {
    // Fallback if template file not found
    return `# Iris MCP ${teamName}\n\nThis is the **${teamName}** team configured in the Iris MCP server for cross-project Claude coordination.`;
  }
}

const irisTools = [
  "mcp__iris__team_tell",
  "mcp__iris__team_quick_tell",
  "mcp__iris__team_cancel",
  "mcp__iris__team_reboot",
  "mcp__iris__team_delete",
  "mcp__iris__team_compact",
  "mcp__iris__team_fork",
  "mcp__iris__team_isAwake",
  "mcp__iris__team_wake",
  "mcp__iris__team_sleep",
  "mcp__iris__team_wake_all",
  "mcp__iris__team_report",
  "mcp__iris__team_teams",
  "mcp__iris__team_debug",
  "mcp__iris__permissions__approve",
  "mcp__iris__team_date",
];

/**
 * ClaudeCommandBuilder - Builds Claude CLI commands based on configuration
 *
 * This is a pure function module - no state, no side effects, 100% testable.
 */
export class ClaudeCommandBuilder {
  /**
   * Build complete Claude command information
   *
   * @param teamName - Team name (for identity prompt)
   * @param irisConfig - Team configuration
   * @param sessionId - Session ID for --resume
   * @param interactive - If true, build for interactive mode (default: false for headless)
   * @param fork - If true, append --fork-session flag (default: false)
   * @returns CommandInfo with executable, args, and cwd
   */
  static build(
    teamName: string,
    irisConfig: IrisConfig,
    sessionId: string,
    interactive = false,
    fork = false,
  ): CommandInfo {
    const args: string[] = [];

    // 1. Session management
    // Resume existing session (unless in test mode)
    const isTestMode =
      process.env.NODE_ENV === "test" || process.env.IRIS_TEST_REMOTE === "1";
    if (!isTestMode) {
      args.push("--resume", sessionId);
    }

    // 2. Debug mode (always enabled for all sessions)
    args.push("--debug");

    // 3. Headless mode with stream-json I/O (only for non-interactive)
    if (!interactive) {
      args.push(
        "--print", // Non-interactive headless mode
        "--verbose", // Required for stream-json output
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
      );
    }

    // 5. Build tool allowlist based on grantPermission setting
    const allowedTools = new Set<string>();
    const grantPermission = irisConfig.grantPermission || "yes"; // Default to "yes" for backwards compatibility
    const permissionTool = "mcp__iris__permissions__approve";

    if (grantPermission === "yes") {
      // Auto-approve all Iris MCP tools
      irisTools.forEach((tool) => allowedTools.add(tool));

      // Add user-specified tools from config
      if (irisConfig.allowedTools) {
        const userTools = irisConfig.allowedTools
          .split(/[,\s]+/)
          .filter((t) => t);
        userTools.forEach((tool) => allowedTools.add(tool));
      }

      // Still use permission-prompt-tool for tools not in allowed-tools
      args.push("--permission-prompt-tool", permissionTool);
    } else if (grantPermission === "ask") {
      // Only add permission approval tool, require approval for everything
      allowedTools.add(permissionTool);
      args.push("--permission-prompt-tool", permissionTool);
    }
    // else grantPermission === "no": no tools allowed, no permission-prompt-tool (block everything)

    // Add allowedTools if we have any
    // TODO: Temporarily disabled - may be blocking MCP tools
    // if (allowedTools.size > 0) {
    //   args.push("--allowed-tools", Array.from(allowedTools).join(","));
    // }

    if (irisConfig.disallowedTools) {
      args.push("--disallowed-tools", irisConfig.disallowedTools);
    }

    // 7. Fork session flag (for interactive terminal forks)
    if (fork) {
      args.push("--fork-session");
    }

    // 8. System prompt (team identity + custom append)
    // Currently commented out - uncomment when ready to enable
    // const teamIdentity = loadTeamIdentityPrompt(teamName);
    // const systemPrompt = irisConfig.appendSystemPrompt
    //   ? `${teamIdentity}\n\n${irisConfig.appendSystemPrompt}`
    //   : teamIdentity;
    // args.push("--append-system-prompt", systemPrompt);

    // 9. MCP configuration will be handled by transports
    // They will write the config to a file and add --mcp-config <filepath>
    // Note: --mcp-config expects a file path, NOT stringified JSON

    // 10. Determine executable
    const executable = irisConfig.claudePath || "claude";

    return {
      executable,
      args,
      cwd: irisConfig.path,
    };
  }

  /**
   * Build MCP configuration object
   *
   * For local: Uses direct HTTP connection to localhost
   * For remote: Uses reverse tunnel with configurable protocol
   *
   * NOTE: This is now public so transports can use it to generate MCP config files
   */
  static buildMcpConfig(irisConfig: IrisConfig, sessionId: string): McpConfig {
    // Determine MCP port (from config or env var or default)
    const mcpPort = irisConfig.enableReverseMcp
      ? irisConfig.reverseMcpPort || 1615
      : parseInt(process.env.IRIS_HTTP_PORT || "1615", 10);

    // Determine protocol (HTTP for local or dev mode, HTTPS for production remote)
    const protocol =
      !irisConfig.remote || irisConfig.allowHttp ? "http" : "https";

    // Build session-specific URL
    const mcpUrl = `${protocol}://localhost:${mcpPort}/mcp/${sessionId}`;

    return {
      mcpServers: {
        iris: {
          type: "http",
          url: mcpUrl,
        },
      },
    };
  }

  /**
   * Get the MCP config file path for a team session
   *
   * Returns: <team-path>/<sessionMcpPath>/iris-mcp-<sessionId>.json
   *
   * @param teamPath - Absolute path to team's project directory
   * @param sessionId - Session ID
   * @param sessionMcpPath - MCP directory path relative to team path (defaults to ".claude/iris/mcp")
   * @returns Absolute path to MCP config file
   */
  static getMcpConfigPath(
    teamPath: string,
    sessionId: string,
    sessionMcpPath = ".claude/iris/mcp",
  ): string {
    return join(teamPath, sessionMcpPath, `iris-mcp-${sessionId}.json`);
  }
}
