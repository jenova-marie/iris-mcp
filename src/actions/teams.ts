/**
 * Iris MCP Module: teams
 * Get all currently configured teams
 */

import type { TeamsConfigManager } from "../config/iris-config.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:teams");

export interface TeamsInput {
  // No input needed
}

export interface TeamInfo {
  /** Team name */
  name: string;

  /** Team configuration */
  config: {
    path: string;
    description?: string;
    color?: string;
    idleTimeout?: number;
  };
}

export interface TeamsOutput {
  /** List of all configured teams */
  teams: TeamInfo[];

  /** Total number of teams */
  totalTeams: number;

  /** Timestamp of query */
  timestamp: number;
}

export async function teams(
  input: TeamsInput,
  configManager: TeamsConfigManager,
): Promise<TeamsOutput> {
  logger.info("Getting teams list");

  try {
    const config = configManager.getConfig();
    const teamsList: TeamInfo[] = [];

    // Iterate through all configured teams
    for (const [teamName, irisConfig] of Object.entries(config.teams)) {
      const teamInfo: TeamInfo = {
        name: teamName,
        config: {
          path: irisConfig.path,
          description: irisConfig.description,
          color: irisConfig.color,
          idleTimeout: irisConfig.idleTimeout,
        },
      };

      teamsList.push(teamInfo);
    }

    // Sort teams by name
    teamsList.sort((a, b) => a.name.localeCompare(b.name));

    const output: TeamsOutput = {
      teams: teamsList,
      totalTeams: teamsList.length,
      timestamp: Date.now(),
    };

    logger.info(
      {
        totalTeams: output.totalTeams,
      },
      "Teams list retrieved",
    );

    return output;
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
      },
      "Failed to get teams list",
    );
    throw error;
  }
}
