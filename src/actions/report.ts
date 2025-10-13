/**
 * Iris MCP Module: report
 * View the output cache for a team's process without clearing it
 */

import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";
import { ConfigurationError } from "../utils/errors.js";

const logger = getChildLogger("action:report");

export interface ReportInput {
  /** Team whose output cache to view */
  team: string;

  /** Team requesting the report */
  fromTeam: string;
}

export interface ReportOutput {
  /** Team whose cache was viewed */
  team: string;

  /** Cached stdout output */
  stdout: string;

  /** Cached stderr output */
  stderr: string;

  /** Whether the team has an active process */
  hasProcess: boolean;

  /** Total bytes of cached output */
  totalBytes: number;

  /** Timestamp of report operation */
  timestamp: number;
}

export async function report(
  input: ReportInput,
  processPool: ClaudeProcessPool,
): Promise<ReportOutput> {
  const { team, fromTeam } = input;

  // Validate team names
  validateTeamName(team);
  validateTeamName(fromTeam);

  logger.info({ team, fromTeam }, "Reporting at team output cache");

  try {
    // Check if team exists in configuration
    const config = processPool.getConfig();
    if (!config.teams[team]) {
      throw new ConfigurationError(`Unknown team: ${team}`);
    }

    // No caching in bare-bones mode - all responses are streamed directly
    logger.info({ team, fromTeam }, "Report requested but caching disabled");

    return {
      team,
      stdout: "",
      stderr: "",
      hasProcess: false,
      totalBytes: 0,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error({
      err: error instanceof Error ? error : new Error(String(error)),
      team
    }, "Failed to report at team output");
    throw error;
  }
}
