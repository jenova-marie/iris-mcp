import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { report } from "../../../src/actions/report.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { ConfigurationError } from "../../../src/utils/errors.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock the validation
vi.mock("../../../src/utils/validation.js", () => ({
  validateTeamName: vi.fn(),
}));

describe("report", () => {
  let mockProcessPool: ClaudeProcessPool;

  beforeEach(() => {
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
    } as unknown as ClaudeProcessPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("caching disabled in bare-bones mode", () => {
    it("should return empty report since caching is disabled", async () => {
      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
        timestamp: expect.any(Number),
      });
    });
  });

  describe("validation", () => {
    it("should validate team names", async () => {
      const { validateTeamName } = await import(
        "../../../src/utils/validation.js"
      );

      await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-beta");
    });

    it("should throw ConfigurationError for unknown team", async () => {
      await expect(
        report(
          { team: "unknown-team", fromTeam: "team-beta" },
          mockProcessPool,
        ),
      ).rejects.toThrow(ConfigurationError);
    });
  });

  describe("timing", () => {
    it("should include timestamp", async () => {
      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result.timestamp).toBeGreaterThan(0);
    });
  });
});
