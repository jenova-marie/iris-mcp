/**
 * Unit tests for logger utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../../src/utils/logger.js';

describe('Logger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let logger: Logger;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger = new Logger('test-context');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete process.env.DEBUG;
    delete process.env.LOG_LEVEL;
  });

  describe('info', () => {
    it('should log info messages to stderr', () => {
      logger.info('Test message');

      expect(consoleErrorSpy).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.level).toBe('info');
      expect(loggedData.context).toBe('test-context');
      expect(loggedData.message).toBe('Test message');
      expect(loggedData.timestamp).toBeDefined();
    });

    it('should include metadata in log entry', () => {
      logger.info('Test message', { userId: 123, action: 'login' });

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.userId).toBe(123);
      expect(loggedData.action).toBe('login');
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.warn('Warning message');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.level).toBe('warn');
      expect(loggedData.message).toBe('Warning message');
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      logger.error('Error occurred');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.level).toBe('error');
      expect(loggedData.message).toBe('Error occurred');
    });

    it('should include error details when provided', () => {
      const error = new Error('Something went wrong');
      logger.error('Error occurred', error);

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.error).toBe('Something went wrong');
      expect(loggedData.stack).toBeDefined();
    });

    it('should handle non-Error objects', () => {
      logger.error('Error occurred', 'string error');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.error).toBe('string error');
    });
  });

  describe('debug', () => {
    it('should not log debug messages by default', () => {
      logger.debug('Debug message');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages when DEBUG env is set', () => {
      process.env.DEBUG = 'true';
      logger.debug('Debug message');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.level).toBe('debug');
      expect(loggedData.message).toBe('Debug message');
    });

    it('should log debug messages when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';
      logger.debug('Debug message');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.level).toBe('debug');
      expect(loggedData.message).toBe('Debug message');
    });
  });

  describe('timestamp format', () => {
    it('should use ISO 8601 format', () => {
      logger.info('Test');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('context', () => {
    it('should use provided context', () => {
      const contextLogger = new Logger('my-module');
      contextLogger.info('Test');

      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(loggedData.context).toBe('my-module');
    });
  });

  describe('JSON format', () => {
    it('should output valid JSON', () => {
      logger.info('Test', { nested: { data: 'value' } });

      expect(() => {
        JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      }).not.toThrow();
    });
  });
});
