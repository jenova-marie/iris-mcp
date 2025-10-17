/**
 * Iris MCP Module: date
 * Returns the current system date/time in UTC
 */

import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:date");

export interface DateInput {
  // No input needed
}

export interface DateOutput {
  /** Current timestamp in milliseconds since Unix epoch */
  timestamp: number;

  /** ISO 8601 formatted date string in UTC (e.g., "2025-01-15T10:30:00.000Z") */
  iso: string;

  /** Human-readable UTC date string */
  utc: string;

  /** Unix timestamp in seconds (for compatibility with Unix systems) */
  unix: number;

  /** Date components */
  components: {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
    seconds: number;
    milliseconds: number;
    dayOfWeek: number; // 0 = Sunday, 6 = Saturday
    dayOfYear: number;
  };
}

export async function date(input: DateInput): Promise<DateOutput> {
  logger.info("Getting current date/time");

  try {
    const now = new Date();

    // Calculate day of year
    const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const dayOfYear = Math.floor(
      (now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;

    const output: DateOutput = {
      timestamp: now.getTime(),
      iso: now.toISOString(),
      utc: now.toUTCString(),
      unix: Math.floor(now.getTime() / 1000),
      components: {
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1, // Convert 0-11 to 1-12
        day: now.getUTCDate(),
        hours: now.getUTCHours(),
        minutes: now.getUTCMinutes(),
        seconds: now.getUTCSeconds(),
        milliseconds: now.getUTCMilliseconds(),
        dayOfWeek: now.getUTCDay(),
        dayOfYear: dayOfYear,
      },
    };

    logger.info(
      {
        iso: output.iso,
        timestamp: output.timestamp,
      },
      "Date/time retrieved",
    );

    return output;
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
      },
      "Failed to get date/time",
    );
    throw error;
  }
}
