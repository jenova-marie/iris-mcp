/**
 * Iris MCP Tool: teams_get_status
 * Get status of teams, processes, and notifications
 */

import type { ClaudeProcessPool } from '../process-pool/pool-manager.js';
import type { NotificationQueue } from '../notifications/queue.js';
import { TeamsConfigManager } from '../config/teams-config.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('tool:teams_get_status');

export interface TeamsGetStatusInput {
  team?: string;
  includeNotifications?: boolean;
}

export interface TeamsGetStatusOutput {
  teams: {
    name: string;
    description: string;
    path: string;
    active: boolean;
    processMetrics?: any;
    notifications?: {
      pending: number;
      total: number;
    };
  }[];
  pool: {
    totalProcesses: number;
    maxProcesses: number;
    processes: Record<string, any>;
  };
  queue?: {
    total: number;
    pending: number;
    read: number;
    expired: number;
    byTeam: Record<string, number>;
  };
  timestamp: number;
}

export async function teamsGetStatus(
  input: TeamsGetStatusInput,
  processPool: ClaudeProcessPool,
  notificationQueue: NotificationQueue,
  configManager: TeamsConfigManager
): Promise<TeamsGetStatusOutput> {
  const { team, includeNotifications = true } = input;

  logger.info('Getting status', { team, includeNotifications });

  try {
    const poolStatus = processPool.getStatus();
    const config = configManager.getConfig();

    // Get teams to report on
    const teamNames = team ? [team] : Object.keys(config.teams);

    // Build team status
    const teams = teamNames.map((teamName) => {
      const teamConfig = config.teams[teamName];
      const process = processPool.getProcess(teamName);
      const processMetrics = process?.getMetrics();

      const teamStatus: any = {
        name: teamName,
        description: teamConfig.description,
        path: teamConfig.path,
        active: !!process && processMetrics?.status !== 'stopped',
      };

      if (processMetrics) {
        teamStatus.processMetrics = processMetrics;
      }

      if (includeNotifications) {
        const pending = notificationQueue.getPending(teamName);
        const history = notificationQueue.getHistory(teamName);

        teamStatus.notifications = {
          pending: pending.length,
          total: history.length,
        };
      }

      return teamStatus;
    });

    const output: TeamsGetStatusOutput = {
      teams,
      pool: {
        totalProcesses: poolStatus.totalProcesses,
        maxProcesses: poolStatus.maxProcesses,
        processes: poolStatus.processes,
      },
      timestamp: Date.now(),
    };

    if (includeNotifications) {
      const queueStats = notificationQueue.getStats();
      const byTeam: Record<string, number> = {};

      // Count pending notifications per team
      for (const teamName of Object.keys(config.teams)) {
        const pending = notificationQueue.getPending(teamName);
        if (pending.length > 0) {
          byTeam[teamName] = pending.length;
        }
      }

      output.queue = {
        total: queueStats.total,
        pending: queueStats.pending,
        read: queueStats.read,
        expired: queueStats.expired,
        byTeam,
      };
    }

    logger.info('Status retrieved', {
      teamsCount: teams.length,
      activeProcesses: poolStatus.totalProcesses,
    });

    return output;
  } catch (error) {
    logger.error('Failed to get status', error);
    throw error;
  }
}
