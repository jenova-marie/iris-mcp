/**
 * Iris MCP Module: isAwake
 * Check if teams are awake or asleep and get their status
 */

import type { IrisOrchestrator } from "../iris.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { TeamsConfigManager } from "../config/iris-config.js";
import type { SessionManager } from "../session/session-manager.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:is-awake");

export interface IsAwakeInput {
  /** Calling team (required to identify sessions) */
  fromTeam: string;

  /** Optional: Get status for a specific team only */
  team?: string;

  /** Include notification queue statistics (default: true) */
  includeNotifications?: boolean;
}

export interface TeamStatus {
  /** Team name */
  name: string;

  /** Whether the team is currently active in the process pool */
  status: "awake" | "asleep";

  /** Process ID if active */
  pid?: number;

  /** Session ID if active */
  sessionId?: string;

  /** Message count if active */
  messageCount?: number;

  /** Last activity timestamp if active */
  lastActivity?: number;

  /** Team configuration */
  config: {
    path: string;
    description?: string;
    color?: string;
  };
}

export interface IsAwakeOutput {
  /** Status of individual teams */
  teams: TeamStatus[];

  /** Overall pool statistics */
  pool: {
    activeProcesses: number;
    maxProcesses: number;
    totalMessages: number;
  };

  /** Notification queue statistics (if includeNotifications=true) */
  notifications?: {
    pending: number;
    total: number;
  };

  /** Timestamp of status check */
  timestamp: number;
}

export async function isAwake(
  input: IsAwakeInput,
  iris: IrisOrchestrator,
  processPool: ClaudeProcessPool,
  configManager: TeamsConfigManager,
  sessionManager: SessionManager,
): Promise<IsAwakeOutput> {
  const { fromTeam, team, includeNotifications = true } = input;

  // Validate fromTeam (required)
  validateTeamName(fromTeam);

  // Validate team name if provided
  if (team) {
    validateTeamName(team);
  }

  logger.info({ fromTeam, team, includeNotifications }, "Getting status");

  try {
    const config = configManager.getConfig();
    const poolStatus = processPool.getStatus();
    const teams: TeamStatus[] = [];

    // Get status for specific team or all teams
    const teamsToCheck = team ? { [team]: config.teams[team] } : config.teams;

    if (team && !config.teams[team]) {
      throw new Error(`Unknown team: ${team}`);
    }

    // Check each team
    for (const [teamName, irisConfig] of Object.entries(teamsToCheck)) {
      // Check if a session exists for this team pair in SessionManager
      const session = sessionManager.getSession(fromTeam, teamName);

      // Build poolKey for this session (fromTeam->toTeam)
      const poolKey = `${fromTeam}->${teamName}`;
      const poolProcess = poolStatus.processes[poolKey];

      const teamStatus: TeamStatus = {
        name: teamName,
        status: poolProcess ? "awake" : "asleep",
        config: {
          path: irisConfig.path,
          description: irisConfig.description,
          color: irisConfig.color,
        },
      };

      // Add active process details if available
      if (session && poolProcess) {
        teamStatus.pid = poolProcess.pid;
        teamStatus.sessionId = session.sessionId;
        teamStatus.messageCount = session.messageCount;
        teamStatus.lastActivity = poolProcess.lastActivity;
      }

      teams.push(teamStatus);
    }

    // Sort teams by name
    teams.sort((a, b) => a.name.localeCompare(b.name));

    // Calculate pool statistics
    const activeProcesses = Object.keys(poolStatus.processes).length;
    const totalMessages = Object.values(poolStatus.processes).reduce(
      (sum, p) => sum + p.messageCount,
      0,
    );

    const output: IsAwakeOutput = {
      teams,
      pool: {
        activeProcesses,
        maxProcesses: poolStatus.maxProcesses,
        totalMessages,
      },
      timestamp: Date.now(),
    };

    // Add notification statistics if requested
    if (includeNotifications) {
      // TODO: Implement when NotificationQueue is available
      output.notifications = {
        pending: 0,
        total: 0,
      };
    }

    logger.info(
      {
        teamCount: teams.length,
        activeCount: teams.filter((t) => t.status === "awake").length,
      },
      "Status retrieved",
    );

    return output;
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
      },
      "Failed to get status",
    );
    throw error;
  }
}
