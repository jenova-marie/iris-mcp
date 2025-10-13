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
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:command");

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

  /** Team requesting the command */
  fromTeam: string;

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
  validateTeamName(fromTeam);
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
    logger.warn({
      team,
      command: commandName,
      supportedCommands: SUPPORTED_COMMANDS,
    }, "Unsupported command requested");

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

  // Determine timeout value based on waitForResponse
  // waitForResponse=false → timeout=-1 (async mode)
  // waitForResponse=true → use provided timeout
  const actualTimeout = waitForResponse ? timeout : -1;

  logger.info({
    team,
    command: fullCommand,
    fromTeam,
    async: !waitForResponse,
    timeout: actualTimeout,
  }, "Sending command to team");

  const startTime = Date.now();

  try {
    // Send the command to Claude
    const result = await iris.sendMessage(
      fromTeam,
      team,
      fullCommand,
      {
        timeout: actualTimeout,
      }
    );

    const duration = Date.now() - startTime;

    // Handle async response (result is an object)
    if (typeof result === "object" && result !== null) {
      const resultObj = result as any;

      // Async mode response
      if (resultObj.status === "async") {
        logger.info({
          team,
          command: fullCommand,
          sessionId: resultObj.sessionId,
        }, "Command sent in async mode");

        return {
          team,
          command: fullCommand,
          success: true,
          timestamp: Date.now(),
          async: true,
        };
      }

      // Busy or other status
      logger.warn({
        team,
        command: fullCommand,
        status: resultObj.status,
      }, "Received non-string response for command");

      return {
        team,
        command: fullCommand,
        response: resultObj.message || JSON.stringify(result),
        success: false,
        duration,
        timestamp: Date.now(),
        async: false,
      };
    }

    // Handle string response (successful completion)
    const response = result as string;

    logger.info({
      team,
      command: fullCommand,
      duration,
      responseLength: response?.length || 0,
    }, "Command completed");

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

    logger.error({
      err: error instanceof Error ? error : new Error(String(error)),
      team,
      command: fullCommand,
      duration,
    }, "Failed to send command");

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