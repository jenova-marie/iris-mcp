/**
 * Unit tests for teams_send_message tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teamsSendMessage } from '../../../src/tools/teams-send-message.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('teamsSendMessage', () => {
  let mockProcessPool: any;

  beforeEach(() => {
    mockProcessPool = {
      sendMessage: vi.fn(),
    };
  });

  it('should send message and wait for response by default', async () => {
    mockProcessPool.sendMessage.mockResolvedValue('Acknowledged');

    const result = await teamsSendMessage(
      {
        fromTeam: 'frontend',
        toTeam: 'backend',
        message: 'Breaking change coming',
      },
      mockProcessPool
    );

    expect(mockProcessPool.sendMessage).toHaveBeenCalledWith(
      'backend',
      'Breaking change coming',
      30000,
      'frontend' // fromTeam parameter
    );

    expect(result.from).toBe('frontend');
    expect(result.to).toBe('backend');
    expect(result.message).toBe('Breaking change coming');
    expect(result.response).toBe('Acknowledged');
    expect(result.async).toBe(false);
    expect(result.duration).toBeDefined();
  });

  it('should send message without waiting when waitForResponse is false', async () => {
    mockProcessPool.sendMessage.mockResolvedValue('Response');

    const result = await teamsSendMessage(
      {
        toTeam: 'backend',
        message: 'Fire and forget',
        waitForResponse: false,
      },
      mockProcessPool
    );

    expect(result.to).toBe('backend');
    expect(result.message).toBe('Fire and forget');
    expect(result.response).toBeUndefined();
    expect(result.async).toBe(true);
    expect(result.duration).toBeUndefined();
  });

  it('should work without fromTeam', async () => {
    mockProcessPool.sendMessage.mockResolvedValue('Response');

    const result = await teamsSendMessage(
      {
        toTeam: 'backend',
        message: 'Test',
      },
      mockProcessPool
    );

    expect(result.from).toBeUndefined();
    expect(result.to).toBe('backend');
  });

  it('should use custom timeout when provided', async () => {
    mockProcessPool.sendMessage.mockResolvedValue('Response');

    await teamsSendMessage(
      {
        toTeam: 'backend',
        message: 'Test',
        timeout: 60000,
      },
      mockProcessPool
    );

    expect(mockProcessPool.sendMessage).toHaveBeenCalledWith(
      'backend',
      'Test',
      60000,
      null // fromTeam defaults to null when not provided
    );
  });

  it('should throw ValidationError for invalid toTeam', async () => {
    await expect(
      teamsSendMessage(
        {
          toTeam: '../etc',
          message: 'Test',
        },
        mockProcessPool
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError for empty message', async () => {
    await expect(
      teamsSendMessage(
        {
          toTeam: 'backend',
          message: '',
        },
        mockProcessPool
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should propagate errors from process pool when waiting for response', async () => {
    const error = new Error('Team not found');
    mockProcessPool.sendMessage.mockRejectedValue(error);

    await expect(
      teamsSendMessage(
        {
          toTeam: 'backend',
          message: 'Test',
          waitForResponse: true,
        },
        mockProcessPool
      )
    ).rejects.toThrow('Team not found');
  });

  it('should not propagate errors when not waiting for response', async () => {
    const error = new Error('Team not found');
    mockProcessPool.sendMessage.mockRejectedValue(error);

    const result = await teamsSendMessage(
      {
        toTeam: 'backend',
        message: 'Test',
        waitForResponse: false,
      },
      mockProcessPool
    );

    // Should return successfully even though sending fails in background
    expect(result.async).toBe(true);
  });

  it('should measure response duration when waiting', async () => {
    mockProcessPool.sendMessage.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('Response'), 100);
      });
    });

    const result = await teamsSendMessage(
      {
        toTeam: 'backend',
        message: 'Test',
        waitForResponse: true,
      },
      mockProcessPool
    );

    expect(result.duration).toBeGreaterThanOrEqual(100);
  });
});
