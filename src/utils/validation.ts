/**
 * Iris MCP - Input Validation Helpers
 * Common validation utilities
 */

import { ValidationError } from './errors.js';

export function validateTeamName(teamName: string): void {
  if (!teamName || typeof teamName !== 'string') {
    throw new ValidationError('Team name is required and must be a string', 'teamName');
  }

  if (teamName.trim().length === 0) {
    throw new ValidationError('Team name cannot be empty', 'teamName');
  }

  // Prevent path traversal attacks
  if (teamName.includes('/') || teamName.includes('\\') || teamName.includes('..')) {
    throw new ValidationError('Team name contains invalid characters', 'teamName');
  }
}

export function validateMessage(message: string): void {
  if (!message || typeof message !== 'string') {
    throw new ValidationError('Message is required and must be a string', 'message');
  }

  if (message.trim().length === 0) {
    throw new ValidationError('Message cannot be empty', 'message');
  }
}

export function validateTimeout(timeout: number): void {
  if (typeof timeout !== 'number' || timeout <= 0) {
    throw new ValidationError('Timeout must be a positive number', 'timeout');
  }

  // Max timeout: 10 minutes
  if (timeout > 600000) {
    throw new ValidationError('Timeout cannot exceed 10 minutes (600000ms)', 'timeout');
  }
}

export function validatePath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new ValidationError('Path is required and must be a string', 'path');
  }

  if (!path.startsWith('/')) {
    throw new ValidationError('Path must be an absolute path', 'path');
  }
}
