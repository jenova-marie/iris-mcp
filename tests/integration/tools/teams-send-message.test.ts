/**
 * Integration tests for teams_send_message tool
 * Tests mechanism without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { teamsSendMessage } from '../../../src/tools/teams-send-message.js';
import { createTestFixture, cleanupTestFixture, type TestFixture } from './utils/test-helpers.js';

describe('teams_send_message Integration', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture('teams-send-message');
  });

  afterEach(async () => {
    await cleanupTestFixture(fixture);
  });

  describe('synchronous messaging (waitForResponse=true)', () => {
    it('should send message and wait for response', async () => {
      const result = await teamsSendMessage(
        {
          toTeam: 'backend',
          message: 'Test message',
          waitForResponse: true,
          timeout: 30000,
        },
        fixture.pool
      );

      expect(result).toBeDefined();
      expect(result.to).toBe('backend');
      expect(result.message).toBe('Test message');
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe('string');
      expect(result.async).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThan(0);
    }, 35000);

    it('should include fromTeam in result', async () => {
      const result = await teamsSendMessage(
        {
          fromTeam: 'mobile',
          toTeam: 'backend',
          message: 'Test from mobile',
          waitForResponse: true,
          timeout: 30000,
        },
        fixture.pool
      );

      expect(result.from).toBe('mobile');
      expect(result.to).toBe('backend');
      expect(result.response).toBeDefined();
    }, 35000);

    it('should handle multiple sequential messages', async () => {
      const result1 = await teamsSendMessage(
        {
          toTeam: 'frontend',
          message: 'First message',
          waitForResponse: true,
          timeout: 30000,
        },
        fixture.pool
      );

      const result2 = await teamsSendMessage(
        {
          toTeam: 'frontend',
          message: 'Second message',
          waitForResponse: true,
          timeout: 30000,
        },
        fixture.pool
      );

      expect(result1.response).toBeDefined();
      expect(result2.response).toBeDefined();
      expect(result1.timestamp).toBeLessThanOrEqual(result2.timestamp);
    }, 65000);
  });

  describe('asynchronous messaging (waitForResponse=false)', () => {
    it('should send message without waiting for response', async () => {
      const result = await teamsSendMessage(
        {
          toTeam: 'backend',
          message: 'Background task',
          waitForResponse: false,
          timeout: 30000,
        },
        fixture.pool
      );

      expect(result).toBeDefined();
      expect(result.to).toBe('backend');
      expect(result.message).toBe('Background task');
      expect(result.async).toBe(true);
      expect(result.response).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);
    }, 35000);

    it('should return quickly for async messages', async () => {
      const startTime = Date.now();

      await teamsSendMessage(
        {
          toTeam: 'backend',
          message: 'Async message',
          waitForResponse: false,
        },
        fixture.pool
      );

      const duration = Date.now() - startTime;

      // Async should return much faster than typical Claude response (< 15s)
      expect(duration).toBeLessThan(15000);
    }, 20000);
  });

  describe('default behavior', () => {
    it('should default to waitForResponse=true', async () => {
      const result = await teamsSendMessage(
        {
          toTeam: 'mobile',
          message: 'Default behavior test',
          timeout: 30000,
        },
        fixture.pool
      );

      expect(result.async).toBe(false);
      expect(result.response).toBeDefined();
    }, 35000);

    it('should use default timeout', async () => {
      const result = await teamsSendMessage(
        {
          toTeam: 'frontend',
          message: 'Default timeout test',
          waitForResponse: true,
        },
        fixture.pool
      );

      expect(result.response).toBeDefined();
    }, 35000);
  });

  describe('validation errors', () => {
    it('should throw error for invalid team name', async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: '../invalid',
            message: 'test',
          },
          fixture.pool
        )
      ).rejects.toThrow('Invalid team name');
    }, 5000);

    it('should throw error for empty message', async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: 'backend',
            message: '',
          },
          fixture.pool
        )
      ).rejects.toThrow('Invalid message');
    }, 5000);

    it('should throw error for message that is too long', async () => {
      const longMessage = 'x'.repeat(100001);

      await expect(
        teamsSendMessage(
          {
            toTeam: 'backend',
            message: longMessage,
          },
          fixture.pool
        )
      ).rejects.toThrow('Invalid message');
    }, 5000);

    it('should throw error for non-existent team', async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: 'nonexistent',
            message: 'test',
          },
          fixture.pool
        )
      ).rejects.toThrow('Team "nonexistent" not found');
    }, 5000);
  });

  describe('concurrent operations', () => {
    it('should handle concurrent sends to different teams', async () => {
      const operations = [
        teamsSendMessage(
          { toTeam: 'frontend', message: 'Message 1', waitForResponse: true, timeout: 30000 },
          fixture.pool
        ),
        teamsSendMessage(
          { toTeam: 'backend', message: 'Message 2', waitForResponse: true, timeout: 30000 },
          fixture.pool
        ),
        teamsSendMessage(
          { toTeam: 'mobile', message: 'Message 3', waitForResponse: true, timeout: 30000 },
          fixture.pool
        ),
      ];

      const results = await Promise.all(operations);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.response).toBeDefined();
      });
    }, 40000);

    it('should handle mix of sync and async messages', async () => {
      const operations = [
        teamsSendMessage(
          { toTeam: 'frontend', message: 'Sync 1', waitForResponse: true, timeout: 30000 },
          fixture.pool
        ),
        teamsSendMessage(
          { toTeam: 'backend', message: 'Async 1', waitForResponse: false },
          fixture.pool
        ),
        teamsSendMessage(
          { toTeam: 'mobile', message: 'Sync 2', waitForResponse: true, timeout: 30000 },
          fixture.pool
        ),
      ];

      const results = await Promise.all(operations);

      expect(results[0].async).toBe(false);
      expect(results[1].async).toBe(true);
      expect(results[2].async).toBe(false);
    }, 40000);
  });
});
