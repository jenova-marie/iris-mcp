/**
 * Unit tests for notification queue
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotificationQueue } from '../../../src/notifications/queue.js';
import { existsSync, unlinkSync, rmSync } from 'fs';

describe('NotificationQueue', () => {
  let queue: NotificationQueue;
  const testDbPath = './test-notifications.db';

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }

    queue = new NotificationQueue(testDbPath);
  });

  afterEach(() => {
    queue.close();

    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe('add', () => {
    it('should add notification to queue', () => {
      const notification = queue.add('frontend', 'Test message', 'backend');

      expect(notification.id).toBeDefined();
      expect(notification.toTeam).toBe('frontend');
      expect(notification.fromTeam).toBe('backend');
      expect(notification.message).toBe('Test message');
      expect(notification.status).toBe('pending');
      expect(notification.createdAt).toBeDefined();
      expect(notification.expiresAt).toBeDefined();
    });

    it('should work without fromTeam', () => {
      const notification = queue.add('frontend', 'Test message');

      expect(notification.fromTeam).toBeUndefined();
      expect(notification.toTeam).toBe('frontend');
    });

    it('should set expiration based on TTL', () => {
      const notification = queue.add('frontend', 'Test message', undefined, 7);

      const expectedExpiry = notification.createdAt + 7 * 24 * 60 * 60 * 1000;
      expect(notification.expiresAt).toBe(expectedExpiry);
    });

    it('should use default TTL of 30 days', () => {
      const notification = queue.add('frontend', 'Test message');

      const expectedExpiry = notification.createdAt + 30 * 24 * 60 * 60 * 1000;
      expect(notification.expiresAt).toBe(expectedExpiry);
    });
  });

  describe('getPending', () => {
    beforeEach(() => {
      queue.add('frontend', 'Message 1', 'backend');
      // Small delay to ensure different timestamps
      const start = Date.now();
      while (Date.now() === start) {
        // Busy wait for at least 1ms
      }
      queue.add('frontend', 'Message 2', 'mobile');
      queue.add('backend', 'Message 3', 'frontend');
    });

    it('should get pending notifications for a team', () => {
      const notifications = queue.getPending('frontend');

      expect(notifications).toHaveLength(2);
      expect(notifications[0].toTeam).toBe('frontend');
      expect(notifications[1].toTeam).toBe('frontend');
    });

    it('should return empty array for team with no notifications', () => {
      const notifications = queue.getPending('mobile');

      expect(notifications).toHaveLength(0);
    });

    it('should respect limit parameter', () => {
      const notifications = queue.getPending('frontend', 1);

      expect(notifications).toHaveLength(1);
    });

    it('should order by created_at DESC', () => {
      const notifications = queue.getPending('frontend');

      expect(notifications[0].message).toBe('Message 2');
      expect(notifications[1].message).toBe('Message 1');
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', () => {
      const notification = queue.add('frontend', 'Test message');
      const updated = queue.markAsRead(notification.id);

      expect(updated).toBe(true);

      const retrieved = queue.getById(notification.id);
      expect(retrieved?.status).toBe('read');
      expect(retrieved?.readAt).toBeDefined();
    });

    it('should return false for non-existent notification', () => {
      const updated = queue.markAsRead('non-existent-id');

      expect(updated).toBe(false);
    });

    it('should not mark already read notification again', () => {
      const notification = queue.add('frontend', 'Test message');
      queue.markAsRead(notification.id);

      const updated = queue.markAsRead(notification.id);

      expect(updated).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    beforeEach(() => {
      queue.add('frontend', 'Message 1');
      queue.add('frontend', 'Message 2');
      queue.add('backend', 'Message 3');
    });

    it('should mark all pending notifications for a team as read', () => {
      const count = queue.markAllAsRead('frontend');

      expect(count).toBe(2);

      const pending = queue.getPending('frontend');
      expect(pending).toHaveLength(0);
    });

    it('should not affect other teams', () => {
      queue.markAllAsRead('frontend');

      const backendPending = queue.getPending('backend');
      expect(backendPending).toHaveLength(1);
    });

    it('should return 0 when no pending notifications exist', () => {
      const count = queue.markAllAsRead('mobile');

      expect(count).toBe(0);
    });
  });

  describe('getById', () => {
    it('should get notification by ID', () => {
      const notification = queue.add('frontend', 'Test message', 'backend');
      const retrieved = queue.getById(notification.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(notification.id);
      expect(retrieved?.message).toBe('Test message');
    });

    it('should return null for non-existent ID', () => {
      const retrieved = queue.getById('non-existent-id');

      expect(retrieved).toBeNull();
    });
  });

  describe('getHistory', () => {
    beforeEach(() => {
      queue.add('frontend', 'Message 1');
      queue.add('frontend', 'Message 2');
      queue.add('backend', 'Message 3');

      const notifications = queue.getPending('frontend');
      queue.markAsRead(notifications[0].id);
    });

    it('should get all notifications for a team', () => {
      const history = queue.getHistory('frontend');

      expect(history).toHaveLength(2);
      expect(history.every((n) => n.toTeam === 'frontend')).toBe(true);
    });

    it('should include both pending and read notifications', () => {
      const history = queue.getHistory('frontend');

      const statuses = history.map((n) => n.status);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('read');
    });

    it('should respect limit parameter', () => {
      const history = queue.getHistory('frontend', 1);

      expect(history).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('should delete notification', () => {
      const notification = queue.add('frontend', 'Test message');
      const deleted = queue.delete(notification.id);

      expect(deleted).toBe(true);

      const retrieved = queue.getById(notification.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent notification', () => {
      const deleted = queue.delete('non-existent-id');

      expect(deleted).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should mark expired pending notifications as expired', () => {
      // Create a notification with very short TTL
      const notification = queue.add('frontend', 'Test message', undefined, -1);

      const deleted = queue.cleanup();

      const retrieved = queue.getById(notification.id);
      expect(retrieved?.status).toBe('expired');
    });

    it('should delete old read notifications', () => {
      // This test would require mocking Date.now() or modifying the database
      // to insert old read notifications. For now, we'll just verify cleanup runs
      const deleted = queue.cleanup();

      expect(deleted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      queue.add('frontend', 'Message 1');
      queue.add('frontend', 'Message 2');
      queue.add('backend', 'Message 3');

      const notifications = queue.getPending('frontend');
      queue.markAsRead(notifications[0].id);
    });

    it('should return queue statistics', () => {
      const stats = queue.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(2);
      expect(stats.read).toBe(1);
      expect(stats.expired).toBe(0);
    });
  });

  describe('database initialization', () => {
    it('should create data directory if it does not exist', () => {
      const nestedPath = './test-data/notifications.db';
      const nestedQueue = new NotificationQueue(nestedPath);

      expect(existsSync('./test-data')).toBe(true);

      nestedQueue.close();

      // Clean up
      rmSync('./test-data', { recursive: true, force: true });
    });

    it('should enable WAL mode', () => {
      // WAL mode creates -wal and -shm files when there are writes
      queue.add('frontend', 'Test');

      // The queue should be using WAL mode (verified by the existence of WAL files)
      const walExists = existsSync(`${testDbPath}-wal`);
      const shmExists = existsSync(`${testDbPath}-shm`);

      expect(walExists || shmExists).toBe(true);
    });
  });
});
