/**
 * Iris MCP Module: fork
 * Fork a session by launching a new terminal with claude --resume --fork-session
 *
 * Executes the user-configured fork script (spawn.sh/bat/ps1) to open a new terminal
 * window/tab with the Claude CLI resumed to a specific session. This allows the user
 * to interact with the session manually.
 *
 * The fork script receives these arguments:
 * - sessionId: The session ID to resume
 * - teamPath: The project path for the team
 * - claudePath: Path to Claude CLI executable
 * - sshHost: SSH host for remote teams (optional)
 * - sshOptions: SSH options for remote teams (optional)
 */

import type { IrisOrchestrator } from "../iris.js";
import type { SessionManager } from "../session/session-manager.js";
import type { TeamsConfigManager } from "../config/iris-config.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { getIrisHome } from "../utils/paths.js";
import { ClaudeCommandBuilder } from "../utils/command-builder.js";
import {
  writeMcpConfigLocal,
  writeMcpConfigRemote,
} from "../utils/mcp-config-writer.js";

const logger = getChildLogger("action:fork");

export interface ForkInput {
  /** Team to fork session for */
  toTeam: string;

  /** Team requesting the fork */
  fromTeam: string;
}

export interface ForkOutput {
  /** Whether the fork was successful */
  success: boolean;

  /** Team that requested the fork */
  from: string;

  /** Team that was forked */
  to: string;

  /** The session ID that was forked */
  sessionId: string;

  /** The fork script that was executed */
  spawnScriptPath?: string;

  /** The team path */
  teamPath?: string;

  /** Whether this was a remote fork */
  remote: boolean;

  /** SSH host (if remote) */
  sshHost?: string;

  /** Success/error message */
  message: string;

  /** Timestamp of operation */
  timestamp: number;
}

/**
 * Get the path to the fork script
 * Looks for: ~/.iris/scripts/spawn.sh (macOS/Linux) or ~/.iris/scripts/spawn.ps1 (Windows)
 */
function getForkScriptPath(): string | null {
  const irisHome = getIrisHome();
  const scriptsDir = resolve(irisHome, "scripts");

  const candidates = [
    resolve(scriptsDir, "spawn.sh"),
    resolve(scriptsDir, "spawn.ps1"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Parse SSH connection string to extract host and options
 * Examples:
 *   "ssh user@host" -> { host: "user@host", options: null }
 *   "ssh -J jumphost user@host" -> { host: "user@host", options: "-J jumphost" }
 *   "ssh -i ~/.ssh/key user@host" -> { host: "user@host", options: "-i ~/.ssh/key" }
 */
function parseRemoteConnection(remote: string): {
  sshHost: string;
  sshOptions: string | null;
} | null {
  // Parse "ssh [options] host" format
  const parts = remote.trim().split(/\s+/);

  if (parts[0] !== "ssh") {
    return null; // Not an SSH connection
  }

  // Extract host (last argument)
  const sshHost = parts[parts.length - 1];

  // Extract options (everything between "ssh" and host)
  const sshOptions = parts.length > 2 ? parts.slice(1, -1).join(" ") : null;

  return { sshHost, sshOptions };
}

export async function fork(
  input: ForkInput,
  _iris: IrisOrchestrator,
  sessionManager: SessionManager,
  _processPool: any,
  configManager: TeamsConfigManager,
): Promise<ForkOutput> {
  const { fromTeam, toTeam } = input;

  // Validate inputs
  validateTeamName(toTeam);
  validateTeamName(fromTeam);

  logger.info({ fromTeam, toTeam }, "Forking session");

  // Check if fork script is configured
  const spawnScriptPath = getForkScriptPath();

  if (!spawnScriptPath) {
    throw new Error(
      "Fork script not found. Create spawn.sh (or ps1 on Windows) in your IRIS_HOME scripts directory (~/.iris/scripts/spawn.sh)",
    );
  }

  // Get session
  const session = sessionManager.getSession(fromTeam, toTeam);

  if (!session) {
    throw new Error(`No session found for ${fromTeam}->${toTeam}`);
  }

  // Get team configuration
  const teamConfig = configManager.getIrisConfig(toTeam);

  if (!teamConfig) {
    throw new Error(`Team not found: ${toTeam}`);
  }

  const teamPath = teamConfig.path;
  const isRemote = !!teamConfig.remote;

  // Build the exact Claude command using ClaudeCommandBuilder
  // Use interactive=true, fork=true for interactive terminal fork
  const commandInfo = ClaudeCommandBuilder.build(
    toTeam,
    teamConfig,
    session.sessionId,
    true, // interactive (no stream-json)
    true, // fork (appends --fork-session)
  );

  // Write MCP config file if sessionMcpEnabled is configured
  let mcpConfigPath: string | undefined;
  if (teamConfig.sessionMcpEnabled) {
    const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
      teamConfig,
      session.sessionId,
    );

    const mcpDirPath = teamConfig.sessionMcpPath ?? ".claude/iris/mcp";

    if (isRemote) {
      // Remote: use remote config writer
      // Signature: writeMcpConfigRemote(mcpConfig, sessionId, sshHost, remoteTeamPath, mcpDirPath?, scriptPath?)
      mcpConfigPath = await writeMcpConfigRemote(
        mcpConfig,
        session.sessionId,
        teamConfig.remote!,
        teamConfig.path,
        mcpDirPath,
        teamConfig.mcpConfigScript,
      );
    } else {
      // Local: use local config writer
      // Signature: writeMcpConfigLocal(mcpConfig, sessionId, teamPath, mcpDirPath?, scriptPath?)
      mcpConfigPath = await writeMcpConfigLocal(
        mcpConfig,
        session.sessionId,
        teamConfig.path,
        mcpDirPath,
        teamConfig.mcpConfigScript,
      );
    }

    // Add --mcp-config to args
    commandInfo.args.push("--mcp-config", mcpConfigPath);
  }

  // Build full command string (--fork-session already included by command builder)
  const claudeArgs = commandInfo.args.join(" ");
  const fullClaudeCommand = `${commandInfo.executable} ${claudeArgs}`;

  // Parse remote connection if needed
  let sshHost: string | undefined;
  let sshOptions: string | undefined;

  if (isRemote) {
    const remoteInfo = parseRemoteConnection(teamConfig.remote!);
    if (remoteInfo) {
      sshHost = remoteInfo.sshHost;
      sshOptions = remoteInfo.sshOptions || undefined;
    }
  }

  // Build fork script command
  // New signature: spawn.sh <teamPath> <fullClaudeCommand> [sshHost] [sshOptions]
  let command: string;
  if (isRemote && sshHost) {
    logger.info(
      {
        sessionId: session.sessionId,
        toTeam,
        teamPath,
        spawnScriptPath,
        sshHost,
        fullClaudeCommand,
      },
      "Launching remote fork for session",
    );

    command = `"${spawnScriptPath}" "${teamPath}" "${fullClaudeCommand}" "${sshHost}"`;
    if (sshOptions) {
      command += ` "${sshOptions}"`;
    }
  } else {
    logger.info(
      {
        sessionId: session.sessionId,
        toTeam,
        teamPath,
        spawnScriptPath,
        fullClaudeCommand,
      },
      "Launching local fork for session",
    );

    command = `"${spawnScriptPath}" "${teamPath}" "${fullClaudeCommand}"`;
  }

  try {
    // Execute the fork script with appropriate arguments
    execSync(command, {
      timeout: 5000,
      stdio: "ignore", // Ignore output since terminal will be launched async
    });

    logger.info(
      { sessionId: session.sessionId, toTeam, remote: isRemote },
      "Terminal fork launched successfully",
    );

    return {
      success: true,
      from: fromTeam,
      to: toTeam,
      sessionId: session.sessionId,
      spawnScriptPath,
      teamPath,
      remote: isRemote,
      sshHost,
      message: isRemote
        ? `Remote terminal fork launched successfully for session ${session.sessionId} on ${sshHost}`
        : `Terminal fork launched successfully for session ${session.sessionId}`,
      timestamp: Date.now(),
    };
  } catch (execError: any) {
    logger.error(
      {
        err:
          execError instanceof Error ? execError : new Error(String(execError)),
        sessionId: session.sessionId,
        toTeam,
        spawnScriptPath,
        command,
      },
      "Failed to execute fork script",
    );

    throw new Error(
      `Failed to launch terminal fork: ${execError.message}. Check fork script execution.`,
    );
  }
}
