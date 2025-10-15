/**
 * Unit tests for validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateTeamName,
  validateMessage,
  validateTimeout,
  validatePath,
} from '../../../src/utils/validation.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('validateTeamName', () => {
  it('should accept valid team names', () => {
    expect(() => validateTeamName('frontend')).not.toThrow();
    expect(() => validateTeamName('backend')).not.toThrow();
    expect(() => validateTeamName('mobile-app')).not.toThrow();
    expect(() => validateTeamName('team_123')).not.toThrow();
  });

  it('should reject empty team names', () => {
    expect(() => validateTeamName('')).toThrow(ValidationError);
    expect(() => validateTeamName('   ')).toThrow(ValidationError);
  });

  it('should reject non-string team names', () => {
    expect(() => validateTeamName(null as any)).toThrow(ValidationError);
    expect(() => validateTeamName(undefined as any)).toThrow(ValidationError);
    expect(() => validateTeamName(123 as any)).toThrow(ValidationError);
  });

  it('should reject team names with path traversal characters', () => {
    expect(() => validateTeamName('../etc')).toThrow(ValidationError);
    expect(() => validateTeamName('team/name')).toThrow(ValidationError);
    expect(() => validateTeamName('team\\name')).toThrow(ValidationError);
    expect(() => validateTeamName('team..name')).toThrow(ValidationError);
  });
});

describe('validateMessage', () => {
  it('should accept valid messages', () => {
    expect(() => validateMessage('Hello world')).not.toThrow();
    expect(() => validateMessage('Breaking change: API v2 released')).not.toThrow();
    expect(() => validateMessage('12345')).not.toThrow();
  });

  it('should reject empty messages', () => {
    expect(() => validateMessage('')).toThrow(ValidationError);
    expect(() => validateMessage('   ')).toThrow(ValidationError);
  });

  it('should reject non-string messages', () => {
    expect(() => validateMessage(null as any)).toThrow(ValidationError);
    expect(() => validateMessage(undefined as any)).toThrow(ValidationError);
    expect(() => validateMessage(123 as any)).toThrow(ValidationError);
  });
});

describe('validateTimeout', () => {
  it('should accept valid positive timeouts', () => {
    expect(() => validateTimeout(1)).not.toThrow();
    expect(() => validateTimeout(1000)).not.toThrow();
    expect(() => validateTimeout(30000)).not.toThrow();
    expect(() => validateTimeout(600000)).not.toThrow();
    expect(() => validateTimeout(3600000)).not.toThrow(); // 1 hour max
  });

  it('should accept special timeout values', () => {
    expect(() => validateTimeout(-1)).not.toThrow(); // Async mode
    expect(() => validateTimeout(0)).not.toThrow(); // Wait indefinitely
  });

  it('should reject invalid negative timeouts', () => {
    expect(() => validateTimeout(-2)).toThrow(ValidationError);
    expect(() => validateTimeout(-1000)).toThrow(ValidationError);
  });

  it('should reject non-number timeouts', () => {
    expect(() => validateTimeout('1000' as any)).toThrow(ValidationError);
    expect(() => validateTimeout(null as any)).toThrow(ValidationError);
  });

  it('should reject timeouts exceeding 1 hour', () => {
    expect(() => validateTimeout(3600001)).toThrow(ValidationError);
    expect(() => validateTimeout(10000000)).toThrow(ValidationError);
  });
});

describe('validatePath', () => {
  it('should accept valid absolute paths', () => {
    expect(() => validatePath('/Users/test')).not.toThrow();
    expect(() => validatePath('/var/log')).not.toThrow();
    expect(() => validatePath('/home/user/projects')).not.toThrow();
  });

  it('should reject relative paths', () => {
    expect(() => validatePath('relative/path')).toThrow(ValidationError);
    expect(() => validatePath('./relative')).toThrow(ValidationError);
    expect(() => validatePath('../parent')).toThrow(ValidationError);
  });

  it('should reject empty paths', () => {
    expect(() => validatePath('')).toThrow(ValidationError);
    expect(() => validatePath('   ')).toThrow(ValidationError);
  });

  it('should reject non-string paths', () => {
    expect(() => validatePath(null as any)).toThrow(ValidationError);
    expect(() => validatePath(undefined as any)).toThrow(ValidationError);
  });
});
