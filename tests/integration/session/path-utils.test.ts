/**
 * Integration tests for Path Utilities
 * Tests core path operations for session file management
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import {
  escapeProjectPath,
  getClaudeProjectsDir,
  getTeamClaudeDir,
  getSessionFilePath,
  sessionFileExists,
  listTeamSessions,
  validateProjectPath,
} from "../../../src/session/path-utils.js";

describe("Path Utilities Integration", () => {
  const testProjectPath = "/tmp/test-project";

  beforeEach(() => {
    // Create test project directory
    mkdirSync(testProjectPath, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (testProjectPath.startsWith("/tmp/")) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  describe("Path escaping", () => {
    it("should escape absolute path correctly", () => {
      const escaped = escapeProjectPath("/Users/jenova/projects/foo");
      expect(escaped).toBe("-Users-jenova-projects-foo");
    });

    it("should escape path with single directory", () => {
      const escaped = escapeProjectPath("/tmp");
      expect(escaped).toBe("-tmp");
    });

    it("should throw on relative path", () => {
      expect(() => escapeProjectPath("relative/path")).toThrow(
        "Path must be absolute",
      );
    });
  });

  describe("Claude directory paths", () => {
    it("should return valid projects directory path", () => {
      const projectsDir = getClaudeProjectsDir();
      expect(projectsDir).toContain(".claude");
      expect(projectsDir).toContain("projects");
    });

    it("should construct team Claude directory", () => {
      const teamDir = getTeamClaudeDir("/Users/jenova/projects/foo");
      expect(teamDir).toContain("-Users-jenova-projects-foo");
    });

    it("should construct session file path", () => {
      const sessionPath = getSessionFilePath(
        "/Users/jenova/projects/foo",
        "abc-123",
      );
      expect(sessionPath).toContain("-Users-jenova-projects-foo");
      expect(sessionPath).toContain("abc-123.jsonl");
    });
  });

  describe("Session file operations", () => {
    it("should detect non-existent session file", () => {
      const exists = sessionFileExists(testProjectPath, "non-existent-session");
      expect(exists).toBe(false);
    });

    it("should return empty array for project with no sessions", () => {
      const sessions = listTeamSessions(testProjectPath);
      expect(sessions).toEqual([]);
    });
  });

  describe("Project path validation", () => {
    it("should validate existing directory", () => {
      expect(() => validateProjectPath(testProjectPath)).not.toThrow();
    });

    it("should reject non-existent path", () => {
      expect(() => validateProjectPath("/tmp/does-not-exist-xyz")).toThrow(
        "does not exist",
      );
    });

    it("should reject relative path", () => {
      expect(() => validateProjectPath("relative/path")).toThrow(
        "must be absolute",
      );
    });

    it("should reject path traversal", () => {
      expect(() => validateProjectPath("/tmp/../etc")).toThrow(
        "invalid pattern",
      );
    });
  });
});
