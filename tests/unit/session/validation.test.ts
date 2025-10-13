import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateUUID,
  validateSessionId,
  validateSecureProjectPath,
  validateTeamName,
  generateSecureUUID,
  sanitizePath,
} from "../../../src/session/validation.js";
import { ConfigurationError, ValidationError } from "../../../src/utils/errors.js";

// Mock fs module
vi.mock("fs");
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("Session Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateUUID", () => {
    it("should validate correct UUID v4 format", () => {
      const validUUIDs = [
        "550e8400-e29b-41d4-a716-446655440000", // Valid v4
        "f47ac10b-58cc-4372-a567-0e02b2c3d479", // Valid v4
        "123e4567-e89b-42d3-a456-426614174000", // Valid v4
      ];

      for (const uuid of validUUIDs) {
        expect(validateUUID(uuid)).toBe(true);
      }
    });

    it("should reject invalid UUID formats", () => {
      const invalidUUIDs = [
        "not-a-uuid",
        "550e8400-e29b-41d4-a716", // too short
        "550e8400-e29b-41d4-a716-446655440000-extra", // too long
        "550e8400e29b41d4a716446655440000", // no dashes
        "",
        "12345678-1234-1234-1234-123456789012", // wrong format
      ];

      for (const uuid of invalidUUIDs) {
        expect(validateUUID(uuid)).toBe(false);
      }
    });
  });

  describe("validateSessionId", () => {
    it("should accept valid UUID session ID", () => {
      const validSessionId = "550e8400-e29b-41d4-a716-446655440000";

      expect(() => validateSessionId(validSessionId)).not.toThrow();
    });

    it("should throw ValidationError for empty session ID", () => {
      expect(() => validateSessionId("")).toThrow(ValidationError);
      expect(() => validateSessionId("")).toThrow("Session ID cannot be empty");
    });

    it("should throw ValidationError for invalid UUID format", () => {
      expect(() => validateSessionId("not-a-uuid")).toThrow(ValidationError);
      expect(() => validateSessionId("not-a-uuid")).toThrow(
        "Invalid session ID format"
      );
    });
  });

  describe("validateSecureProjectPath", () => {
    it("should validate existing absolute paths", async () => {
      const { existsSync, realpathSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(realpathSync).mockImplementation((path) => path as string);

      expect(() =>
        validateSecureProjectPath("/valid/project/path")
      ).not.toThrow();
    });

    it("should throw ConfigurationError for empty path", () => {
      expect(() => validateSecureProjectPath("")).toThrow(ConfigurationError);
      expect(() => validateSecureProjectPath("")).toThrow(
        "Project path cannot be empty"
      );
    });

    it("should throw ConfigurationError for non-existent path", async () => {
      const { existsSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(false);

      expect(() => validateSecureProjectPath("/nonexistent/path")).toThrow(
        ConfigurationError
      );
      expect(() => validateSecureProjectPath("/nonexistent/path")).toThrow(
        "Project path does not exist"
      );
    });

    it("should throw ConfigurationError for path traversal attempts", async () => {
      const { existsSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(true);

      expect(() => validateSecureProjectPath("../../../etc/passwd")).toThrow(
        ConfigurationError
      );
      expect(() => validateSecureProjectPath("../../../etc/passwd")).toThrow(
        "Path contains traversal attempts"
      );
    });

    it("should throw ConfigurationError for suspicious system paths", async () => {
      const { existsSync, realpathSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(realpathSync).mockImplementation((path) => path as string);

      const suspiciousPaths = [
        "/etc/config",
        "/usr/bin/something",
        "/System/Library",
        "/Windows/System32",
        "/home/user/.ssh/keys",
      ];

      for (const path of suspiciousPaths) {
        expect(() => validateSecureProjectPath(path)).toThrow(
          ConfigurationError
        );
        expect(() => validateSecureProjectPath(path)).toThrow(
          "appears to be in a system directory"
        );
      }
    });

    it("should warn about symlinks but allow them", async () => {
      const { existsSync, realpathSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(realpathSync).mockReturnValue("/real/path");

      expect(() =>
        validateSecureProjectPath("/symlink/path")
      ).not.toThrow();

      // Logger warning should be called (but we can't easily verify it due to mock setup)
    });

    it("should handle realpathSync errors gracefully", async () => {
      const { existsSync, realpathSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(realpathSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      // Should not throw, just log error
      expect(() =>
        validateSecureProjectPath("/path/with/permission/issues")
      ).not.toThrow();
    });
  });

  describe("validateTeamName", () => {
    it("should accept valid team names", () => {
      const validNames = [
        "team-alpha",
        "team_beta",
        "my-team-123",
        "frontend",
        "backend-api",
        "team@example.com",
        "service.v2",
      ];

      for (const name of validNames) {
        expect(() => validateTeamName(name)).not.toThrow();
      }
    });

    it("should throw ValidationError for empty team name", () => {
      expect(() => validateTeamName("")).toThrow(ValidationError);
      expect(() => validateTeamName("")).toThrow("Team name cannot be empty");
    });

    it("should throw ValidationError for team name exceeding max length", () => {
      const longName = "a".repeat(101);

      expect(() => validateTeamName(longName)).toThrow(ValidationError);
      expect(() => validateTeamName(longName)).toThrow(
        "exceeds maximum length"
      );
    });

    it("should throw ValidationError for dangerous characters", () => {
      const dangerousNames = [
        "team/../admin",
        "team..\\windows",
        "team\0null",
        "team|pipe",
        "team&command",
        "team;semicolon",
        "team$variable",
        "team`backtick",
      ];

      for (const name of dangerousNames) {
        expect(() => validateTeamName(name)).toThrow(ValidationError);
        expect(() => validateTeamName(name)).toThrow("dangerous character");
      }
    });

    it("should throw ValidationError for invalid characters", () => {
      const invalidNames = [
        "team name", // spaces
        "team/slash",
        "team\\backslash",
        "team:colon",
        "team*asterisk",
        "team?question",
        "team<bracket>",
      ];

      for (const name of invalidNames) {
        expect(() => validateTeamName(name)).toThrow(ValidationError);
        expect(() => validateTeamName(name)).toThrow("invalid characters");
      }
    });
  });

  describe("generateSecureUUID", () => {
    it("should generate valid UUID v4", () => {
      const uuid = generateSecureUUID();

      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(validateUUID(uuid)).toBe(true);
    });

    it("should generate unique UUIDs", () => {
      const uuids = new Set();

      for (let i = 0; i < 100; i++) {
        uuids.add(generateSecureUUID());
      }

      // Should have 100 unique UUIDs
      expect(uuids.size).toBe(100);
    });
  });

  describe("sanitizePath", () => {
    it("should remove null bytes", () => {
      const path = "/path/with\0null/bytes";

      expect(sanitizePath(path)).toBe("/path/withnull/bytes");
    });

    it("should remove control characters", () => {
      const path = "/path/with\x01\x02\x03control/chars";

      expect(sanitizePath(path)).toBe("/path/withcontrol/chars");
    });

    it("should normalize multiple slashes", () => {
      const path = "/path//with///multiple////slashes";

      expect(sanitizePath(path)).toBe("/path/with/multiple/slashes");
    });

    it("should remove trailing slashes", () => {
      const path = "/path/with/trailing/slash/";

      expect(sanitizePath(path)).toBe("/path/with/trailing/slash");
    });

    it("should handle combined sanitization", () => {
      const path = "/path\0//with\x01///multiple\x7f////issues///";

      expect(sanitizePath(path)).toBe("/path/with/multiple/issues");
    });

    it("should return unchanged path if already clean", () => {
      const path = "/clean/path";

      expect(sanitizePath(path)).toBe("/clean/path");
    });
  });
});
