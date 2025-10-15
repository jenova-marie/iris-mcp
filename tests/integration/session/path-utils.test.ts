/**
 * Integration tests for Path Utilities
 * Tests core path operations for session file management
 *
 * NEW ARCHITECTURE CHANGES:
 * - Path utilities remain unchanged (file system operations)
 * - Session file naming conventions stay the same
 * - Team directory structure unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
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
    // Clean up any existing test directory first
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
    // Create fresh test project directory
    mkdirSync(testProjectPath, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (testProjectPath.startsWith("/tmp/") && existsSync(testProjectPath)) {
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

    it("should escape path with special characters", () => {
      const escaped = escapeProjectPath("/Users/test-project/my-app");
      expect(escaped).toBe("-Users-test-project-my-app");
    });

    it("should throw on relative path", () => {
      expect(() => escapeProjectPath("relative/path")).toThrow(
        "Path must be absolute",
      );
    });

    it("should throw on empty path", () => {
      expect(() => escapeProjectPath("")).toThrow();
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

    it("should handle multiple session files for same project", () => {
      const session1 = getSessionFilePath(
        "/Users/jenova/projects/foo",
        "session-1",
      );
      const session2 = getSessionFilePath(
        "/Users/jenova/projects/foo",
        "session-2",
      );

      expect(session1).not.toBe(session2);
      expect(session1).toContain("session-1.jsonl");
      expect(session2).toContain("session-2.jsonl");
    });
  });

  describe("Session file operations", () => {
    // Use a unique test path to avoid conflicts with global Claude directory
    const uniqueTestPath = "/tmp/iris-test-unique-path-12345";

    afterEach(() => {
      // Clean up any files created in ~/.claude/projects/ for this test
      const teamDir = getTeamClaudeDir(uniqueTestPath);
      if (existsSync(teamDir)) {
        rmSync(teamDir, { recursive: true, force: true });
      }
    });

    it("should detect non-existent session file", () => {
      const exists = sessionFileExists(uniqueTestPath, "non-existent-session");
      expect(exists).toBe(false);
    });

    it("should return empty array for project with no sessions", () => {
      // Use a path that definitely has no sessions in ~/.claude/projects/
      const sessions = listTeamSessions(uniqueTestPath);
      expect(sessions).toEqual([]);
    });

    it("should detect existing session file", () => {
      // Create a mock session file
      const teamDir = getTeamClaudeDir(uniqueTestPath);
      mkdirSync(teamDir, { recursive: true });

      const sessionId = "test-session-123";
      const sessionPath = getSessionFilePath(uniqueTestPath, sessionId);
      writeFileSync(sessionPath, "mock session data");

      const exists = sessionFileExists(uniqueTestPath, sessionId);
      expect(exists).toBe(true);
    });

    it("should list multiple session files", () => {
      // Create session files for our unique test path
      const teamDir = getTeamClaudeDir(uniqueTestPath);
      mkdirSync(teamDir, { recursive: true });

      const sessionIds = ["session-1", "session-2", "session-3"];
      for (const id of sessionIds) {
        const path = getSessionFilePath(uniqueTestPath, id);
        writeFileSync(path, "mock data");
      }

      const sessions = listTeamSessions(uniqueTestPath);
      expect(sessions).toHaveLength(3);
      expect(sessions).toEqual(expect.arrayContaining(sessionIds));
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

    it("should reject empty path", () => {
      expect(() => validateProjectPath("")).toThrow();
    });

    it("should validate path is a directory not a file", () => {
      // Create a file
      const filePath = "/tmp/test-file-not-dir";
      writeFileSync(filePath, "test");

      expect(() => validateProjectPath(filePath)).toThrow("is not a directory");

      // Cleanup
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
    });
  });
});
