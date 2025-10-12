/**
 * Iris MCP Module: teams
 * Get all currently configured teams and their status
 */

import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { TeamsConfigManager } from "../config/teams-config.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("mcp:teams");

export interface TeamsInput {
  /** Include process details for active teams (default: false) */
  includeProcessDetails?: boolean;
}

export interface TeamInfo {
  /** Team name */
  name: string;

  /** Whether the team is currently active */
  status: "awake" | "asleep";

  /** Team configuration */
  config: {
    path: string;
    description?: string;
    color?: string;
    idleTimeout?: number;
    skipPermissions?: boolean;
  };

  /** Process details (only if includeProcessDetails=true and team is awake) */
  process?: {
    pid: number;
    sessionId: string;
    messageCount: number;
    lastActivity: number;
  };
}

export interface TeamsOutput {
  /** List of all configured teams */
  teams: TeamInfo[];

  /** Total number of teams */
  totalTeams: number;

  /** Number of teams currently awake */
  awakeTeams: number;

  /** Number of teams currently asleep */
  asleepTeams: number;

  /** Timestamp of status check */
  timestamp: number;
}

export async function teams(
  input: TeamsInput,
  processPool: ClaudeProcessPool,
  configManager: TeamsConfigManager,
): Promise<TeamsOutput> {
  const { includeProcessDetails = false } = input;

  logger.info("Getting teams list", { includeProcessDetails });

  try {
    const config = configManager.getConfig();
    const poolStatus = processPool.getStatus();
    const teamsList: TeamInfo[] = [];

    // Iterate through all configured teams
    for (const [teamName, teamConfig] of Object.entries(config.teams)) {
      // Check if team has an active process
      const process = processPool.getProcess(teamName);
      const sessionKey = `external->${teamName}`;
      const poolProcess = poolStatus.processes[sessionKey];

      const teamInfo: TeamInfo = {
        name: teamName,
        status: process ? "awake" : "asleep",
        config: {
          path: teamConfig.path,
          description: teamConfig.description,
          color: teamConfig.color,
          idleTimeout: teamConfig.idleTimeout,
          skipPermissions: teamConfig.skipPermissions,
        },
      };

      // Add process details if requested and available
      if (
        includeProcessDetails &&
        process &&
        poolProcess &&
        poolProcess.pid !== undefined &&
        poolProcess.sessionId !== undefined
      ) {
        teamInfo.process = {
          pid: poolProcess.pid,
          sessionId: poolProcess.sessionId,
          messageCount: poolProcess.messageCount,
          lastActivity: poolProcess.lastActivity,
        };
      }

      teamsList.push(teamInfo);
    }

    // Sort teams by name
    teamsList.sort((a, b) => a.name.localeCompare(b.name));

    // Calculate statistics
    const awakeCount = teamsList.filter((t) => t.status === "awake").length;
    const asleepCount = teamsList.filter((t) => t.status === "asleep").length;

    const output: TeamsOutput = {
      teams: teamsList,
      totalTeams: teamsList.length,
      awakeTeams: awakeCount,
      asleepTeams: asleepCount,
      timestamp: Date.now(),
    };

    logger.info("Teams list retrieved", {
      totalTeams: output.totalTeams,
      awakeTeams: output.awakeTeams,
      asleepTeams: output.asleepTeams,
    });

    return output;
  } catch (error) {
    logger.error("Failed to get teams list", error);
    throw error;
  }
}
