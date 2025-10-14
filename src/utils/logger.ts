/**
 * Iris MCP - Wonder Logger Integration
 *
 * Provides unified logging with OpenTelemetry integration via Wonder Logger.
 * Replaces the previous custom Logger class with Pino-based structured logging.
 *
 * Configuration loaded from wonder-logger.yaml in project root.
 *
 * @see wonder-logger.yaml for configuration
 * @see CONTEXT_NAME_MAPPING.md for standardized context names
 */

import {
  createLoggerFromConfig,
  createTelemetryFromConfig,
  loadConfig,
  type TelemetrySDK
} from '@recoverysky/wonder-logger';

// Pino Logger type - will be available once wonder-logger is initialized
type PinoLogger = any;

/**
 * Global logger and telemetry instances
 * Initialized once at application startup
 */
let globalLogger: PinoLogger | null = null;
let globalTelemetry: TelemetrySDK | null = null;

/**
 * Initialize Wonder Logger and OpenTelemetry from config
 *
 * This should be called once at application startup (e.g., in index.ts or iris.ts)
 * before any logging occurs. Subsequent calls return the existing instances.
 *
 * @param configPath - Optional path to wonder-logger.yaml (defaults to ./wonder-logger.yaml)
 * @returns Object containing logger and telemetry SDK instances
 *
 * @example
 * ```typescript
 * // In src/index.ts or src/iris.ts
 * import { initializeObservability } from './utils/logger.js';
 *
 * initializeObservability();
 * ```
 */
export function initializeObservability(configPath?: string): {
  logger: PinoLogger;
  telemetry: TelemetrySDK | null;
} {
  if (globalLogger) {
    return { logger: globalLogger, telemetry: globalTelemetry };
  }

  try {
    // Load config first to check if OTEL is enabled
    const config = loadConfig({
      configPath: configPath || './wonder-logger.yaml',
      required: true
    });

    // Initialize logger from config
    globalLogger = createLoggerFromConfig({
      configPath: configPath || './wonder-logger.yaml',
      required: true,
    });

    // Only initialize OpenTelemetry if enabled in config
    if (config?.otel?.enabled) {
      try {
        globalTelemetry = createTelemetryFromConfig({
          configPath: configPath || './wonder-logger.yaml',
          required: false, // OTEL is optional
        });

        globalLogger.info({
          message: 'Observability initialized successfully',
          otelEnabled: true
        });
      } catch (otelError) {
        // OTEL initialization failed, but logger works
        globalLogger.warn({
          err: otelError instanceof Error ? otelError : new Error(String(otelError))
        }, 'OpenTelemetry initialization failed, continuing with logging only');
        globalTelemetry = null;
      }
    } else {
      // OTEL is disabled in config
      globalLogger.info('OpenTelemetry disabled in configuration');
      globalTelemetry = null;
    }

    return { logger: globalLogger, telemetry: globalTelemetry };
  } catch (error) {
    // Fallback to console.error if logger initialization completely fails
    console.error('FATAL: Failed to initialize Wonder Logger:', error);
    throw error;
  }
}

/**
 * Get child logger with hierarchical context
 *
 * Replaces: `new Logger('context')`
 *
 * Uses standardized colon-separated namespace convention:
 * - iris:core, iris:mcp, iris:web, iris:cli
 * - pool:manager, pool:process:${teamName}
 * - session:manager, session:store, session:metrics, session:validation
 * - cache:manager, cache:entry, cache:session
 * - action:tell, action:wake, action:sleep, etc.
 * - config:teams
 * - dashboard:server, dashboard:state, dashboard:routes:*
 * - cli:install, cli:uninstall, cli:add-team
 *
 * @param context - Hierarchical context identifier (e.g., 'pool:manager', 'action:tell')
 * @returns Pino logger instance with context binding
 *
 * @example
 * ```typescript
 * // Static context
 * const logger = getChildLogger('action:tell');
 * logger.info({ toTeam, fromTeam }, 'Sending message');
 *
 * // Dynamic context with team name
 * const logger = getChildLogger(`pool:process:${teamName}`);
 * logger.error({ err: error }, 'Process failed');
 * ```
 */
export function getChildLogger(context: string): PinoLogger {
  if (!globalLogger) {
    // Auto-initialize if not done yet
    initializeObservability();
  }

  return globalLogger!.child({ context });
}

/**
 * Get base logger instance
 *
 * Returns the root logger without any context binding.
 * Prefer `getChildLogger(context)` for most use cases.
 *
 * @returns Root Pino logger instance
 */
export function getLogger(): PinoLogger {
  if (!globalLogger) {
    initializeObservability();
  }

  return globalLogger!;
}

/**
 * Get OpenTelemetry SDK instance
 *
 * Returns null if OTEL initialization failed or was disabled in config.
 * Use this to access tracer, meter, or perform graceful shutdown.
 *
 * @returns TelemetrySDK instance or null
 *
 * @example
 * ```typescript
 * const telemetry = getTelemetry();
 * if (telemetry) {
 *   const tracer = telemetry.getTracer();
 *   // Use tracer for custom spans
 * }
 * ```
 */
export function getTelemetry(): TelemetrySDK | null {
  return globalTelemetry;
}

/**
 * Gracefully shutdown observability stack
 *
 * Flushes pending logs and telemetry data before shutdown.
 * Call this in process exit handlers.
 *
 * @example
 * ```typescript
 * process.on('SIGTERM', async () => {
 *   await shutdownObservability();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdownObservability(): Promise<void> {
  const logger = globalLogger;

  if (logger) {
    logger.info('Shutting down observability stack');
  }

  // Shutdown OTEL first (flushes traces/metrics)
  if (globalTelemetry) {
    try {
      await globalTelemetry.shutdown();
      if (logger) {
        logger.info('OpenTelemetry shutdown complete');
      }
    } catch (error) {
      if (logger) {
        logger.error({ err: error instanceof Error ? error : new Error(String(error)) },
          'Failed to shutdown OpenTelemetry');
      }
    }
  }

  // Flush logger (writes pending logs)
  if (logger) {
    // Pino doesn't have an async flush, but calling final() helps
    logger.info('Logger shutdown complete');
  }

  globalLogger = null;
  globalTelemetry = null;
}

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Pino log level type
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
