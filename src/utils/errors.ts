/**
 * Iris MCP - Custom Error Types
 * Specialized error classes for better error handling
 */

export class IrisError extends Error {
  constructor(
    message: string,
    public code: string = 'UNKNOWN_ERROR',
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'IrisError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class TeamNotFoundError extends IrisError {
  constructor(teamName: string) {
    super(
      `Team "${teamName}" not found in configuration`,
      'TEAM_NOT_FOUND',
      404
    );
    this.name = 'TeamNotFoundError';
  }
}

export class ProcessError extends IrisError {
  constructor(message: string, teamName: string) {
    super(
      `Process error for team "${teamName}": ${message}`,
      'PROCESS_ERROR',
      500
    );
    this.name = 'ProcessError';
  }
}

export class ProcessPoolLimitError extends IrisError {
  constructor(maxProcesses: number) {
    super(
      `Process pool limit reached (max: ${maxProcesses})`,
      'POOL_LIMIT_EXCEEDED',
      429
    );
    this.name = 'ProcessPoolLimitError';
  }
}

export class TimeoutError extends IrisError {
  constructor(operation: string, timeout: number) {
    super(
      `${operation} timed out after ${timeout}ms`,
      'TIMEOUT',
      408
    );
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends IrisError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends IrisError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}
