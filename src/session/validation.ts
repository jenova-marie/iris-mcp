/**
 * Session Validation Utilities
 *
 * Security-focused validation for session management including
 * UUID validation and path traversal protection.
 */

import { existsSync, realpathSync } from "fs";
import { resolve, normalize } from "path";
import { randomUUID } from "crypto";
import { ConfigurationError, ValidationError } from "../utils/errors.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("session:validation");

/**
 * UUID v4 regex pattern
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where y is one of [8, 9, a, b]
 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate UUID v4 format
 */
export function validateUUID(uuid: string): boolean {
  return UUID_V4_REGEX.test(uuid);
}

/**
 * Validate session ID
 * Throws ValidationError if invalid
 */
export function validateSessionId(sessionId: string): void {
  if (!sessionId) {
    throw new ValidationError("Session ID cannot be empty");
  }

  if (!validateUUID(sessionId)) {
    throw new ValidationError(
      `Invalid session ID format. Expected UUID v4, got: ${sessionId}`,
    );
  }
}

/**
 * Enhanced project path validation with security checks
 */
export function validateSecureProjectPath(projectPath: string): void {
  if (!projectPath) {
    throw new ConfigurationError("Project path cannot be empty");
  }

  // Resolve to absolute path
  const resolved = resolve(projectPath);

  // Normalize the path to remove . and ..
  const normalized = normalize(projectPath);

  // Check for path traversal attempts
  if (resolved.includes("..") || normalized.includes("..")) {
    throw new ConfigurationError(
      `Path contains traversal attempts: ${projectPath}`,
    );
  }

  // Ensure path exists
  if (!existsSync(resolved)) {
    throw new ConfigurationError(
      `Project path does not exist: ${projectPath}`,
    );
  }

  // Check for symlinks (warn but allow)
  try {
    const realPath = realpathSync(resolved);
    if (realPath !== resolved) {
      logger.warn({
        original: projectPath,
        resolved,
        realPath,
        note: "Symlinks are allowed but may cause unexpected behavior",
      }, "Project path contains symlinks");
    }
  } catch (error) {
    logger.error({
      err: error instanceof Error ? error : new Error(String(error)),
      projectPath,
    }, "Failed to resolve real path");
  }

  // Check for suspicious path patterns
  const suspiciousPatterns = [
    "/etc/",
    "/usr/bin/",
    "/usr/sbin/",
    "/System/",
    "/Windows/",
    "/.ssh/",
    "/.gnupg/",
  ];

  const lowerPath = resolved.toLowerCase();
  for (const pattern of suspiciousPatterns) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      throw new ConfigurationError(
        `Project path appears to be in a system directory: ${projectPath}`,
      );
    }
  }
}

/**
 * Validate team name for safety
 */
export function validateTeamName(teamName: string): void {
  if (!teamName) {
    throw new ValidationError("Team name cannot be empty");
  }

  // Check length
  if (teamName.length > 100) {
    throw new ValidationError("Team name exceeds maximum length of 100");
  }

  // Check for dangerous characters
  const dangerousChars = ["../", "..\\", "\0", "|", "&", ";", "$", "`"];
  for (const char of dangerousChars) {
    if (teamName.includes(char)) {
      throw new ValidationError(
        `Team name contains dangerous character: ${char}`,
      );
    }
  }

  // Allow alphanumeric, dash, underscore, and basic punctuation
  const validPattern = /^[a-zA-Z0-9_\-@.]+$/;
  if (!validPattern.test(teamName)) {
    throw new ValidationError(
      `Team name contains invalid characters. Allowed: alphanumeric, dash, underscore, @, and period`,
    );
  }
}

/**
 * Generate secure random UUID v4
 */
export function generateSecureUUID(): string {
  const uuid = randomUUID();

  // Double-check the generated UUID is valid
  if (!validateUUID(uuid)) {
    throw new Error("Failed to generate valid UUID");
  }

  return uuid;
}

/**
 * Sanitize file path for safe storage
 */
export function sanitizePath(path: string): string {
  // Remove null bytes
  let sanitized = path.replace(/\0/g, "");

  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, "");

  // Normalize multiple slashes
  sanitized = sanitized.replace(/\/+/g, "/");

  // Remove trailing slashes
  sanitized = sanitized.replace(/\/$/, "");

  return sanitized;
}