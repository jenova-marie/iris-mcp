/**
 * Iris MCP - Notification Queue
 * Persistent notification queue for async team messaging
 *
 * NOTE: This is currently a stub implementation using in-memory storage.
 * A full SQLite implementation will be added later.
 */

import { Logger } from "../utils/logger.js";

const logger = new Logger("notification-queue");

export interface Notification {
  id: string;
  fromTeam: string;
  toTeam: string;
  message: string;
  status: "pending" | "read" | "expired";
  createdAt: number;
  readAt?: number;
  expiresAt: number;
}

/**
 * Notification Queue (stub implementation)
 * Currently stores notifications in memory - they will not persist across restarts
 */
export class NotificationQueue {
  private notifications: Map<string, Notification[]> = new Map();

  constructor(private dbPath: string) {
    logger.info("Notification queue initialized (stub)", { dbPath });
  }

  /**
   * Add a notification to the queue
   */
  add(
    fromTeam: string,
    toTeam: string,
    message: string,
    ttlDays: number = 30,
  ): string {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const notification: Notification = {
      id,
      fromTeam,
      toTeam,
      message,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    };

    if (!this.notifications.has(toTeam)) {
      this.notifications.set(toTeam, []);
    }

    this.notifications.get(toTeam)!.push(notification);
    logger.debug("Notification added", { id, fromTeam, toTeam });

    return id;
  }

  /**
   * Get pending notifications for a team
   */
  getPending(teamName: string): Notification[] {
    const teamNotifications = this.notifications.get(teamName) || [];
    return teamNotifications.filter((n) => n.status === "pending");
  }

  /**
   * Mark a notification as read
   */
  markAsRead(id: string): boolean {
    for (const notifications of this.notifications.values()) {
      const notification = notifications.find((n) => n.id === id);
      if (notification) {
        notification.status = "read";
        notification.readAt = Date.now();
        logger.debug("Notification marked as read", { id });
        return true;
      }
    }
    return false;
  }

  /**
   * Clean up expired notifications
   */
  cleanupExpired(): number {
    const now = Date.now();
    let count = 0;

    for (const [teamName, notifications] of this.notifications.entries()) {
      const before = notifications.length;
      const filtered = notifications.filter((n) => n.expiresAt > now);
      this.notifications.set(teamName, filtered);
      count += before - filtered.length;
    }

    if (count > 0) {
      logger.info("Cleaned up expired notifications", { count });
    }

    return count;
  }

  /**
   * Get all notifications for a team (including read/expired)
   */
  getAll(teamName: string): Notification[] {
    return this.notifications.get(teamName) || [];
  }

  /**
   * Delete a notification
   */
  delete(id: string): boolean {
    for (const [teamName, notifications] of this.notifications.entries()) {
      const index = notifications.findIndex((n) => n.id === id);
      if (index !== -1) {
        notifications.splice(index, 1);
        logger.debug("Notification deleted", { id });
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all notifications for a team
   */
  clear(teamName: string): number {
    const notifications = this.notifications.get(teamName) || [];
    const count = notifications.length;
    this.notifications.set(teamName, []);
    logger.info("Cleared notifications for team", { teamName, count });
    return count;
  }

  /**
   * Get total notification count across all teams
   */
  getTotalCount(): number {
    let count = 0;
    for (const notifications of this.notifications.values()) {
      count += notifications.length;
    }
    return count;
  }

  /**
   * Get pending notification count across all teams
   */
  getPendingCount(): number {
    let count = 0;
    for (const notifications of this.notifications.values()) {
      count += notifications.filter((n) => n.status === "pending").length;
    }
    return count;
  }
}
