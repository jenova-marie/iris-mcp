import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isAwake } from "../../../src/actions/isAwake.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import type { TeamsConfigManager } from "../../../src/config/teams-config.js";
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

// Mock the validation
vi.mock("../../../src/utils/validation.js", () => ({
  validateTeamName: vi.fn(),
}));

describe("isAwake", () => {
  let mockIris: IrisOrchestrator;
  let mockProcessPool: ClaudeProcessPool;
  let mockConfigManager: TeamsConfigManager;
  let mockProcess: ClaudeProcess;

  beforeEach(() => {
    // Setup mock process
    mockProcess = {
      getBasicMetrics: vi.fn().mockReturnValue({
        teamName: "team-alpha",
        pid: 12345,
        sessionId: "session-123",
        messageCount: 5,
        lastActivity: Date.now(),
        uptime: 60000,
        isReady: true,
        isSpawning: false,
        isBusy: false,
      }),
    } as unknown as ClaudeProcess;

    mockIris = {} as IrisOrchestrator;

    // Setup mock process pool
    mockProcessPool = {
      getProcess: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        maxProcesses: 10,
        processes: {
          "external->team-alpha": {
            pid: 12345,
            sessionId: "session-123",
            messageCount: 5,
            lastActivity: Date.now(),
          },
        },
      }),
    } as unknown as ClaudeProcessPool;

    // Setup mock config manager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        teams: {
          "team-alpha": {
            path: "/path/to/alpha",
            description: "Alpha team",
            color: "#ff0000",
          },
          "team-beta": {
            path: "/path/to/beta",
            description: "Beta team",
          },
        },
      }),
    } as unknown as TeamsConfigManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("checking all teams", () => {
    it("should return status for all teams", async () => {
      vi.mocked(mockProcessPool.getProcess)
        .mockReturnValueOnce(mockProcess)  // team-alpha awake
        .mockReturnValueOnce(undefined);    // team-beta asleep

      const result = await isAwake(
        {},
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.teams).toHaveLength(2);
      expect(result.teams[0].name).toBe("team-alpha");
      expect(result.teams[0].status).toBe("awake");
      expect(result.teams[0].pid).toBe(12345);
      expect(result.teams[1].name).toBe("team-beta");
      expect(result.teams[1].status).toBe("asleep");
      expect(result.pool).toMatchObject({
        activeProcesses: 1,
        maxProcesses: 10,
        totalMessages: 5,
      });
    });
  });

  describe("checking specific team", () => {
    it("should return status for single team when specified", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await isAwake(
        { team: "team-alpha" },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.teams).toHaveLength(1);
      expect(result.teams[0]).toMatchObject({
        name: "team-alpha",
        status: "awake",
        pid: 12345,
        sessionId: "session-123",
        messageCount: 5,
        config: {
          path: "/path/to/alpha",
          description: "Alpha team",
          color: "#ff0000",
        },
      });
    });

    it("should throw error for unknown team", async () => {
      await expect(
        isAwake(
          { team: "unknown-team" },
          mockIris,
          mockProcessPool,
          mockConfigManager
        )
      ).rejects.toThrow("Unknown team: unknown-team");
    });
  });

  describe("notification statistics", () => {
    it("should include notification stats when requested", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      const result = await isAwake(
        { includeNotifications: true },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.notifications).toBeDefined();
      expect(result.notifications).toMatchObject({
        pending: 0,
        total: 0,
      });
    });

    it("should exclude notifications when not requested", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      const result = await isAwake(
        { includeNotifications: false },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.notifications).toBeUndefined();
    });
  });

  describe("validation", () => {
    it("should validate team name when provided", async () => {
      const { validateTeamName } = await import("../../../src/utils/validation.js");

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      await isAwake(
        { team: "team-alpha" },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
    });
  });

  describe("timing", () => {
    it("should include timestamp", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);

      const result = await isAwake(
        {},
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.timestamp).toBeGreaterThan(0);
    });
  });
});
