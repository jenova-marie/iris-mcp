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

describe("wake-all", () => {
  let mockIris: IrisOrchestrator;
  let mockProcessPool: ClaudeProcessPool;
  let mockSessionManager: SessionManager;
  let mockProcess: ClaudeProcess;

  beforeEach(() => {
    mockProcess = {
      getBasicMetrics: vi.fn().mockReturnValue({
        teamName: "team-alpha",
        pid: 12345,
        uptime: 1000,
        isReady: true,
        isSpawning: false,
        isBusy: false,
      }),
    } as unknown as ClaudeProcess;

    mockIris = {} as IrisOrchestrator;

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
      getOrCreateProcess: vi.fn(),
    } as unknown as ClaudeProcessPool;

    mockSessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({
        sessionId: "session-123",
        fromTeam: "external",
        toTeam: "team-alpha",
        createdAt: new Date(),
      }),
    } as unknown as SessionManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sequential wake (parallel=false)", () => {
    it("should wake all teams sequentially", async () => {
      vi.mocked(mockProcessPool.getProcess)
        .mockReturnValueOnce(mockProcess)   // team-alpha already awake
        .mockReturnValueOnce(undefined);    // team-beta needs waking

      vi.mocked(mockProcessPool.getOrCreateProcess).mockResolvedValue(mockProcess);

      const result = await wakeAll(
        { fromTeam: "external", parallel: false },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.teams).toHaveLength(2);
      expect(result.summary).toMatchObject({
        total: 2,
        alreadyAwake: 1,
        woken: 1,
        failed: 0,
      });
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should handle team wake failures", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
      vi.mocked(mockProcessPool.getOrCreateProcess)
        .mockResolvedValueOnce(mockProcess)  // team-alpha success
        .mockRejectedValueOnce(new Error("Spawn failed"));  // team-beta failed

      const result = await wakeAll(
        { fromTeam: "external", parallel: false },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.summary.failed).toBe(1);
      expect(result.teams[1].status).toBe("failed");
      expect(result.teams[1].error).toContain("Spawn failed");
    });
  });

  describe("parallel wake warning", () => {
    it("should warn about instability but proceed if parallel=true", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await wakeAll(
        { fromTeam: "external", parallel: true },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      // Should still complete, but would have logged warning
      expect(result.teams).toHaveLength(2);
      expect(result.message).toBeDefined();
    });
  });

  describe("all teams already awake", () => {
    it("should report all teams awake", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await wakeAll(
        { fromTeam: "external" },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.summary).toMatchObject({
        total: 2,
        alreadyAwake: 2,
        woken: 0,
        failed: 0,
      });
    });
  });

  describe("timing", () => {
    it("should track total operation duration", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await wakeAll(
        { fromTeam: "external" },
        mockIris,
        mockProcessPool,
        mockSessionManager
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });
});
