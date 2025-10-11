/**
 * Iris MCP Module: command
 * Sends slash commands to Claude Code (e.g., /compact, /clear, etc.)
 *
 * This module allows sending any slash command to Claude processes.
 * Common commands include:
 * - /compact: Clean up conversation history and reduce memory usage
 * - /clear: Clear the conversation
 * - /help: Show available commands
 * - Custom commands defined in Claude's configuration
 */

import type { IrisOrchestrator } from "../iris.js";
import { validateTeamName, validateTimeout } from "../utils/validation.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("mcp:command");

export interface CommandInput {
  /** Team whose Claude process to send command to */
  team: string;

  /** The command to send (e.g., "compact", "clear", "help") */
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

  // Build the full command string
  const fullCommand = args ? `/${commandName} ${args}` : `/${commandName}`;

  logger.info("Sending command to team", {
    team,
    command: fullCommand,
    fromTeam,
    waitForResponse,
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
        waitForResponse,
      }
    );

    const duration = Date.now() - startTime;

    if (waitForResponse) {
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
    } else {
      logger.info("Command sent (async)", { team, command: fullCommand });

      return {
        team,
        command: fullCommand,
        success: true,
        timestamp: Date.now(),
        async: true,
      };
    }
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