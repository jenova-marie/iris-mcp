/**
 * Unit tests for teams_ask tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teamsAsk } from '../../../src/tools/teams-ask.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('teamsAsk', () => {
  let mockProcessPool: any;

  beforeEach(() => {
    mockProcessPool = {
      sendMessage: vi.fn(),
    };
  });

  it('should send question to team and return response', async () => {
    mockProcessPool.sendMessage.mockResolvedValue('This is the response');

    const result = await teamsAsk(
      {
        team: 'backend',
        question: 'What database do you use?',
      },
      mockProcessPool
    );

    expect(mockProcessPool.sendMessage).toHaveBeenCalledWith(
      'backend',
      'What database do you use?',
      30000,
      null // fromTeam defaults to null when not provided
    );

    expect(result.team).toBe('backend');
    expect(result.question).toBe('What database do you use?');
    expect(result.response).toBe('This is the response');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should use custom timeout when provided', async () => {
    mockProcessPool.sendMessage.mockResolvedValue('Response');

    await teamsAsk(
      {
        team: 'frontend',
        question: 'What framework do you use?',
        timeout: 60000,
      },
      mockProcessPool
    );

    expect(mockProcessPool.sendMessage).toHaveBeenCalledWith(
      'frontend',
      'What framework do you use?',
      60000,
      null // fromTeam defaults to null when not provided
    );
  });

  it('should throw ValidationError for invalid team name', async () => {
    await expect(
      teamsAsk(
        {
          team: '../etc',
          question: 'Test',
        },
        mockProcessPool
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError for empty question', async () => {
    await expect(
      teamsAsk(
        {
          team: 'backend',
          question: '',
        },
        mockProcessPool
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError for invalid timeout', async () => {
    await expect(
      teamsAsk(
        {
          team: 'backend',
          question: 'Test',
          timeout: -1000,
        },
        mockProcessPool
      )
    ).rejects.toThrow(ValidationError);
  });

  it('should propagate errors from process pool', async () => {
    const error = new Error('Team not found');
    mockProcessPool.sendMessage.mockRejectedValue(error);

    await expect(
      teamsAsk(
        {
          team: 'backend',
          question: 'Test',
        },
        mockProcessPool
      )
    ).rejects.toThrow('Team not found');
  });

  it('should measure response duration', async () => {
    mockProcessPool.sendMessage.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('Response'), 100);
      });
    });

    const result = await teamsAsk(
      {
        team: 'backend',
        question: 'Test',
      },
      mockProcessPool
    );

    expect(result.duration).toBeGreaterThanOrEqual(100);
  });
});
