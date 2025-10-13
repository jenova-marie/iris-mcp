import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sleep } from "../../../src/actions/sleep.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import type { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
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

describe("sleep", () => {
  let mockProcessPool: ClaudeProcessPool;
  let mockProcess: ClaudeProcess;

  beforeEach(() => {
    // Setup mock process with new API
    mockProcess = {
      getBasicMetrics: vi.fn().mockReturnValue({
        teamName: "team-alpha",
        pid: 12345,
        sessionId: "session-123",
        messageCount: 5,
        uptime: 60000,
        isReady: true,
        isSpawning: false,
        isBusy: false,
      }),
    } as unknown as ClaudeProcess;

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
      getProcess: vi.fn(),
      terminateProcess: vi.fn().mockResolvedValue(undefined),
    } as unknown as ClaudeProcessPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("team already asleep", () => {
    it("should return already_asleep status", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      const result = await sleep(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "already_asleep",
        message: "Team team-alpha is already asleep",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockProcessPool.terminateProcess).not.toHaveBeenCalled();
    });
  });

  describe("putting awake team to sleep", () => {
    beforeEach(() => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);
    });

    it("should terminate team process", async () => {
      const result = await sleep(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "sleeping",
        pid: 12345,
        sessionId: "session-123",
        message: "Team team-alpha has been put to sleep",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockProcessPool.terminateProcess).toHaveBeenCalledWith(
        "team-alpha",
      );
    });

    it("should include lost messages when force=true", async () => {
      const result = await sleep(
        { team: "team-alpha", fromTeam: "team-beta", force: true },
        mockProcessPool,
      );

      expect(result.lostMessages).toBe(5);
      expect(result.message).toContain("5 messages lost");
    });

    it("should handle termination errors", async () => {
      vi.mocked(mockProcessPool.terminateProcess).mockRejectedValue(
        new Error("Termination failed"),
      );

      const result = await sleep(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result.status).toBe("sleeping");
      expect(result.message).toContain(
        "Failed to put team team-alpha to sleep",
      );
    });
  });

  describe("validation", () => {
    it("should validate team names", async () => {
      const { validateTeamName } = await import(
        "../../../src/utils/validation.js"
      );

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      await sleep(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-beta");
    });

    it("should throw ConfigurationError for unknown team", async () => {
      await expect(
        sleep({ team: "unknown-team", fromTeam: "team-beta" }, mockProcessPool),
      ).rejects.toThrow(ConfigurationError);
    });
  });

  describe("timing", () => {
    it("should track operation duration", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await sleep(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockProcessPool,
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });
});
