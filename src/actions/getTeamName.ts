/**
 * Iris MCP Module: getTeamName
 * Identify team name from current working directory
 */

import { resolve } from "path";
import type { TeamsConfigManager } from "../config/teams-config.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:get-team-name");

export interface GetTeamNameInput {
  /** Current working directory (pwd) */
  pwd: string;
}

export interface GetTeamNameOutput {
  /** Team name if found, null otherwise */
  teamName: string | null;

  /** Resolved absolute path that was checked */
  resolvedPath: string;

  /** Whether a match was found */
  found: boolean;

  /** All team paths checked (for debugging) */
  teamsChecked?: {
    name: string;
    path: string;
  }[];
}

export async function getTeamName(
  input: GetTeamNameInput,
  configManager: TeamsConfigManager,
): Promise<GetTeamNameOutput> {
  const { pwd } = input;

  logger.info({ pwd }, "Looking up team name by path");

  try {
    // Resolve pwd to absolute path
    const resolvedPath = resolve(pwd);
    logger.debug({ resolvedPath }, "Resolved path");

    const config = configManager.getConfig();
    const teamsChecked: { name: string; path: string }[] = [];

    // Search for matching team by path
    for (const [teamName, teamConfig] of Object.entries(config.teams)) {
      const teamPath = resolve(teamConfig.path);
      teamsChecked.push({ name: teamName, path: teamPath });

      // Check if paths match
      if (resolvedPath === teamPath) {
        logger.info({ teamName, path: resolvedPath }, "Team found by path");

        return {
          teamName,
          resolvedPath,
          found: true,
        };
      }
    }

    // No match found
    logger.warn({
      resolvedPath,
      teamsChecked: teamsChecked.length,
    }, "No team found for path");

    return {
      teamName: null,
      resolvedPath,
      found: false,
      teamsChecked,
    };
  } catch (error) {
    logger.error({
      err: error instanceof Error ? error : new Error(String(error))
    }, "Failed to get team name");
    throw error;
  }
}
