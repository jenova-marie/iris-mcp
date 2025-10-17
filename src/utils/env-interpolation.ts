/**
 * Environment Variable Interpolation
 * Supports ${VAR_NAME} and ${VAR_NAME:-default} syntax
 *
 * Matches Wonder Logger's environment variable interpolation pattern
 */

import { getChildLogger } from './logger.js';

const logger = getChildLogger('config:env-interpolation');

/**
 * Interpolate environment variables in a string value
 *
 * Supports two syntaxes:
 * - ${VAR_NAME}          - Required variable (throws if not set)
 * - ${VAR_NAME:-default} - Optional variable with default value
 *
 * @param value - String value to interpolate
 * @param throwOnMissing - If true, throw error for required vars that are undefined (default: true)
 * @returns Interpolated string
 *
 * @example
 * ```typescript
 * // Required variable
 * interpolateString("${HOME}/projects")  // "/Users/jenova/projects"
 * interpolateString("${MISSING}")        // throws Error
 *
 * // Optional variable with default
 * interpolateString("${PORT:-3000}")     // "3000" (if PORT not set)
 * interpolateString("${NODE_ENV:-development}")  // "development" (if NODE_ENV not set)
 * ```
 */
export function interpolateString(value: string, throwOnMissing = true): string {
  // Pattern matches ${VAR_NAME} or ${VAR_NAME:-default}
  const pattern = /\$\{([^}:]+)(?::-([ -~]*))?\}/g;

  return value.replace(pattern, (match, varName, defaultValue) => {
    const envValue = process.env[varName];

    // If env var is set, use it
    if (envValue !== undefined) {
      return envValue;
    }

    // If default is provided, use it
    if (defaultValue !== undefined) {
      logger.debug({ varName, defaultValue }, 'Using default value for env var');
      return defaultValue;
    }

    // Required variable is missing
    if (throwOnMissing) {
      throw new Error(
        `Environment variable "${varName}" is required but not set. ` +
        `Set it or provide a default value using \${${varName}:-default} syntax.`
      );
    }

    // Don't throw, return original match
    logger.warn({ varName }, 'Environment variable not set, keeping original value');
    return match;
  });
}

/**
 * Recursively interpolate environment variables in an object
 *
 * Walks the object tree and interpolates any string values containing ${VAR} syntax.
 * Arrays and nested objects are handled recursively.
 *
 * @param obj - Object to interpolate
 * @param throwOnMissing - If true, throw error for required vars that are undefined (default: true)
 * @returns New object with interpolated values (does not mutate input)
 *
 * @example
 * ```typescript
 * const config = {
 *   port: "${PORT:-3000}",
 *   database: {
 *     host: "${DB_HOST}",
 *     name: "${DB_NAME:-iris}"
 *   }
 * };
 *
 * const interpolated = interpolateObject(config);
 * // { port: "3000", database: { host: "localhost", name: "iris" } }
 * ```
 */
export function interpolateObject<T>(obj: T, throwOnMissing = true): T {
  if (typeof obj === 'string') {
    return interpolateString(obj, throwOnMissing) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => interpolateObject(item, throwOnMissing)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value, throwOnMissing);
    }
    return result as T;
  }

  // Primitives (number, boolean, null) pass through
  return obj;
}
