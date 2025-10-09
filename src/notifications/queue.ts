/**
 * Iris MCP - Notification Queue
 * SQLite-based persistent queue for async team notifications
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../utils/logger.js';

const logger = new Logger('notifications');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Notification {
  id: string;
  fromTeam?: string;
  toTeam: string;
  message: string;
  status: 'pending' | 'read' | 'expired';
  createdAt: number;
  readAt?: number;
  expiresAt: number;
}

export class NotificationQueue {
  private db: Database.Database;

  constructor(dbPath = './data/notifications.db') {
    // Ensure data directory exists
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Open database
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Initialize schema
    this.initializeSchema();

    // Start cleanup interval
    this.startCleanup();

    logger.info('Notification queue initialized', { dbPath });
  }

  /**
   * Add a notification to the queue
   */
  add(
    toTeam: string,
    message: string,
    fromTeam?: string,
    ttlDays = 30
  ): Notification {
    const now = Date.now();
    const notification: Notification = {
      id: randomUUID(),
      fromTeam,
      toTeam,
      message,
      status: 'pending',
      createdAt: now,
      expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
    };

    const stmt = this.db.prepare(`
      INSERT INTO notifications (
        id, from_team, to_team, message, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      notification.id,
      notification.fromTeam,
      notification.toTeam,
      notification.message,
      notification.status,
      notification.createdAt,
      notification.expiresAt
    );

    logger.info('Notification added', {
      id: notification.id,
      toTeam,
      fromTeam,
    });

    return notification;
  }

  /**
   * Get pending notifications for a team
   */
  getPending(toTeam: string, limit = 50): Notification[] {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE to_team = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(toTeam, limit) as any[];
    return rows.map(this.rowToNotification);
  }

  /**
   * Mark notification as read
   */
  markAsRead(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE notifications
      SET status = 'read', read_at = ?
      WHERE id = ? AND status = 'pending'
    `);

    const result = stmt.run(Date.now(), id);
    const updated = result.changes > 0;

    if (updated) {
      logger.debug('Notification marked as read', { id });
    }

    return updated;
  }

  /**
   * Mark all pending notifications for a team as read
   */
  markAllAsRead(toTeam: string): number {
    const stmt = this.db.prepare(`
      UPDATE notifications
      SET status = 'read', read_at = ?
      WHERE to_team = ? AND status = 'pending'
    `);

    const result = stmt.run(Date.now(), toTeam);
    const count = result.changes;

    if (count > 0) {
      logger.info('Marked all notifications as read', { toTeam, count });
    }

    return count;
  }

  /**
   * Get notification by ID
   */
  getById(id: string): Notification | null {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    return row ? this.rowToNotification(row) : null;
  }

  /**
   * Get notification history for a team
   */
  getHistory(toTeam: string, limit = 100): Notification[] {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE to_team = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(toTeam, limit) as any[];
    return rows.map(this.rowToNotification);
  }

  /**
   * Delete notification
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM notifications WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Clean up expired notifications
   */
  cleanup(): number {
    const now = Date.now();

    // Mark expired as expired
    const updateStmt = this.db.prepare(`
      UPDATE notifications
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
    `);

    updateStmt.run(now);

    // Delete old expired and read notifications (older than 30 days)
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const deleteStmt = this.db.prepare(`
      DELETE FROM notifications
      WHERE (status = 'expired' OR status = 'read')
      AND created_at < ?
    `);

    const result = deleteStmt.run(thirtyDaysAgo);
    const deleted = result.changes;

    if (deleted > 0) {
      logger.info('Cleaned up old notifications', { deleted });
    }

    return deleted;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    pending: number;
    read: number;
    expired: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END), 0) as read,
        COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) as expired
      FROM notifications
    `);

    return stmt.get() as any;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');

    this.db.exec(schema);
  }

  /**
   * Start cleanup interval (every hour)
   */
  private startCleanup(): void {
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * Convert database row to Notification object
   */
  private rowToNotification(row: any): Notification {
    return {
      id: row.id,
      fromTeam: row.from_team,
      toTeam: row.to_team,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      readAt: row.read_at,
      expiresAt: row.expires_at,
    };
  }
}
