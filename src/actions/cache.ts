/**
 * Iris MCP Module: cache
 * Manage cache operations - read and clear cache for team processes
 */

import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { CacheReport, MessageExchange, ProtocolMessage } from "../process-pool/claude-cache.js";
import { validateTeamName } from "../utils/validation.js";
import { Logger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";

const logger = new Logger("mcp:cache");

export interface CacheReadInput {
  /** Team whose cache to read */
  team: string;

  /** Optional: Team requesting the cache read */
  fromTeam?: string;

  /** Include recent messages (default: true) */
  includeMessages?: boolean;

  /** Number of recent messages to include (default: 10) */
  messageCount?: number;

  /** Export format for messages (default: "json") */
  format?: "json" | "text";

  /** Include protocol messages - raw JSON from Claude (default: false) */
  includeProtocolMessages?: boolean;
}

export interface CacheReadOutput {
  /** Team whose cache was read */
  team: string;

  /** Cache statistics report */
  report: CacheReport;

  /** Recent message exchanges (if includeMessages=true) */
  messages?: MessageExchange[];

  /** Exported messages in requested format (if includeMessages=true) */
  exportedMessages?: string;

  /** Protocol messages - raw JSON from Claude (if includeProtocolMessages=true) */
  protocolMessages?: ProtocolMessage[];

  /** Whether the team has an active process */
  hasProcess: boolean;

  /** Timestamp of read operation */
  timestamp: number;
}

export interface CacheClearInput {
  /** Team whose cache to clear */
  team: string;

  /** Optional: Team requesting the cache clear */
  fromTeam?: string;
}

export interface CacheClearOutput {
  /** Team whose cache was cleared */
  team: string;

  /** Cache report before clearing */
  reportBeforeClear: CacheReport;

  /** Whether the team has an active process */
  hasProcess: boolean;

  /** Success status */
  success: boolean;

  /** Message describing the operation */
  message: string;

  /** Timestamp of clear operation */
  timestamp: number;
}

/**
 * Read cache for a team's process
 */
export async function cacheRead(
  input: CacheReadInput,
  processPool: ClaudeProcessPool,
): Promise<CacheReadOutput> {
  const { team, fromTeam, includeMessages = true, messageCount = 10, format = "json", includeProtocolMessages = false } = input;

  // Validate team name
  validateTeamName(team);
  if (fromTeam) {
    validateTeamName(fromTeam);
  }

  // Validate message count
  if (messageCount < 1 || messageCount > 100) {
    throw new Error("messageCount must be between 1 and 100");
  }

  logger.info("Reading team cache", { team, fromTeam, includeMessages, messageCount });

  try {
    // Check if team exists in configuration
    const config = processPool.getConfig();
    if (!config.teams[team]) {
      throw new ConfigurationError(`Unknown team: ${team}`);
    }

    // Get the process for the team
    const process = processPool.getProcess(team);

    if (!process) {
      logger.info("No active process for team", { team });

      return {
        team,
        report: {
          totalMessages: 0,
          pendingMessages: 0,
          completedMessages: 0,
          errorMessages: 0,
          averageDuration: 0,
          cacheSize: {
            messages: 0,
            protocolMessages: 0,
          },
        },
        hasProcess: false,
        timestamp: Date.now(),
      };
    }

    // Get cache from process
    const cache = process.getCache();

    // Get cache report
    const report = cache.getReport();

    const output: CacheReadOutput = {
      team,
      report,
      hasProcess: true,
      timestamp: Date.now(),
    };

    // Include messages if requested
    if (includeMessages) {
      const messages = cache.getRecentMessages(messageCount);
      output.messages = messages;
      output.exportedMessages = cache.exportMessages(format);
    }

    // Include protocol messages if requested (contains all raw JSON including tool_use blocks)
    if (includeProtocolMessages) {
      output.protocolMessages = cache.getAllProtocolMessages();
    }

    logger.info("Cache read successfully", {
      team,
      totalMessages: report.totalMessages,
      includeMessages,
      includeProtocolMessages,
    });

    return output;
  } catch (error) {
    logger.error("Failed to read cache", { team, error });
    throw error;
  }
}

/**
 * Clear cache for a team's process
 */
export async function cacheClear(
  input: CacheClearInput,
  processPool: ClaudeProcessPool,
): Promise<CacheClearOutput> {
  const { team, fromTeam } = input;

  // Validate team name
  validateTeamName(team);
  if (fromTeam) {
    validateTeamName(fromTeam);
  }

  logger.info("Clearing team cache", { team, fromTeam });

  try {
    // Check if team exists in configuration
    const config = processPool.getConfig();
    if (!config.teams[team]) {
      throw new ConfigurationError(`Unknown team: ${team}`);
    }

    // Get the process for the team
    const process = processPool.getProcess(team);

    if (!process) {
      logger.info("No active process for team", { team });

      return {
        team,
        reportBeforeClear: {
          totalMessages: 0,
          pendingMessages: 0,
          completedMessages: 0,
          errorMessages: 0,
          averageDuration: 0,
          cacheSize: {
            messages: 0,
            protocolMessages: 0,
          },
        },
        hasProcess: false,
        success: false,
        message: `Team ${team} has no active process (cache already empty)`,
        timestamp: Date.now(),
      };
    }

    // Get cache from process
    const cache = process.getCache();

    // Get report before clearing
    const reportBeforeClear = cache.getReport();

    // Clear the cache
    cache.clear();

    logger.info("Cache cleared successfully", {
      team,
      messagesCleared: reportBeforeClear.totalMessages,
      protocolMessagesCleared: reportBeforeClear.cacheSize.protocolMessages,
    });

    return {
      team,
      reportBeforeClear,
      hasProcess: true,
      success: true,
      message: `Cache cleared for team ${team} (${reportBeforeClear.totalMessages} messages, ${reportBeforeClear.cacheSize.protocolMessages} protocol messages)`,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error("Failed to clear cache", { team, error });
    throw error;
  }
}
