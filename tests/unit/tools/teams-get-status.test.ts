/**
 * Unit tests for teams_get_status tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teamsGetStatus } from '../../../src/tools/teams-get-status.js';

describe('teamsGetStatus', () => {
  let mockProcessPool: any;
  let mockNotificationQueue: any;
  let mockConfigManager: any;

  beforeEach(() => {
    mockProcessPool = {
      getStatus: vi.fn(),
      getProcess: vi.fn(),
    };

    mockNotificationQueue = {
      getPending: vi.fn(),
      getHistory: vi.fn(),
      getStats: vi.fn(),
    };

    mockConfigManager = {
      getConfig: vi.fn(),
    };
  });

  it('should return status for all teams', async () => {
    mockProcessPool.getStatus.mockReturnValue({
      totalProcesses: 2,
      maxProcesses: 10,
    });

    mockConfigManager.getConfig.mockReturnValue({
      teams: {
        frontend: {
          path: '/path/to/frontend',
          description: 'Frontend team',
        },
        backend: {
          path: '/path/to/backend',
          description: 'Backend team',
        },
      },
    });

    const mockProcess = {
      getMetrics: vi.fn().mockReturnValue({
        pid: 12345,
        status: 'idle',
        messagesProcessed: 10,
        lastUsed: Date.now(),
        uptime: 60000,
        queueLength: 0,
      }),
    };

    mockProcessPool.getProcess.mockReturnValue(mockProcess);

    mockNotificationQueue.getPending.mockReturnValue([
      { id: '1' },
      { id: '2' },
    ]);

    mockNotificationQueue.getHistory.mockReturnValue([
      { id: '1' },
      { id: '2' },
      { id: '3' },
    ]);

    mockNotificationQueue.getStats.mockReturnValue({
      total: 10,
      pending: 5,
      read: 3,
      expired: 2,
    });

    const result = await teamsGetStatus(
      {},
      mockProcessPool,
      mockNotificationQueue,
      mockConfigManager
    );

    expect(result.teams).toHaveLength(2);
    expect(result.teams[0].name).toBe('frontend');
    expect(result.teams[0].active).toBe(true);
    expect(result.teams[0].processMetrics).toBeDefined();
    expect(result.teams[0].notifications?.pending).toBe(2);
    expect(result.teams[0].notifications?.total).toBe(3);

    expect(result.pool.totalProcesses).toBe(2);
    expect(result.pool.maxProcesses).toBe(10);

    expect(result.queue).toEqual({
      total: 10,
      pending: 5,
      read: 3,
      expired: 2,
    });

    expect(result.timestamp).toBeDefined();
  });

  it('should return status for specific team only', async () => {
    mockProcessPool.getStatus.mockReturnValue({
      totalProcesses: 1,
      maxProcesses: 10,
    });

    mockConfigManager.getConfig.mockReturnValue({
      teams: {
        frontend: {
          path: '/path/to/frontend',
          description: 'Frontend team',
        },
        backend: {
          path: '/path/to/backend',
          description: 'Backend team',
        },
      },
    });

    mockProcessPool.getProcess.mockReturnValue(null);
    mockNotificationQueue.getPending.mockReturnValue([]);
    mockNotificationQueue.getHistory.mockReturnValue([]);
    mockNotificationQueue.getStats.mockReturnValue({
      total: 0,
      pending: 0,
      read: 0,
      expired: 0,
    });

    const result = await teamsGetStatus(
      { team: 'frontend' },
      mockProcessPool,
      mockNotificationQueue,
      mockConfigManager
    );

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].name).toBe('frontend');
  });

  it('should exclude notifications when includeNotifications is false', async () => {
    mockProcessPool.getStatus.mockReturnValue({
      totalProcesses: 0,
      maxProcesses: 10,
    });

    mockConfigManager.getConfig.mockReturnValue({
      teams: {
        frontend: {
          path: '/path/to/frontend',
          description: 'Frontend team',
        },
      },
    });

    mockProcessPool.getProcess.mockReturnValue(null);

    const result = await teamsGetStatus(
      { includeNotifications: false },
      mockProcessPool,
      mockNotificationQueue,
      mockConfigManager
    );

    expect(result.teams[0].notifications).toBeUndefined();
    expect(result.queue).toBeUndefined();
    expect(mockNotificationQueue.getPending).not.toHaveBeenCalled();
    expect(mockNotificationQueue.getStats).not.toHaveBeenCalled();
  });

  it('should mark team as inactive when process is stopped', async () => {
    mockProcessPool.getStatus.mockReturnValue({
      totalProcesses: 0,
      maxProcesses: 10,
    });

    mockConfigManager.getConfig.mockReturnValue({
      teams: {
        frontend: {
          path: '/path/to/frontend',
          description: 'Frontend team',
        },
      },
    });

    const mockProcess = {
      getMetrics: vi.fn().mockReturnValue({
        status: 'stopped',
      }),
    };

    mockProcessPool.getProcess.mockReturnValue(mockProcess);
    mockNotificationQueue.getPending.mockReturnValue([]);
    mockNotificationQueue.getHistory.mockReturnValue([]);
    mockNotificationQueue.getStats.mockReturnValue({
      total: 0,
      pending: 0,
      read: 0,
      expired: 0,
    });

    const result = await teamsGetStatus(
      {},
      mockProcessPool,
      mockNotificationQueue,
      mockConfigManager
    );

    expect(result.teams[0].active).toBe(false);
  });

  it('should mark team as inactive when no process exists', async () => {
    mockProcessPool.getStatus.mockReturnValue({
      totalProcesses: 0,
      maxProcesses: 10,
    });

    mockConfigManager.getConfig.mockReturnValue({
      teams: {
        frontend: {
          path: '/path/to/frontend',
          description: 'Frontend team',
        },
      },
    });

    mockProcessPool.getProcess.mockReturnValue(null);
    mockNotificationQueue.getPending.mockReturnValue([]);
    mockNotificationQueue.getHistory.mockReturnValue([]);
    mockNotificationQueue.getStats.mockReturnValue({
      total: 0,
      pending: 0,
      read: 0,
      expired: 0,
    });

    const result = await teamsGetStatus(
      {},
      mockProcessPool,
      mockNotificationQueue,
      mockConfigManager
    );

    expect(result.teams[0].active).toBe(false);
    expect(result.teams[0].processMetrics).toBeUndefined();
  });

  it('should propagate errors', async () => {
    const error = new Error('Config error');
    mockConfigManager.getConfig.mockImplementation(() => {
      throw error;
    });

    await expect(
      teamsGetStatus(
        {},
        mockProcessPool,
        mockNotificationQueue,
        mockConfigManager
      )
    ).rejects.toThrow('Config error');
  });
});
