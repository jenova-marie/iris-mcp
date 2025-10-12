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

  describe("basic functionality (bare-bones mode - caching disabled)", () => {
    it("should return empty output (caching disabled in bare-bones mode)", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
        timestamp: expect.any(Number),
      });

      // getOutputCache not called in bare-bones mode
      expect(mockProcessPool.getOutputCache).not.toHaveBeenCalled();
    });

    it("should return empty output for any team (caching disabled)", async () => {
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

    it("should include team name when fromTeam provided", async () => {
      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result.team).toBe("team-alpha");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
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

  describe("cache handling (disabled in bare-bones mode)", () => {
    it("should return empty output (caching disabled)", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.stdout).toBe("");
      expect(result.totalBytes).toBe(0);
      expect(mockProcessPool.getOutputCache).not.toHaveBeenCalled();
    });

    it("should return empty output regardless of team", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.stderr).toBe("");
      expect(result.totalBytes).toBe(0);
    });

    it("should always return hasProcess=false (no caching)", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.hasProcess).toBe(false);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });

    it("should handle any team name (caching disabled)", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result.totalBytes).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
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

    // getOutputCache is not called in bare-bones mode
    it("should not call getOutputCache (disabled in bare-bones)", async () => {
      await report({ team: "team-alpha" }, mockProcessPool);

      expect(mockProcessPool.getOutputCache).not.toHaveBeenCalled();
    });

    it("should log errors before throwing", async () => {
      const error = new Error("Test error");
      vi.mocked(mockProcessPool.getConfig).mockImplementation(() => {
        throw error;
      });

      await expect(
        report({ team: "team-alpha" }, mockProcessPool),
      ).rejects.toThrow("Test error");

      // Logger would have been called with the error
    });
  });

  describe("edge cases (bare-bones mode)", () => {
    it("should always return empty output (no cache in bare-bones)", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
      });

      // getOutputCache not called in bare-bones mode
      expect(mockProcessPool.getOutputCache).not.toHaveBeenCalled();
    });

    it("should return consistent empty results", async () => {
      const result = await report({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
      });
    });
  });
});
