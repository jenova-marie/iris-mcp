/**
 * Iris MCP - Logger Utility
 * Structured JSON logging to stderr (MCP uses stdout for protocol)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  timestamp: string;
  [key: string]: any;
}

export class Logger {
  constructor(private context: string) {}

  debug(message: string, meta?: any): void {
    if (process.env.DEBUG || process.env.LOG_LEVEL === 'debug') {
      this.log('debug', message, meta);
    }
  }

  info(message: string, meta?: any): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log('warn', message, meta);
  }

  error(message: string, error?: any): void {
    const errorMeta = error
      ? this.formatError(error)
      : undefined;

    this.log('error', message, errorMeta);
  }

  private formatError(error: any): any {
    if (!error) return undefined;

    // In DEBUG mode, include everything
    const isDebug = process.env.DEBUG || process.env.LOG_LEVEL === 'debug';

    if (error instanceof Error) {
      return {
        error: error.message,
        stack: isDebug ? error.stack : error.stack?.split('\n').slice(0, 3).join('\n'),
        name: error.name,
        ...(isDebug && error.cause ? { cause: this.formatError(error.cause) } : {}),
      };
    }

    // Plain object - return as-is in DEBUG, stringify otherwise
    if (typeof error === 'object') {
      if (isDebug) {
        return { error };
      }
      return { error: JSON.stringify(error).substring(0, 500) };
    }

    return { error: String(error) };
  }

  private log(level: LogLevel, message: string, meta?: any): void {
    const entry: LogEntry = {
      level,
      context: this.context,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    // Log to stderr (stdout is reserved for MCP protocol)
    console.error(JSON.stringify(entry));
  }
}
