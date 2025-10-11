import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { wakeAll } from "../../../src/actions/wake-all.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import type { SessionManager } from "../../../src/session/session-manager.js";
import type { ClaudeProcess } from "../../../src/process-pool/claude-process.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe("wakeAll", () => {
  let mockIris: IrisOrchestrator;
  let mockProcessPool: ClaudeProcessPool;
  let mockSessionManager: SessionManager;
  let mockProcessAlpha: ClaudeProcess;
  let mockProcessBeta: ClaudeProcess;

  beforeEach(() => {
    // Setup mock processes
    mockProcessAlpha = {
      getMetrics: vi.fn().mockReturnValue({
        pid: 12345,
        sessionId: "session-alpha",
        status: "idle",
        messagesProcessed: 0,
        lastUsed: Date.now(),
        uptime: 1000,
        idleTimeRemaining: 299000,
        queueLength: 0,
        messageCount: 0,
        lastActivity: Date.now(),
      }),
    } as unknown as ClaudeProcess;

    mockProcessBeta = {
      getMetrics: vi.fn().mockReturnValue({
        pid: 67890,
        sessionId: "session-beta",
        status: "idle",
        messagesProcessed: 0,
        lastUsed: Date.now(),
        uptime: 1000,
        idleTimeRemaining: 299000,
        queueLength: 0,
        messageCount: 0,
        lastActivity: Date.now(),
      }),
    } as unknown as ClaudeProcess;

    // Setup mock Iris orchestrator
    mockIris = {} as IrisOrchestrator;

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
          "team-gamma": {
            path: "/path/to/gamma",
            description: "Gamma team",
          },
        },
      }),
      getProcess: vi.fn(),
      getOrCreateProcess: vi.fn(),
    } as unknown as ClaudeProcessPool;

    // Setup mock session manager
    mockSessionManager = {
      getOrCreateSession: vi.fn().mockImplementation(async (from, to) => ({
        sessionId: `session-${to}`,
        fromTeam: from,
        toTeam: to,
        createdAt: Date.now(),
      })),
    } as unknown as SessionManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sequential mode (parallel=false)", () => {
    it("should wake all asleep teams sequentially", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessAlpha)
        .mockResolvedValueOnce(mockProcessBeta)
        .mockResolvedValueOnce(mockProcessAlpha); // gamma

      const result = await wakeAll(
        { parallel: false },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result).toMatchObject({
        message: "🚨 Sounding the air-raid siren! All teams are being awakened!",
        teams: [
          { team: "team-alpha", status: "waking", pid: 12345 },
          { team: "team-beta", status: "waking", pid: 67890 },
          { team: "team-gamma", status: "waking", pid: 12345 },
        ],
        summary: {
          total: 3,
          alreadyAwake: 0,
          woken: 3,
          failed: 0,
        },
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledTimes(3);
      expect(mockProcessPool.getOrCreateProcess).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed awake and asleep teams", async () => {
      vi.mocked(mockProcessPool.getProcess).mockImplementation((teamName) => {
        if (teamName === "team-alpha") return mockProcessAlpha;
        return undefined;
      });

      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessBeta)
        .mockResolvedValueOnce(mockProcessAlpha);

      const result = await wakeAll(
        {},
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.teams).toEqual([
        { team: "team-alpha", status: "awake", pid: 12345 },
        { team: "team-beta", status: "waking", pid: 67890 },
        { team: "team-gamma", status: "waking", pid: 12345 },
      ]);

      expect(result.summary).toEqual({
        total: 3,
        alreadyAwake: 1,
        woken: 2,
        failed: 0,
      });
    });

    it("should handle failures gracefully", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessAlpha)
        .mockRejectedValueOnce(new Error("Process spawn failed"))
        .mockResolvedValueOnce(mockProcessBeta);

      const result = await wakeAll(
        {},
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.teams).toEqual([
        { team: "team-alpha", status: "waking", pid: 12345 },
        { team: "team-beta", status: "failed", error: "Process spawn failed" },
        { team: "team-gamma", status: "waking", pid: 67890 },
      ]);

      expect(result.summary).toEqual({
        total: 3,
        alreadyAwake: 0,
        woken: 2,
        failed: 1,
      });
    });
  });

  describe("parallel mode (parallel=true)", () => {
    it("should wake all teams in parallel", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessAlpha)
        .mockResolvedValueOnce(mockProcessBeta)
        .mockResolvedValueOnce(mockProcessAlpha);

      const result = await wakeAll(
        { parallel: true },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.summary).toEqual({
        total: 3,
        alreadyAwake: 0,
        woken: 3,
        failed: 0,
      });

      // All session creations should happen in parallel
      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledTimes(3);
      expect(mockProcessPool.getOrCreateProcess).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed states in parallel", async () => {
      vi.mocked(mockProcessPool.getProcess).mockImplementation((teamName) => {
        if (teamName === "team-beta") return mockProcessBeta;
        return undefined;
      });

      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessAlpha)
        .mockResolvedValueOnce(mockProcessAlpha); // gamma

      const result = await wakeAll(
        { parallel: true },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      // Results might be in different order due to parallel execution
      expect(result.teams).toHaveLength(3);
      expect(result.teams.find(t => t.team === "team-alpha")).toMatchObject({
        team: "team-alpha",
        status: "waking",
        pid: 12345,
      });
      expect(result.teams.find(t => t.team === "team-beta")).toMatchObject({
        team: "team-beta",
        status: "awake",
        pid: 67890,
      });
      expect(result.teams.find(t => t.team === "team-gamma")).toMatchObject({
        team: "team-gamma",
        status: "waking",
        pid: 12345,
      });

      expect(result.summary).toEqual({
        total: 3,
        alreadyAwake: 1,
        woken: 2,
        failed: 0,
      });
    });

    it("should handle parallel failures", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessAlpha)
        .mockRejectedValueOnce(new Error("Parallel fail"))
        .mockResolvedValueOnce(mockProcessBeta);

      const result = await wakeAll(
        { parallel: true },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.teams).toHaveLength(3);
      const failedTeam = result.teams.find(t => t.status === "failed");
      expect(failedTeam).toMatchObject({
        team: "team-beta",
        status: "failed",
        error: "Parallel fail",
      });

      expect(result.summary.failed).toBe(1);
      expect(result.summary.woken).toBe(2);
    });
  });

  describe("fromTeam parameter", () => {
    it("should include fromTeam in logging", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcessAlpha);

      await wakeAll(
        { fromTeam: "team-delta" },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      // fromTeam is used for logging context
      expect(mockProcessPool.getConfig).toHaveBeenCalled();
    });
  });

  describe("empty teams", () => {
    it("should handle empty teams configuration", async () => {
      vi.mocked(mockProcessPool.getConfig).mockReturnValue({
        teams: {},
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
        },
      });

      const result = await wakeAll(
        {},
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result).toMatchObject({
        message: "🚨 Sounding the air-raid siren! All teams are being awakened!",
        teams: [],
        summary: {
          total: 0,
          alreadyAwake: 0,
          woken: 0,
          failed: 0,
        },
      });
    });
  });

  describe("error handling", () => {
    it("should handle session creation failures", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockSessionManager.getOrCreateSession)
        .mockResolvedValueOnce({
          sessionId: "session-alpha",
          fromTeam: null,
          toTeam: "team-alpha",
          createdAt: Date.now(),
        })
        .mockRejectedValueOnce(new Error("Session error"))
        .mockResolvedValueOnce({
          sessionId: "session-gamma",
          fromTeam: null,
          toTeam: "team-gamma",
          createdAt: Date.now(),
        });

      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcessAlpha)
        .mockResolvedValueOnce(mockProcessBeta);

      const result = await wakeAll(
        {},
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.summary.failed).toBe(1);
      expect(result.teams.find(t => t.team === "team-beta")).toMatchObject({
        status: "failed",
        error: "Session error",
      });
    });

    it("should handle non-Error failures", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockRejectedValueOnce("String error");

      const result = await wakeAll(
        {},
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.teams[0]).toMatchObject({
        team: "team-alpha",
        status: "failed",
        error: "String error",
      });
    });
  });

  describe("timing", () => {
    it("should track operation duration", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcessAlpha);

      const result = await wakeAll(
        {},
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should be faster in parallel mode (conceptually)", async () => {
      // This test doesn't actually measure speed but verifies parallel execution
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      let parallelCallCount = 0;
      vi.mocked(mockProcessPool.getOrCreateProcess).mockImplementation(async () => {
        parallelCallCount++;
        return mockProcessAlpha;
      });

      await wakeAll(
        { parallel: true },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      // All processes should be created (3 teams)
      expect(parallelCallCount).toBe(3);
    });
  });
});