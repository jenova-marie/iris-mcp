/**
 * Iris MCP Module: command
 * Sends the /compact command to Claude Code
 *
 * Currently only /compact is supported in headless stream-json mode.
 * Other slash commands (/help, /clear, etc.) are interactive CLI features
 * and do not work programmatically.
 *
 * The /compact command cleans up conversation history and reduces memory usage
 * in the Claude process.
 */

import type { IrisOrchestrator } from "../iris.js";
import { validateTeamName, validateTimeout } from "../utils/validation.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("mcp:command");

// Only compact is supported in headless mode
const SUPPORTED_COMMANDS = ["compact"] as const;
type SupportedCommand = typeof SUPPORTED_COMMANDS[number];

export interface CommandInput {
  /** Team whose Claude process to send command to */
  team: string;

  /** The command to send - only "compact" is currently supported */
  command: string;

  /** Optional arguments for the command */
  args?: string;

  /** Team requesting the command (optional) */
  fromTeam?: string;

  /** Wait for response (default: true) */
  waitForResponse?: boolean;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export interface CommandOutput {
  /** Team that received the command */
  team: string;

  /** The command that was sent */
  command: string;

  /** Response from the command */
  response?: string;

  /** Whether the command was successful */
  success: boolean;

  /** Duration in milliseconds */
  duration?: number;

  /** Timestamp of command execution */
  timestamp: number;

  /** Whether this was an async request */
  async: boolean;

  /** Task ID (only when async=true and using AsyncQueue) */
  taskId?: string;
}

export async function command(
  input: CommandInput,
  iris: IrisOrchestrator,
): Promise<CommandOutput> {
  const {
    team,
    command: cmd,
    args,
    fromTeam,
    waitForResponse = true,
    timeout = 30000,
  } = input;

  // Validate inputs
  validateTeamName(team);
  if (fromTeam) {
    validateTeamName(fromTeam);
  }
  if (waitForResponse) {
    validateTimeout(timeout);
  }

  // Validate command - must be a valid command name
  if (!cmd || typeof cmd !== 'string' || cmd.length === 0) {
    throw new Error("Command must be a non-empty string");
  }

  // Ensure command doesn't already start with slash (we'll add it)
  const commandName = cmd.startsWith('/') ? cmd.substring(1) : cmd;

  // Check if command is supported
  if (!SUPPORTED_COMMANDS.includes(commandName as SupportedCommand)) {
    logger.warn("Unsupported command requested", {
      team,
      command: commandName,
      supportedCommands: SUPPORTED_COMMANDS,
    });

    return {
      team,
      command: `/${commandName}`,
      response: `Command '/${commandName}' is not implemented. Only /compact is currently supported.`,
      success: false,
      timestamp: Date.now(),
      async: false,
    };
  }

  // Build the full command string
  const fullCommand = args ? `/${commandName} ${args}` : `/${commandName}`;

  // Async mode: Use AsyncQueue
  if (!waitForResponse) {
    // Check if team is awake first
    if (!iris.isAwake(fromTeam || null, team)) {
      logger.warn("Team is asleep, cannot enqueue async command", {
        fromTeam,
        team,
        command: fullCommand,
      });

      return {
        team,
        command: fullCommand,
        response: "Team is asleep. Use 'wake' action first.",
        success: false,
        timestamp: Date.now(),
        async: true,
      };
    }

    // Enqueue to AsyncQueue for processing
    try {
      const taskId = iris.getAsyncQueue().enqueue({
        type: "command",
        fromTeam: fromTeam || null,
        toTeam: team,
        content: commandName, // Just the command name (without slash)
        args: args, // Optional arguments
        timeout,
      });

      logger.info("Command enqueued to AsyncQueue", {
        taskId,
        team,
        command: fullCommand,
      });

      return {
        team,
        command: fullCommand,
        success: true,
        timestamp: Date.now(),
        async: true,
        taskId,
      };
    } catch (error) {
      logger.error("Failed to enqueue async command", {
        team,
        command: fullCommand,
        error,
      });

      return {
        team,
        command: fullCommand,
        response: error instanceof Error ? error.message : String(error),
        success: false,
        timestamp: Date.now(),
        async: true,
      };
    }
  }

  // Sync mode: Send immediately and wait
  logger.info("Sending command to team (sync)", {
    team,
    command: fullCommand,
    fromTeam,
  });

  const startTime = Date.now();

  try {
    // Send the command to Claude
    const response = await iris.sendMessage(
      fromTeam || null,
      team,
      fullCommand,
      {
        timeout,
        waitForResponse: true,
      }
    );

    const duration = Date.now() - startTime;

    logger.info("Command completed", {
      team,
      command: fullCommand,
      duration,
      responseLength: response?.length || 0,
    });

    return {
      team,
      command: fullCommand,
      response,
      success: true,
      duration,
      timestamp: Date.now(),
      async: false,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to send command", {
      team,
      command: fullCommand,
      error,
      duration,
    });

    // Return failure result instead of throwing
    return {
      team,
      command: fullCommand,
      response: error instanceof Error ? error.message : String(error),
      success: false,
      duration,
      timestamp: Date.now(),
      async: !waitForResponse,
    };
  }
}