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
    // Setup mock process
    mockProcess = {
      getMetrics: vi.fn().mockReturnValue({
        pid: 12345,
        sessionId: "session-123",
        messageCount: 0,
        status: "idle",
        messagesProcessed: 5,
        lastUsed: Date.now(),
        uptime: 60000,
        idleTimeRemaining: 240000,
        queueLength: 0,
        lastActivity: Date.now(),
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
      clearOutputCache: vi.fn(),
    } as unknown as ClaudeProcessPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should put an active team to sleep", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "sleeping",
        pid: 12345,
        sessionId: "session-123",
        message: "Team team-alpha has been put to sleep",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockProcessPool.terminateProcess).toHaveBeenCalledWith("team-alpha");
      expect(mockProcessPool.clearOutputCache).toHaveBeenCalledWith("team-alpha");
    });

    it("should return already_asleep for inactive team", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      const result = await sleep({ team: "team-beta" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-beta",
        status: "already_asleep",
        message: "Team team-beta is already asleep",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockProcessPool.terminateProcess).not.toHaveBeenCalled();
      expect(mockProcessPool.clearOutputCache).not.toHaveBeenCalled();
    });

    it("should include fromTeam in logging", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      await sleep({ team: "team-alpha", fromTeam: "team-beta" }, mockProcessPool);

      // fromTeam is used for logging context
      expect(mockProcessPool.terminateProcess).toHaveBeenCalledWith("team-alpha");
    });
  });

  describe("force termination", () => {
    it("should report lost messages when force=true", async () => {
      const processWithMessages = {
        getMetrics: vi.fn().mockReturnValue({
          pid: 12345,
          sessionId: "session-123",
          messageCount: 5,
          status: "processing",
          messagesProcessed: 10,
          lastUsed: Date.now(),
          uptime: 60000,
          idleTimeRemaining: 240000,
          queueLength: 5,
          lastActivity: Date.now(),
        }),
      } as unknown as ClaudeProcess;

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(processWithMessages);

      const result = await sleep(
        { team: "team-alpha", force: true },
        mockProcessPool
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "sleeping",
        pid: 12345,
        sessionId: "session-123",
        lostMessages: 5,
        message: "Team team-alpha was forcefully put to sleep (5 messages lost)",
      });
    });

    it("should not report lost messages when none pending", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await sleep(
        { team: "team-alpha", force: true },
        mockProcessPool
      );

      expect(result.lostMessages).toBeUndefined();
      expect(result.message).toBe("Team team-alpha has been put to sleep");
    });
  });

  describe("cache clearing", () => {
    it("should clear cache by default", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(mockProcessPool.clearOutputCache).toHaveBeenCalledWith("team-alpha");
    });

    it("should skip cache clearing when clearCache=false", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      await sleep({ team: "team-alpha", clearCache: false }, mockProcessPool);

      expect(mockProcessPool.clearOutputCache).not.toHaveBeenCalled();
    });

    it("should clear cache before terminating process", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const callOrder: string[] = [];
      vi.mocked(mockProcessPool.clearOutputCache).mockImplementation(() => {
        callOrder.push("clearCache");
      });
      vi.mocked(mockProcessPool.terminateProcess).mockImplementation(async () => {
        callOrder.push("terminate");
      });

      await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(callOrder).toEqual(["clearCache", "terminate"]);
    });
  });

  describe("error handling", () => {
    it("should throw ConfigurationError for unknown team", async () => {
      await expect(
        sleep({ team: "unknown-team" }, mockProcessPool)
      ).rejects.toThrow(ConfigurationError);

      await expect(
        sleep({ team: "unknown-team" }, mockProcessPool)
      ).rejects.toThrow("Unknown team: unknown-team");
    });

    it("should handle termination failure gracefully", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);
      vi.mocked(mockProcessPool.terminateProcess).mockRejectedValue(
        new Error("Termination failed")
      );

      const result = await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "sleeping",
        pid: 12345,
        sessionId: "session-123",
        message: "Failed to put team team-alpha to sleep: Termination failed",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it("should propagate config errors", async () => {
      vi.mocked(mockProcessPool.getConfig).mockImplementation(() => {
        throw new Error("Config error");
      });

      await expect(
        sleep({ team: "team-alpha" }, mockProcessPool)
      ).rejects.toThrow("Config error");
    });

    it("should handle non-Error termination failures", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);
      vi.mocked(mockProcessPool.terminateProcess).mockRejectedValue("String error");

      const result = await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(result.message).toBe("Failed to put team team-alpha to sleep: String error");
    });
  });

  describe("validation", () => {
    it("should validate team names", async () => {
      const { validateTeamName } = await import("../../../src/utils/validation.js");
      const mockValidate = vi.mocked(validateTeamName);

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      await sleep({ team: "team-alpha", fromTeam: "team-beta" }, mockProcessPool);

      expect(mockValidate).toHaveBeenCalledWith("team-alpha");
      expect(mockValidate).toHaveBeenCalledWith("team-beta");
    });
  });

  describe("metrics and timing", () => {
    it("should track operation duration", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should include process metrics in output", async () => {
      const customMetrics = {
        pid: 99999,
        sessionId: "custom-session",
        messageCount: 3,
        status: "processing",
        messagesProcessed: 15,
        lastUsed: Date.now(),
        uptime: 120000,
        idleTimeRemaining: 180000,
        queueLength: 3,
        lastActivity: Date.now(),
      };

      const customProcess = {
        getMetrics: vi.fn().mockReturnValue(customMetrics),
      } as unknown as ClaudeProcess;

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(customProcess);

      const result = await sleep({ team: "team-alpha" }, mockProcessPool);

      expect(result.pid).toBe(99999);
      expect(result.sessionId).toBe("custom-session");
    });
  });
});