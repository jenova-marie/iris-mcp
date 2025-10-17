/**
 * Iris MCP Module: debug
 * Query in-memory logs from Wonder Logger memory transport
 */

import {
  getMemoryLogs,
  getAllMemoryStoreNames,
  type ParsedLogEntry,
  type RawLogEntry,
} from "@jenova-marie/wonder-logger";
import { getChildLogger } from "../utils/logger.js";
import { ValidationError } from "../utils/errors.js";

const logger = getChildLogger("action:debug");

export interface DebugInput {
  /**
   * Timestamp (milliseconds) to get logs since
   * If not provided, returns all logs in memory
   */
  logs_since?: number;

  /**
   * Memory store name to query
   * If not provided, queries the default 'iris-mcp' store
   * Use getAllStores=true to see available store names
   */
  storeName?: string;

  /**
   * Return format
   * - 'raw': Pino JSON objects as-is
   * - 'parsed': Human-readable format with string levels
   * @default 'parsed'
   */
  format?: "raw" | "parsed";

  /**
   * Filter by log level(s)
   * Single level: 'error'
   * Multiple levels: ['error', 'warn']
   * Available levels: trace, debug, info, warn, error, fatal
   */
  level?: string | string[];

  /**
   * If true, returns list of all available memory store names
   * instead of logs
   */
  getAllStores?: boolean;
}

export interface DebugOutput {
  /** Queried logs (if getAllStores=false) */
  logs?: Array<RawLogEntry | ParsedLogEntry>;

  /** Number of logs returned */
  logCount: number;

  /** Memory store name queried */
  storeName?: string;

  /** Timestamp of query */
  timestamp: number;

  /** Query parameters used */
  query: {
    since?: number;
    format: "raw" | "parsed";
    level?: string | string[];
  };

  /** All available memory store names (if getAllStores=true) */
  availableStores?: string[];
}

export async function debug(input: DebugInput): Promise<DebugOutput> {
  logger.debug({ input }, "Debug logs query");

  try {
    // Validate logs_since if provided
    if (input.logs_since !== undefined) {
      if (typeof input.logs_since !== "number" || input.logs_since < 0) {
        throw new ValidationError(
          "logs_since must be a positive number (timestamp in milliseconds)",
        );
      }

      // Validate logs_since is not in the future
      const now = Date.now();
      if (input.logs_since > now) {
        throw new ValidationError(
          `logs_since (${input.logs_since}) cannot be in the future (now: ${now})`,
        );
      }
    }

    // Validate format if provided
    if (input.format && !["raw", "parsed"].includes(input.format)) {
      throw new ValidationError('format must be either "raw" or "parsed"');
    }

    // Validate level if provided
    const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
    if (input.level) {
      const levels = Array.isArray(input.level) ? input.level : [input.level];
      for (const level of levels) {
        if (!validLevels.includes(level)) {
          throw new ValidationError(
            `Invalid level "${level}". Must be one of: ${validLevels.join(", ")}`,
          );
        }
      }
    }

    // If getAllStores is requested, return store names
    if (input.getAllStores) {
      const availableStores = getAllMemoryStoreNames();
      logger.info(
        { storeCount: availableStores.length, stores: availableStores },
        "Retrieved memory store names",
      );

      return {
        logCount: 0,
        timestamp: Date.now(),
        query: {
          format: input.format || "parsed",
        },
        availableStores,
      };
    }

    // Default to 'iris-mcp' store (matches wonder-logger.yaml service name)
    const storeName = input.storeName || "iris-mcp";
    const format = input.format || "parsed";

    // Query logs
    const logs = getMemoryLogs(storeName, {
      since: input.logs_since,
      format,
      level: input.level as any, // Type assertion - we validated above
    });

    const output: DebugOutput = {
      logs,
      logCount: logs.length,
      storeName,
      timestamp: Date.now(),
      query: {
        since: input.logs_since,
        format,
        level: input.level,
      },
    };

    logger.info(
      {
        storeName,
        logCount: output.logCount,
        since: input.logs_since,
        format,
        level: input.level,
      },
      "Memory logs retrieved",
    );

    return output;
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        input,
      },
      "Failed to query memory logs",
    );
    throw error;
  }
}
