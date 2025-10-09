/**
 * Integration tests for teams_notify tool
 * Tests mechanism without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { teamsNotify } from '../../../src/tools/teams-notify.js';
import { createTestFixture, cleanupTestFixture, type TestFixture } from './utils/test-helpers.js';

describe('teams_notify Integration', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture('teams-notify');
  });

  afterEach(async () => {
    await cleanupTestFixture(fixture);
  });

  describe('successful execution', () => {
    it('should add notification to queue', async () => {
      const result = await teamsNotify(
        {
          toTeam: 'frontend',
          message: 'Test notification',
          fromTeam: 'backend',
          ttlDays: 30,
        },
        fixture.notificationQueue
      );

      expect(result).toBeDefined();
      expect(result.notificationId).toBeDefined();
      expect(result.to).toBe('frontend');
      expect(result.message).toBe('Test notification');
      expect(result.from).toBe('backend');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
      expect(result.timestamp).toBeGreaterThan(0);

      // Verify notification was actually added to queue
      const notifications = fixture.notificationQueue.getForTeam('frontend');
      expect(notifications.length).toBe(1);
      expect(notifications[0].message).toBe('Test notification');
      expect(notifications[0].fromTeam).toBe('backend');
    }, 5000);

    it('should handle notification without fromTeam', async () => {
      const result = await teamsNotify(
        {
          toTeam: 'backend',
          message: 'Anonymous notification',
        },
        fixture.notificationQueue
      );

      expect(result.to).toBe('backend');
      expect(result.from).toBeUndefined();

      const notifications = fixture.notificationQueue.getForTeam('backend');
      expect(notifications[0].fromTeam).toBeNull();
    }, 5000);

    it('should handle custom TTL', async () => {
      const result = await teamsNotify(
        {
          toTeam: 'mobile',
          message: 'Short-lived notification',
          ttlDays: 7,
        },
        fixture.notificationQueue
      );

      expect(result.expiresAt).toBeDefined();

      // Verify TTL is approximately 7 days from now
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
      const expectedExpiry = Date.now() + sevenDaysInMs;
      const tolerance = 5000; // 5 seconds tolerance

      expect(result.expiresAt).toBeGreaterThan(expectedExpiry - tolerance);
      expect(result.expiresAt).toBeLessThan(expectedExpiry + tolerance);
    }, 5000);

    it('should use default TTL when not specified', async () => {
      const result = await teamsNotify(
        {
          toTeam: 'frontend',
          message: 'Default TTL notification',
        },
        fixture.notificationQueue
      );

      // Default is 30 days
      const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
      const expectedExpiry = Date.now() + thirtyDaysInMs;
      const tolerance = 5000;

      expect(result.expiresAt).toBeGreaterThan(expectedExpiry - tolerance);
      expect(result.expiresAt).toBeLessThan(expectedExpiry + tolerance);
    }, 5000);

    it('should handle multiple notifications to same team', async () => {
      await teamsNotify(
        { toTeam: 'frontend', message: 'Notification 1', fromTeam: 'backend' },
        fixture.notificationQueue
      );

      await teamsNotify(
        { toTeam: 'frontend', message: 'Notification 2', fromTeam: 'mobile' },
        fixture.notificationQueue
      );

      await teamsNotify(
        { toTeam: 'frontend', message: 'Notification 3', fromTeam: 'backend' },
        fixture.notificationQueue
      );

      const notifications = fixture.notificationQueue.getForTeam('frontend');
      expect(notifications.length).toBe(3);
    }, 5000);

    it('should handle notifications to different teams', async () => {
      await teamsNotify(
        { toTeam: 'frontend', message: 'To frontend' },
        fixture.notificationQueue
      );

      await teamsNotify(
        { toTeam: 'backend', message: 'To backend' },
        fixture.notificationQueue
      );

      await teamsNotify(
        { toTeam: 'mobile', message: 'To mobile' },
        fixture.notificationQueue
      );

      expect(fixture.notificationQueue.getForTeam('frontend').length).toBe(1);
      expect(fixture.notificationQueue.getForTeam('backend').length).toBe(1);
      expect(fixture.notificationQueue.getForTeam('mobile').length).toBe(1);
    }, 5000);
  });

  describe('validation errors', () => {
    it('should throw error for invalid team name', async () => {
      await expect(
        teamsNotify(
          {
            toTeam: '../invalid',
            message: 'test',
          },
          fixture.notificationQueue
        )
      ).rejects.toThrow('Invalid team name');
    }, 5000);

    it('should throw error for empty team name', async () => {
      await expect(
        teamsNotify(
          {
            toTeam: '',
            message: 'test',
          },
          fixture.notificationQueue
        )
      ).rejects.toThrow();
    }, 5000);

    it('should throw error for empty message', async () => {
      await expect(
        teamsNotify(
          {
            toTeam: 'frontend',
            message: '',
          },
          fixture.notificationQueue
        )
      ).rejects.toThrow('Invalid message');
    }, 5000);

    it('should throw error for message that is too long', async () => {
      const longMessage = 'x'.repeat(100001);

      await expect(
        teamsNotify(
          {
            toTeam: 'frontend',
            message: longMessage,
          },
          fixture.notificationQueue
        )
      ).rejects.toThrow('Invalid message');
    }, 5000);

    it('should throw error for invalid fromTeam', async () => {
      await expect(
        teamsNotify(
          {
            toTeam: 'frontend',
            message: 'test',
            fromTeam: '../invalid',
          },
          fixture.notificationQueue
        )
      ).rejects.toThrow('Invalid team name');
    }, 5000);
  });

  describe('concurrent operations', () => {
    it('should handle concurrent notifications', async () => {
      const operations = [
        teamsNotify(
          { toTeam: 'frontend', message: 'Notification 1', fromTeam: 'backend' },
          fixture.notificationQueue
        ),
        teamsNotify(
          { toTeam: 'backend', message: 'Notification 2', fromTeam: 'mobile' },
          fixture.notificationQueue
        ),
        teamsNotify(
          { toTeam: 'mobile', message: 'Notification 3', fromTeam: 'frontend' },
          fixture.notificationQueue
        ),
      ];

      const results = await Promise.all(operations);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.notificationId).toBeDefined();
      });

      // Verify all notifications were added
      expect(fixture.notificationQueue.getForTeam('frontend').length).toBe(1);
      expect(fixture.notificationQueue.getForTeam('backend').length).toBe(1);
      expect(fixture.notificationQueue.getForTeam('mobile').length).toBe(1);
    }, 5000);

    it('should handle rapid sequential notifications', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          teamsNotify(
            { toTeam: 'frontend', message: `Notification ${i}`, fromTeam: 'backend' },
            fixture.notificationQueue
          )
        );
      }

      await Promise.all(promises);

      const notifications = fixture.notificationQueue.getForTeam('frontend');
      expect(notifications.length).toBe(10);
    }, 5000);
  });

  describe('persistence', () => {
    it('should persist notifications across queue reopens', async () => {
      await teamsNotify(
        { toTeam: 'frontend', message: 'Persistent notification' },
        fixture.notificationQueue
      );

      // Close and reopen the queue
      fixture.notificationQueue.close();
      const newQueue = new (await import('../../../src/notifications/queue.js')).NotificationQueue(
        fixture.dbPath
      );

      const notifications = newQueue.getForTeam('frontend');
      expect(notifications.length).toBe(1);
      expect(notifications[0].message).toBe('Persistent notification');

      newQueue.close();
    }, 5000);
  });
});
