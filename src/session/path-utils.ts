/**
 * Path Utilities for Session Management
 *
 * Handles path escaping for Claude Code session directories and filesystem
 * verification for session files.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Escape project path for Claude Code directory naming
 *
 * Claude stores sessions in ~/.claude/projects/{escaped-path}/{session-id}.jsonl
 * The escaping algorithm removes the leading slash and replaces remaining slashes with hyphens.
 *
 * @param absolutePath - Full absolute path to project directory
 * @returns Escaped directory name for Claude projects folder
 *
 * @example
 * escapeProjectPath('/Users/jenova/projects/foo') // => '-Users-jenova-projects-foo'
 * escapeProjectPath('/tmp/test') // => '-tmp-test'
 */
export function escapeProjectPath(absolutePath: string): string {
  if (!absolutePath.startsWith("/")) {
    throw new Error(
      `Path must be absolute (start with /): ${absolutePath}`,
    );
  }

  // Remove leading slash, replace remaining slashes with hyphens
  return "-" + absolutePath.slice(1).replace(/\//g, "-");
}

/**
 * Get the full path to Claude's projects directory
 *
 * @returns Path to ~/.claude/projects/
 */
export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Get the full path to a team's Claude project directory
 *
 * @param projectPath - Absolute path to the project
 * @returns Full path to ~/.claude/projects/{escaped-path}/
 *
 * @example
 * getTeamClaudeDir('/Users/jenova/projects/foo')
 * // => '/Users/jenova/.claude/projects/-Users-jenova-projects-foo'
 */
export function getTeamClaudeDir(projectPath: string): string {
  const escaped = escapeProjectPath(projectPath);
  return path.join(getClaudeProjectsDir(), escaped);
}

/**
 * Get the full path to a specific session file
 *
 * @param projectPath - Absolute path to the project
 * @param sessionId - UUID of the session
 * @returns Full path to session JSONL file
 *
 * @example
 * getSessionFilePath('/Users/jenova/projects/foo', 'a1b2c3d4-...')
 * // => '/Users/jenova/.claude/projects/-Users-jenova-projects-foo/a1b2c3d4-....jsonl'
 */
export function getSessionFilePath(
  projectPath: string,
  sessionId: string,
): string {
  const teamDir = getTeamClaudeDir(projectPath);
  return path.join(teamDir, `${sessionId}.jsonl`);
}

/**
 * Check if a session file exists on the filesystem
 *
 * @param projectPath - Absolute path to the project
 * @param sessionId - UUID of the session
 * @returns True if session file exists
 */
export function sessionFileExists(
  projectPath: string,
  sessionId: string,
): boolean {
  const filePath = getSessionFilePath(projectPath, sessionId);
  return fs.existsSync(filePath);
}

/**
 * List all session files for a team's project
 *
 * @param projectPath - Absolute path to the project
 * @returns Array of session IDs (UUIDs without .jsonl extension)
 */
export function listTeamSessions(projectPath: string): string[] {
  const teamDir = getTeamClaudeDir(projectPath);

  if (!fs.existsSync(teamDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(teamDir);
    return files
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => file.replace(".jsonl", ""));
  } catch (error) {
    // Directory might not be readable
    return [];
  }
}

/**
 * Validate that a project path is safe and accessible
 *
 * @param projectPath - Path to validate
 * @throws Error if path is invalid or inaccessible
 */
export function validateProjectPath(projectPath: string): void {
  // Must be absolute
  if (!path.isAbsolute(projectPath)) {
    throw new Error(`Project path must be absolute: ${projectPath}`);
  }

  // Must not contain path traversal attempts
  if (projectPath.includes("..")) {
    throw new Error(
      `Project path contains invalid pattern '..': ${projectPath}`,
    );
  }

  // Must exist
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  // Must be a directory
  const stats = fs.statSync(projectPath);
  if (!stats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }

  // Must be readable
  try {
    fs.accessSync(projectPath, fs.constants.R_OK);
  } catch {
    throw new Error(`Project path is not readable: ${projectPath}`);
  }
}
