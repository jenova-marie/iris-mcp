/**
 * Integration tests for teams_get_status tool
 * Tests mechanism without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { teamsGetStatus } from '../../../src/tools/teams-get-status.js';
import { createTestFixture, cleanupTestFixture, type TestFixture } from './utils/test-helpers.js';

describe('teams_get_status Integration', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture('teams-get-status');
  });

  afterEach(async () => {
    await cleanupTestFixture(fixture);
  });

  describe('basic status retrieval', () => {
    it('should return status with no active processes', async () => {
      const result = await teamsGetStatus(
        {
          includeNotifications: true,
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result).toBeDefined();
      expect(result.teams).toBeDefined();
      expect(Array.isArray(result.teams)).toBe(true);
      expect(result.teams.length).toBeGreaterThan(0);
      expect(result.processPool).toBeDefined();
      expect(result.processPool.totalProcesses).toBe(0);
      expect(result.processPool.maxProcesses).toBe(5);
      expect(result.notifications).toBeDefined();
      expect(result.notifications.totalPending).toBe(0);
    }, 5000);

    it('should return status with active processes', async () => {
      // Create some processes
      await fixture.pool.getOrCreateProcess('frontend');
      await fixture.pool.getOrCreateProcess('backend');

      const result = await teamsGetStatus(
        {
          includeNotifications: true,
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result.processPool.totalProcesses).toBe(2);
      expect(result.processPool.processes).toHaveProperty('frontend');
      expect(result.processPool.processes).toHaveProperty('backend');
      expect(result.processPool.processes.frontend.status).toBe('idle');
      expect(result.processPool.processes.backend.status).toBe('idle');
    }, 20000);

    it('should include process metrics', async () => {
      await fixture.pool.getOrCreateProcess('mobile');

      const result = await teamsGetStatus(
        {},
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      const mobileProcess = result.processPool.processes.mobile;
      expect(mobileProcess).toBeDefined();
      expect(mobileProcess.pid).toBeDefined();
      expect(mobileProcess.status).toBe('idle');
      expect(mobileProcess.messagesProcessed).toBeGreaterThanOrEqual(0);
      expect(mobileProcess.uptime).toBeGreaterThan(0);
    }, 15000);
  });

  describe('team filtering', () => {
    it('should return status for all teams when no filter specified', async () => {
      const result = await teamsGetStatus(
        {},
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result.teams.length).toBe(3);
      const teamNames = result.teams.map(t => t.name);
      expect(teamNames).toContain('frontend');
      expect(teamNames).toContain('backend');
      expect(teamNames).toContain('mobile');
    }, 5000);

    it('should filter by specific team', async () => {
      await fixture.pool.getOrCreateProcess('frontend');
      await fixture.pool.getOrCreateProcess('backend');

      const result = await teamsGetStatus(
        {
          team: 'frontend',
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      // Process pool should still show all processes
      expect(result.processPool.processes).toHaveProperty('frontend');
      expect(result.processPool.processes).toHaveProperty('backend');

      // But teams list should include frontend
      expect(result.teams).toBeDefined();
    }, 20000);
  });

  describe('notification statistics', () => {
    it('should include notification counts', async () => {
      // Add some notifications
      fixture.notificationQueue.add('frontend', 'Test 1', 'backend');
      fixture.notificationQueue.add('frontend', 'Test 2', 'mobile');
      fixture.notificationQueue.add('backend', 'Test 3', 'frontend');

      const result = await teamsGetStatus(
        {
          includeNotifications: true,
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result.notifications.totalPending).toBe(3);
      expect(result.notifications.byTeam).toBeDefined();
      expect(result.notifications.byTeam.frontend).toBe(2);
      expect(result.notifications.byTeam.backend).toBe(1);
    }, 5000);

    it('should work with includeNotifications=false', async () => {
      fixture.notificationQueue.add('frontend', 'Test', 'backend');

      const result = await teamsGetStatus(
        {
          includeNotifications: false,
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result).toBeDefined();
      expect(result.teams).toBeDefined();
      expect(result.processPool).toBeDefined();
      // Notifications should still be present but may have minimal data
      expect(result.notifications).toBeDefined();
    }, 5000);

    it('should handle empty notification queue', async () => {
      const result = await teamsGetStatus(
        {
          includeNotifications: true,
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result.notifications.totalPending).toBe(0);
      expect(Object.keys(result.notifications.byTeam || {})).toHaveLength(0);
    }, 5000);
  });

  describe('combined state', () => {
    it('should show combined process and notification state', async () => {
      // Create processes
      await fixture.pool.getOrCreateProcess('frontend');
      await fixture.pool.getOrCreateProcess('backend');

      // Add notifications
      fixture.notificationQueue.add('mobile', 'Notification 1', 'frontend');
      fixture.notificationQueue.add('mobile', 'Notification 2', 'backend');

      const result = await teamsGetStatus(
        {
          includeNotifications: true,
        },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      // Should show active processes
      expect(result.processPool.totalProcesses).toBe(2);

      // Should show pending notifications
      expect(result.notifications.totalPending).toBe(2);
      expect(result.notifications.byTeam.mobile).toBe(2);

      // Should list all teams
      expect(result.teams.length).toBe(3);
    }, 20000);

    it('should reflect real-time state changes', async () => {
      // Initial state
      let result = await teamsGetStatus(
        {},
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );
      expect(result.processPool.totalProcesses).toBe(0);

      // Add a process
      await fixture.pool.getOrCreateProcess('frontend');

      result = await teamsGetStatus(
        {},
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );
      expect(result.processPool.totalProcesses).toBe(1);

      // Add notifications
      fixture.notificationQueue.add('backend', 'Test', 'frontend');

      result = await teamsGetStatus(
        { includeNotifications: true },
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );
      expect(result.notifications.totalPending).toBe(1);
    }, 15000);
  });

  describe('default behavior', () => {
    it('should use default includeNotifications when not specified', async () => {
      const result = await teamsGetStatus(
        {},
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result.notifications).toBeDefined();
    }, 5000);

    it('should handle empty input object', async () => {
      const result = await teamsGetStatus(
        {},
        fixture.pool,
        fixture.notificationQueue,
        fixture.configManager
      );

      expect(result).toBeDefined();
      expect(result.teams).toBeDefined();
      expect(result.processPool).toBeDefined();
      expect(result.notifications).toBeDefined();
    }, 5000);
  });

  describe('concurrent operations', () => {
    it('should handle concurrent status requests', async () => {
      await fixture.pool.getOrCreateProcess('frontend');

      const operations = [
        teamsGetStatus({}, fixture.pool, fixture.notificationQueue, fixture.configManager),
        teamsGetStatus({}, fixture.pool, fixture.notificationQueue, fixture.configManager),
        teamsGetStatus({}, fixture.pool, fixture.notificationQueue, fixture.configManager),
      ];

      const results = await Promise.all(operations);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.processPool.totalProcesses).toBe(1);
      });
    }, 15000);
  });
});
