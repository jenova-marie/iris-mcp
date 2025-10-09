/**
 * Integration tests for Session Validation
 * Tests core validation functions for UUIDs, team names, and paths
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
      expect(() => validateSessionId("invalid-id")).toThrow("Invalid session ID format");
    });
  });

  describe("Team name validation", () => {
    it("should accept valid team names", () => {
      expect(() => validateTeamName("frontend")).not.toThrow();
      expect(() => validateTeamName("team-alpha")).not.toThrow();
      expect(() => validateTeamName("team_beta")).not.toThrow();
      expect(() => validateTeamName("team@example")).not.toThrow();
    });

    it("should reject empty team name", () => {
      expect(() => validateTeamName("")).toThrow("Team name cannot be empty");
    });

    it("should reject dangerous characters", () => {
      expect(() => validateTeamName("team/../etc")).toThrow("dangerous character");
      expect(() => validateTeamName("team;rm -rf")).toThrow("dangerous character");
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
      expect(() => validateSecureProjectPath("/tmp/does-not-exist-12345")).toThrow(
        "does not exist",
      );
    });
  });
});
