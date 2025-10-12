/**
 * Iris MCP Module: getTeamName
 * Identify team name from current working directory
 */

import { resolve } from "path";
import type { TeamsConfigManager } from "../config/teams-config.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("mcp:getTeamName");

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

  logger.info("Looking up team name by path", { pwd });

  try {
    // Resolve pwd to absolute path
    const resolvedPath = resolve(pwd);
    logger.debug("Resolved path", { resolvedPath });

    const config = configManager.getConfig();
    const teamsChecked: { name: string; path: string }[] = [];

    // Search for matching team by path
    for (const [teamName, teamConfig] of Object.entries(config.teams)) {
      const teamPath = resolve(teamConfig.path);
      teamsChecked.push({ name: teamName, path: teamPath });

      // Check if paths match
      if (resolvedPath === teamPath) {
        logger.info("Team found by path", { teamName, path: resolvedPath });

        return {
          teamName,
          resolvedPath,
          found: true,
        };
      }
    }

    // No match found
    logger.warn("No team found for path", {
      resolvedPath,
      teamsChecked: teamsChecked.length,
    });

    return {
      teamName: null,
      resolvedPath,
      found: false,
      teamsChecked,
    };
  } catch (error) {
    logger.error("Failed to get team name", error);
    throw error;
  }
}
