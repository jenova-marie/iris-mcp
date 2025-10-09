/**
 * Unit tests for teams_notify tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teamsNotify } from '../../../src/tools/teams-notify.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('teamsNotify', () => {
  let mockNotificationQueue: any;

  beforeEach(() => {
    mockNotificationQueue = {
      add: vi.fn(),
    };
  });

  it('should add notification to queue', async () => {
    const mockNotification = {
      id: 'test-notification-id',
      fromTeam: 'backend',
      toTeam: 'frontend',
      message: 'New API endpoint available',
      status: 'pending' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };

    mockNotificationQueue.add.mockReturnValue(mockNotification);

    const result = await teamsNotify(
      {
        fromTeam: 'backend',
        toTeam: 'frontend',
        message: 'New API endpoint available',
      },
      mockNotificationQueue
    );

    expect(mockNotificationQueue.add).toHaveBeenCalledWith(
      'frontend',
      'New API endpoint available',
      'backend',
      30
    );

    expect(result.notificationId).toBe('test-notification-id');
    expect(result.from).toBe('backend');
    expect(result.to).toBe('frontend');
    expect(result.message).toBe('New API endpoint available');
    expect(result.expiresAt).toBe(mockNotification.expiresAt);
    expect(result.timestamp).toBe(mockNotification.createdAt);
  });

  it('should work without fromTeam', async () => {
    const mockNotification = {
      id: 'test-id',
      toTeam: 'frontend',
      message: 'Test',
      status: 'pending' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };

    mockNotificationQueue.add.mockReturnValue(mockNotification);

    const result = await teamsNotify(
      {
        toTeam: 'frontend',
        message: 'Test',
      },
      mockNotificationQueue
    );

    expect(mockNotificationQueue.add).toHaveBeenCalledWith(
      'frontend',
      'Test',
      undefined,
      30
    );

    expect(result.from).toBeUndefined();
  });

  it('should use custom TTL when provided', async () => {
    const mockNotification = {
      id: 'test-id',
      toTeam: 'frontend',
      message: 'Test',
      status: 'pending' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };

    mockNotificationQueue.add.mockReturnValue(mockNotification);

    await teamsNotify(
      {
        toTeam: 'frontend',
        message: 'Test',
        ttlDays: 7,
      },
      mockNotificationQueue
    );

    expect(mockNotificationQueue.add).toHaveBeenCalledWith(
      'frontend',
      'Test',
      undefined,
      7
    );
  });

  it('should use default TTL of 30 days', async () => {
    const mockNotification = {
      id: 'test-id',
      toTeam: 'frontend',
      message: 'Test',
      status: 'pending' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };

    mockNotificationQueue.add.mockReturnValue(mockNotification);

    await teamsNotify(
      {
        toTeam: 'frontend',
        message: 'Test',
      },
      mockNotificationQueue
    );

    expect(mockNotificationQueue.add).toHaveBeenCalledWith(
      'frontend',
      'Test',
      undefined,
      30
    );
  });

  it('should throw ValidationError for invalid toTeam', async () => {
    await expect(
      teamsNotify(
        {
          toTeam: '../etc',
          message: 'Test',
        },
        mockNotificationQueue
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError for empty message', async () => {
    await expect(
      teamsNotify(
        {
          toTeam: 'frontend',
          message: '',
        },
        mockNotificationQueue
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should propagate errors from notification queue', async () => {
    const error = new Error('Database error');
    mockNotificationQueue.add.mockImplementation(() => {
      throw error;
    });

    await expect(
      teamsNotify(
        {
          toTeam: 'frontend',
          message: 'Test',
        },
        mockNotificationQueue
      )
    ).rejects.toThrow('Database error');
  });
});
