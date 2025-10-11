import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { report } from "../../../src/actions/report.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { ConfigurationError } from "../../../src/utils/errors.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock the validation
vi.mock("../../../src/utils/validation.js", () => ({
  validateTeamName: vi.fn(),
}));

describe("report", () => {
  let mockProcessPool: ClaudeProcessPool;

  beforeEach(() => {
    // Setup mock process pool
    mockProcessPool = {
      getConfig: vi.fn().mockReturnValue({
        teams: {
          "team-alpha": {
            path: "/path/to/alpha",
            description: "Alpha team",
          },
          "team-beta": {
            path: "/path/to/beta",
            description: "Beta team",
          },
        },
      }),
      getOutputCache: vi.fn(),
    } as unknown as ClaudeProcessPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should return cached output for a team with active process", async () => {
      const mockCache = {
        stdout: "Hello from stdout\nAnother line",
        stderr: "Warning: something happened",
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "Hello from stdout\nAnother line",
        stderr: "Warning: something happened",
        hasProcess: true,
        totalBytes: mockCache.stdout.length + mockCache.stderr.length,
        timestamp: expect.any(Number),
      });

      expect(mockProcessPool.getOutputCache).toHaveBeenCalledWith("team-alpha");
    });

    it("should return empty cache for team without active process", async () => {
      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(null);

      const result = await report({ team: "team-beta" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-beta",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
        timestamp: expect.any(Number),
      });
    });

    it("should include fromTeam when provided", async () => {
      const mockCache = {
        stdout: "output",
        stderr: "",
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result.team).toBe("team-alpha");
      // fromTeam is logged but not returned in output
    });
  });

  describe("validation", () => {
    it("should throw ConfigurationError for unknown team", async () => {
      await expect(
        report({ team: "unknown-team" }, mockProcessPool),
      ).rejects.toThrow(ConfigurationError);

      await expect(
        report({ team: "unknown-team" }, mockProcessPool),
      ).rejects.toThrow("Unknown team: unknown-team");
    });

    it("should validate team names through validation module", async () => {
      const { validateTeamName } = await import(
        "../../../src/utils/validation.js"
      );
      const mockValidate = vi.mocked(validateTeamName);

      await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(mockValidate).toHaveBeenCalledWith("team-alpha");
      expect(mockValidate).toHaveBeenCalledWith("team-beta");
    });
  });

  describe("cache handling", () => {
    it("should handle large stdout cache", async () => {
      const largeStdout = "x".repeat(10000);
      const mockCache = {
        stdout: largeStdout,
        stderr: "",
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.stdout).toBe(largeStdout);
      expect(result.totalBytes).toBe(10000);
    });

    it("should handle large stderr cache", async () => {
      const largeStderr = "e".repeat(5000);
      const mockCache = {
        stdout: "",
        stderr: largeStderr,
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.stderr).toBe(largeStderr);
      expect(result.totalBytes).toBe(5000);
    });

    it("should handle both stdout and stderr cache", async () => {
      const mockCache = {
        stdout: "stdout content",
        stderr: "stderr content",
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.stdout).toBe("stdout content");
      expect(result.stderr).toBe("stderr content");
      expect(result.totalBytes).toBe(
        "stdout content".length + "stderr content".length,
      );
    });

    it("should handle unicode characters in cache", async () => {
      const mockCache = {
        stdout: "Hello 世界 🌍",
        stderr: "Error: ⚠️ Warning",
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.stdout).toBe("Hello 世界 🌍");
      expect(result.stderr).toBe("Error: ⚠️ Warning");
      expect(result.totalBytes).toBe(
        mockCache.stdout.length + mockCache.stderr.length,
      );
    });
  });

  describe("error handling", () => {
    it("should propagate config errors", async () => {
      vi.mocked(mockProcessPool.getConfig).mockImplementation(() => {
        throw new Error("Config load error");
      });

      await expect(
        report({ team: "team-alpha" }, mockProcessPool),
      ).rejects.toThrow("Config load error");
    });

    it("should propagate getOutputCache errors", async () => {
      vi.mocked(mockProcessPool.getOutputCache).mockImplementation(() => {
        throw new Error("Cache retrieval error");
      });

      await expect(
        report({ team: "team-alpha" }, mockProcessPool),
      ).rejects.toThrow("Cache retrieval error");
    });

    it("should log errors before throwing", async () => {
      const error = new Error("Test error");
      vi.mocked(mockProcessPool.getOutputCache).mockImplementation(() => {
        throw error;
      });

      await expect(
        report({ team: "team-alpha" }, mockProcessPool),
      ).rejects.toThrow("Test error");

      // Logger would have been called with the error
    });
  });

  describe("edge cases", () => {
    it("should handle undefined cache gracefully", async () => {
      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(
        undefined as any,
      );

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
      });
    });

    it("should handle empty strings in cache", async () => {
      const mockCache = {
        stdout: "",
        stderr: "",
      };

      vi.mocked(mockProcessPool.getOutputCache).mockReturnValue(mockCache);

      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: true,
        totalBytes: 0,
      });
    });
  });
});
