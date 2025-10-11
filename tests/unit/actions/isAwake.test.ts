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

  beforeEach(() => {
    // Setup mock Iris orchestrator
    mockIris = {} as IrisOrchestrator;

    // Setup mock process pool
    mockProcessPool = {
      getProcess: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        processes: {},
        maxProcesses: 10,
      }),
    } as unknown as ClaudeProcessPool;

    // Setup mock config manager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        teams: {
          "team-alpha": {
            path: "/path/to/alpha",
            description: "Alpha team",
            color: "#FF0000",
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

  describe("basic functionality", () => {
    it("should return status for all teams when no specific team is provided", async () => {
      const result = await isAwake({}, mockIris, mockProcessPool, mockConfigManager);

      expect(result).toMatchObject({
        teams: expect.arrayContaining([
          {
            name: "team-alpha",
            status: "asleep",
            config: {
              path: "/path/to/alpha",
              description: "Alpha team",
              color: "#FF0000",
            },
          },
          {
            name: "team-beta",
            status: "asleep",
            config: {
              path: "/path/to/beta",
              description: "Beta team",
            },
          },
        ]),
        pool: {
          activeProcesses: 0,
          maxProcesses: 10,
          totalMessages: 0,
        },
        timestamp: expect.any(Number),
      });
    });

    it("should return status for a specific team when team is provided", async () => {
      const result = await isAwake(
        { team: "team-alpha" },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.teams).toHaveLength(1);
      expect(result.teams[0]).toMatchObject({
        name: "team-alpha",
        status: "asleep",
        config: {
          path: "/path/to/alpha",
          description: "Alpha team",
          color: "#FF0000",
        },
      });
    });

    it("should throw an error for unknown team", async () => {
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

  describe("awake process detection", () => {
    it("should detect awake teams with active processes", async () => {
      const mockProcess = {} as ClaudeProcess;

      // Mock active process for team-alpha
      vi.mocked(mockProcessPool.getProcess).mockImplementation((teamName) => {
        if (teamName === "team-alpha") {
          return mockProcess;
        }
        return undefined;
      });

      // Mock pool status with active process
      vi.mocked(mockProcessPool.getStatus).mockReturnValue({
        processes: {
          "external->team-alpha": {
            pid: 12345,
            sessionId: "session-123",
            messageCount: 5,
            lastActivity: Date.now(),
            status: "idle",
            messagesProcessed: 5,
            lastUsed: Date.now(),
            uptime: 60000,
            idleTimeRemaining: 240000,
            queueLength: 0,
          },
        },
        maxProcesses: 10,
      });

      const result = await isAwake({}, mockIris, mockProcessPool, mockConfigManager);

      const alphaTeam = result.teams.find(t => t.name === "team-alpha");
      expect(alphaTeam).toMatchObject({
        name: "team-alpha",
        status: "awake",
        pid: 12345,
        sessionId: "session-123",
        messageCount: 5,
        lastActivity: expect.any(Number),
      });

      const betaTeam = result.teams.find(t => t.name === "team-beta");
      expect(betaTeam).toMatchObject({
        name: "team-beta",
        status: "asleep",
      });
    });

    it("should calculate pool statistics correctly", async () => {
      // Mock pool status with multiple active processes
      vi.mocked(mockProcessPool.getStatus).mockReturnValue({
        processes: {
          "external->team-alpha": {
            pid: 12345,
            sessionId: "session-123",
            messageCount: 5,
            lastActivity: Date.now(),
            status: "idle",
            messagesProcessed: 5,
            lastUsed: Date.now(),
            uptime: 60000,
            idleTimeRemaining: 240000,
            queueLength: 0,
          },
          "external->team-beta": {
            pid: 12346,
            sessionId: "session-456",
            messageCount: 3,
            lastActivity: Date.now(),
            status: "processing",
            messagesProcessed: 3,
            lastUsed: Date.now(),
            uptime: 30000,
            idleTimeRemaining: 270000,
            queueLength: 1,
          },
        },
        maxProcesses: 10,
      });

      const result = await isAwake({}, mockIris, mockProcessPool, mockConfigManager);

      expect(result.pool).toEqual({
        activeProcesses: 2,
        maxProcesses: 10,
        totalMessages: 8, // 5 + 3
      });
    });
  });

  describe("notification statistics", () => {
    it("should include notification stats when includeNotifications is true", async () => {
      const result = await isAwake(
        { includeNotifications: true },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.notifications).toEqual({
        pending: 0,
        total: 0,
      });
    });

    it("should not include notification stats when includeNotifications is false", async () => {
      const result = await isAwake(
        { includeNotifications: false },
        mockIris,
        mockProcessPool,
        mockConfigManager
      );

      expect(result.notifications).toBeUndefined();
    });
  });

  describe("team sorting", () => {
    it("should sort teams alphabetically by name", async () => {
      // Add more teams to test sorting
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {
          "team-charlie": { path: "/path/charlie" },
          "team-alpha": { path: "/path/alpha" },
          "team-beta": { path: "/path/beta" },
          "team-delta": { path: "/path/delta" },
        },
      });

      const result = await isAwake({}, mockIris, mockProcessPool, mockConfigManager);

      const teamNames = result.teams.map(t => t.name);
      expect(teamNames).toEqual([
        "team-alpha",
        "team-beta",
        "team-charlie",
        "team-delta",
      ]);
    });
  });

  describe("error handling", () => {
    it("should propagate config manager errors", async () => {
      vi.mocked(mockConfigManager.getConfig).mockImplementation(() => {
        throw new Error("Config error");
      });

      await expect(
        isAwake({}, mockIris, mockProcessPool, mockConfigManager)
      ).rejects.toThrow("Config error");
    });

    it("should propagate process pool errors", async () => {
      vi.mocked(mockProcessPool.getStatus).mockImplementation(() => {
        throw new Error("Pool error");
      });

      await expect(
        isAwake({}, mockIris, mockProcessPool, mockConfigManager)
      ).rejects.toThrow("Pool error");
    });
  });
});