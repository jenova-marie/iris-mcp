/**
 * Unit tests for custom error types
 */

import { describe, it, expect } from 'vitest';
import {
  IrisError,
  TeamNotFoundError,
  ProcessError,
  ProcessPoolLimitError,
  TimeoutError,
  ValidationError,
  ConfigurationError,
} from '../../../src/utils/errors.js';

describe('IrisError', () => {
  it('should create error with message, code, and status', () => {
    const error = new IrisError('Test error', 'TEST_CODE', 418);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(418);
    expect(error.name).toBe('IrisError');
  });

  it('should use default values when not provided', () => {
    const error = new IrisError('Test error');

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.statusCode).toBe(500);
  });

  it('should capture stack trace', () => {
    const error = new IrisError('Test error');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('IrisError');
  });
});

describe('TeamNotFoundError', () => {
  it('should create error with team name', () => {
    const error = new TeamNotFoundError('backend');

    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toContain('backend');
    expect(error.message).toContain('not found');
    expect(error.code).toBe('TEAM_NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('TeamNotFoundError');
  });
});

describe('ProcessError', () => {
  it('should create error with message and team name', () => {
    const error = new ProcessError('Failed to spawn', 'frontend');

    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toContain('frontend');
    expect(error.message).toContain('Failed to spawn');
    expect(error.code).toBe('PROCESS_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('ProcessError');
  });
});

describe('ProcessPoolLimitError', () => {
  it('should create error with max processes', () => {
    const error = new ProcessPoolLimitError(10);

    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toContain('10');
    expect(error.message).toContain('limit');
    expect(error.code).toBe('POOL_LIMIT_EXCEEDED');
    expect(error.statusCode).toBe(429);
    expect(error.name).toBe('ProcessPoolLimitError');
  });
});

describe('TimeoutError', () => {
  it('should create error with operation and timeout', () => {
    const error = new TimeoutError('Message send', 30000);

    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toContain('Message send');
    expect(error.message).toContain('30000');
    expect(error.code).toBe('TIMEOUT');
    expect(error.statusCode).toBe(408);
    expect(error.name).toBe('TimeoutError');
  });
});

describe('ValidationError', () => {
  it('should create error with message and optional field', () => {
    const error = new ValidationError('Invalid input', 'teamName');

    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toBe('Invalid input');
    expect(error.field).toBe('teamName');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('ValidationError');
  });

  it('should work without field parameter', () => {
    const error = new ValidationError('Invalid input');

    expect(error.message).toBe('Invalid input');
    expect(error.field).toBeUndefined();
  });
});

describe('ConfigurationError', () => {
  it('should create error with message', () => {
    const error = new ConfigurationError('Invalid config file');

    expect(error).toBeInstanceOf(IrisError);
    expect(error.message).toBe('Invalid config file');
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('ConfigurationError');
  });
});
