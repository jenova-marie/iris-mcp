/**
 * Unit tests for Session Path Utilities
 *
 * Tests path escaping algorithm and session file path resolution
 * as documented in docs/SESSION.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  escapeProjectPath,
  getClaudeProjectsDir,
  getTeamClaudeDir,
  getSessionFilePath,
  sessionFileExists,
  listTeamSessions,
  validateProjectPath,
} from "../../../src/session/path-utils.js";

describe("Path Utilities", () => {
  describe("escapeProjectPath", () => {
    it("should escape standard project paths correctly", () => {
      expect(escapeProjectPath("/Users/jenova/projects/foo")).toBe(
        "-Users-jenova-projects-foo",
      );
      expect(escapeProjectPath("/tmp/test")).toBe("-tmp-test");
      expect(
        escapeProjectPath("/Users/jenova/projects/jenova-marie/iris-mcp"),
      ).toBe("-Users-jenova-projects-jenova-marie-iris-mcp");
    });

    it("should handle single-level paths", () => {
      expect(escapeProjectPath("/home")).toBe("-home");
      expect(escapeProjectPath("/opt")).toBe("-opt");
    });

    it("should throw error for non-absolute paths", () => {
      expect(() => escapeProjectPath("relative/path")).toThrow(
        "Path must be absolute",
      );
      expect(() => escapeProjectPath("./current")).toThrow(
        "Path must be absolute",
      );
      expect(() => escapeProjectPath("../parent")).toThrow(
        "Path must be absolute",
      );
    });

    it("should preserve case sensitivity", () => {
      expect(escapeProjectPath("/Users/Jenova/Projects")).toBe(
        "-Users-Jenova-Projects",
      );
      expect(escapeProjectPath("/users/jenova/projects")).toBe(
        "-users-jenova-projects",
      );
    });

    it("should handle paths with hyphens", () => {
      expect(escapeProjectPath("/my-project/sub-folder")).toBe(
        "-my-project-sub-folder",
      );
    });
  });

  describe("getClaudeProjectsDir", () => {
    it("should return path to ~/.claude/projects/", () => {
      const result = getClaudeProjectsDir();
      expect(result).toMatch(/\.claude\/projects$/);
      expect(result).toContain("/.claude/projects");
    });
  });

  describe("getTeamClaudeDir", () => {
    it("should combine Claude projects dir with escaped path", () => {
      const result = getTeamClaudeDir("/Users/jenova/projects/foo");
      expect(result).toMatch(/\.claude\/projects\/-Users-jenova-projects-foo$/);
    });

    it("should work with different project paths", () => {
      const result = getTeamClaudeDir("/tmp/test-project");
      expect(result).toMatch(/\.claude\/projects\/-tmp-test-project$/);
    });
  });

  describe("getSessionFilePath", () => {
    it("should return full path to session JSONL file", () => {
      const sessionId = "a1b2c3d4-5678-90ab-cdef-1234567890ab";
      const result = getSessionFilePath("/Users/jenova/projects/foo", sessionId);

      expect(result).toMatch(
        /\.claude\/projects\/-Users-jenova-projects-foo\/a1b2c3d4-5678-90ab-cdef-1234567890ab\.jsonl$/,
      );
      expect(result.endsWith(".jsonl")).toBe(true);
    });

    it("should handle different session IDs", () => {
      const sessionId = "test-uuid-123";
      const result = getSessionFilePath("/tmp/project", sessionId);

      expect(result).toContain(sessionId);
      expect(result.endsWith(`${sessionId}.jsonl`)).toBe(true);
    });
  });

  describe("sessionFileExists", () => {
    let testProjectPath: string;
    let testSessionId: string;

    beforeEach(() => {
      testProjectPath = join(tmpdir(), `iris-test-file-exists-${Date.now()}`);
      testSessionId = "test-session-uuid";

      // Create test project directory
      mkdirSync(testProjectPath, { recursive: true });
    });

    afterEach(() => {
      // Clean up test directories
      if (existsSync(testProjectPath)) {
        rmSync(testProjectPath, { recursive: true, force: true });
      }

      // Clean up the Claude directory that was created
      const teamDir = getTeamClaudeDir(testProjectPath);
      if (existsSync(teamDir)) {
        rmSync(teamDir, { recursive: true, force: true });
      }
    });

    it("should return false when session file does not exist", () => {
      expect(sessionFileExists(testProjectPath, testSessionId)).toBe(false);
    });

    it("should return true when session file exists", () => {
      // Create the session file
      const sessionPath = getSessionFilePath(testProjectPath, testSessionId);
      mkdirSync(join(sessionPath, ".."), { recursive: true });
      writeFileSync(sessionPath, "");

      expect(sessionFileExists(testProjectPath, testSessionId)).toBe(true);
    });
  });

  describe("listTeamSessions", () => {
    let testProjectPath: string;

    beforeEach(() => {
      testProjectPath = join(tmpdir(), `iris-test-list-sessions-${Date.now()}`);
      mkdirSync(testProjectPath, { recursive: true });
    });

    afterEach(() => {
      // Clean up the test project directory
      if (existsSync(testProjectPath)) {
        rmSync(testProjectPath, { recursive: true, force: true });
      }

      // Clean up the Claude directory that was created
      const teamDir = getTeamClaudeDir(testProjectPath);
      if (existsSync(teamDir)) {
        rmSync(teamDir, { recursive: true, force: true });
      }
    });

    it("should return empty array when Claude directory does not exist", () => {
      const result = listTeamSessions(testProjectPath);
      expect(result).toEqual([]);
    });

    it("should return empty array when directory has no session files", () => {
      const teamDir = getTeamClaudeDir(testProjectPath);
      mkdirSync(teamDir, { recursive: true });

      const result = listTeamSessions(testProjectPath);
      expect(result).toEqual([]);
    });

    it("should list session IDs without .jsonl extension", () => {
      const teamDir = getTeamClaudeDir(testProjectPath);
      mkdirSync(teamDir, { recursive: true });

      const sessionIds = [
        "session1-uuid",
        "session2-uuid",
        "a1b2c3d4-5678-90ab-cdef-1234567890ab",
      ];

      // Create session files
      for (const id of sessionIds) {
        writeFileSync(join(teamDir, `${id}.jsonl`), "");
      }

      const result = listTeamSessions(testProjectPath);

      expect(result).toHaveLength(3);
      expect(result).toContain("session1-uuid");
      expect(result).toContain("session2-uuid");
      expect(result).toContain("a1b2c3d4-5678-90ab-cdef-1234567890ab");
      expect(result.every((id) => !id.endsWith(".jsonl"))).toBe(true);
    });

    it("should ignore non-JSONL files", () => {
      const teamDir = getTeamClaudeDir(testProjectPath);
      mkdirSync(teamDir, { recursive: true });

      writeFileSync(join(teamDir, "session1.jsonl"), "");
      writeFileSync(join(teamDir, "not-a-session.txt"), "");
      writeFileSync(join(teamDir, "README.md"), "");

      const result = listTeamSessions(testProjectPath);

      expect(result).toHaveLength(1);
      expect(result).toEqual(["session1"]);
    });
  });

  describe("validateProjectPath", () => {
    let validTestPath: string;

    beforeEach(() => {
      validTestPath = join(tmpdir(), `iris-valid-project-${Date.now()}`);
      mkdirSync(validTestPath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(validTestPath)) {
        rmSync(validTestPath, { recursive: true, force: true });
      }
    });

    it("should not throw for valid absolute directory path", () => {
      expect(() => validateProjectPath(validTestPath)).not.toThrow();
    });

    it("should throw for relative paths", () => {
      expect(() => validateProjectPath("relative/path")).toThrow(
        "must be absolute",
      );
    });

    it("should throw for paths with ..", () => {
      expect(() => validateProjectPath("/Users/jenova/../admin")).toThrow(
        "contains invalid pattern",
      );
    });

    it("should throw for non-existent paths", () => {
      expect(() =>
        validateProjectPath("/nonexistent/path/12345"),
      ).toThrow("does not exist");
    });

    it("should throw for files instead of directories", () => {
      const filePath = join(validTestPath, "file.txt");
      writeFileSync(filePath, "test");

      expect(() => validateProjectPath(filePath)).toThrow(
        "is not a directory",
      );
    });
  });
});
