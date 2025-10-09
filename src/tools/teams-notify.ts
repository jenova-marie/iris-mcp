/**
 * Iris MCP Tool: teams_notify
 * Fire-and-forget notifications to teams via persistent queue
 */

import type { NotificationQueue } from '../notifications/queue.js';
import { validateTeamName, validateMessage } from '../utils/validation.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('tool:teams_notify');

export interface TeamsNotifyInput {
  fromTeam?: string;
  toTeam: string;
  message: string;
  ttlDays?: number;
}

export interface TeamsNotifyOutput {
  notificationId: string;
  from?: string;
  to: string;
  message: string;
  expiresAt: number;
  timestamp: number;
}

export async function teamsNotify(
  input: TeamsNotifyInput,
  notificationQueue: NotificationQueue
): Promise<TeamsNotifyOutput> {
  const { fromTeam, toTeam, message, ttlDays = 30 } = input;

  // Validate inputs
  validateTeamName(toTeam);
  if (fromTeam) {
    validateTeamName(fromTeam);
  }
  validateMessage(message);

  logger.info('Creating notification', {
    from: fromTeam,
    to: toTeam,
    ttlDays,
  });

  try {
    // Add notification to queue
    const notification = notificationQueue.add(toTeam, message, fromTeam, ttlDays);

    logger.info('Notification created', {
      id: notification.id,
      toTeam,
    });

    return {
      notificationId: notification.id,
      from: fromTeam,
      to: toTeam,
      message,
      expiresAt: notification.expiresAt,
      timestamp: notification.createdAt,
    };
  } catch (error) {
    logger.error('Failed to create notification', error);
    throw error;
  }
}
