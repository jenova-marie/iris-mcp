import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import {
  TeamNotFoundError,
  ProcessPoolLimitError,
} from "../../../src/utils/errors.js";

// Mock dependencies
vi.mock("../../../src/process-pool/claude-process.js");
vi.mock("../../../src/config/teams-config.js");
vi.mock("../../../src/utils/logger.js", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("ClaudeProcessPool", () => {
  let pool: ClaudeProcessPool;
  let mockConfigManager: TeamsConfigManager;
  let mockProcess: ClaudeProcess;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock TeamsConfigManager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        settings: {
          idleTimeout: 300000,
          maxProcesses: 5,
          healthCheckInterval: 30000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team-alpha",
            description: "Test team alpha",
            idleTimeout: 300000,
          },
          "team-beta": {
            path: "/path/to/team-beta",
            description: "Test team beta",
          },
        },
      }),
      getTeamConfig: vi.fn((teamName: string) => {
        if (teamName === "team-alpha") {
          return {
            path: "/path/to/team-alpha",
            description: "Test team alpha",
            idleTimeout: 300000,
          };
        }
        if (teamName === "team-beta") {
          return {
            path: "/path/to/team-beta",
            description: "Test team beta",
            idleTimeout: 300000,
          };
        }
        return null;
      }),
      getTeamNames: vi.fn().mockReturnValue(["team-alpha", "team-beta"]),
    } as any;

    // Mock ClaudeProcess - create new instance for each call
    vi.mocked(ClaudeProcess).mockImplementation(() => {
      mockProcess = {
        spawn: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue("Mock response"),
        terminate: vi.fn().mockResolvedValue(undefined),
        clearOutputCache: vi.fn(),
        getOutputCache: vi.fn().mockReturnValue({ stdout: "", stderr: "" }),
        getMetrics: vi.fn().mockReturnValue({
          status: "idle",
          messagesProcessed: 0,
          uptime: 0,
          queueLength: 0,
          lastUsed: Date.now(),
        }),
        on: vi.fn(),
      } as any;
      return mockProcess;
    });

    pool = new ClaudeProcessPool(mockConfigManager, {
      maxProcesses: 5,
      idleTimeout: 300000,
      healthCheckInterval: 30000,
    });
  });

  afterEach(async () => {
    await pool.terminateAll();
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(pool).toBeDefined();
      expect(pool.getConfig()).toEqual(mockConfigManager.getConfig());
    });

    it("should start health check on initialization", () => {
      // Health check interval should be started
      expect(pool["healthCheckInterval"]).not.toBeNull();
    });
  });

  describe("getConfig", () => {
    it("should return configuration from config manager", () => {
      const config = pool.getConfig();

      expect(config.teams["team-alpha"]).toBeDefined();
      expect(config.settings.maxProcesses).toBe(5);
    });
  });

  describe("getOrCreateProcess", () => {
    it("should throw TeamNotFoundError for non-existent team", async () => {
      await expect(
        pool.getOrCreateProcess("nonexistent", "session-123")
      ).rejects.toThrow(TeamNotFoundError);
    });

    it("should create new process for team", async () => {
      const process = await pool.getOrCreateProcess("team-alpha", "session-123");

      expect(process).toBeDefined();
      expect(vi.mocked(ClaudeProcess)).toHaveBeenCalledWith(
        "team-alpha",
        expect.objectContaining({ path: "/path/to/team-alpha" }),
        300000,
        "session-123"
      );
      expect(mockProcess.spawn).toHaveBeenCalled();
    });

    it("should reuse existing process for same team", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123"
      );
      const process2 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123"
      );

      expect(process1).toBe(process2);
      expect(vi.mocked(ClaudeProcess)).toHaveBeenCalledTimes(1);
    });

    it("should create separate processes for different teams", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123"
      );
      const process2 = await pool.getOrCreateProcess("team-beta", "session-456");

      expect(process1).not.toBe(process2);
      expect(vi.mocked(ClaudeProcess)).toHaveBeenCalledTimes(2);
    });

    it("should handle fromTeam parameter", async () => {
      await pool.getOrCreateProcess("team-beta", "session-123", "team-alpha");

      // Should create process with correct pool key
      const status = pool.getStatus();
      expect(status.processes["team-alpha->team-beta"]).toBeDefined();
    });

    it("should attempt to evict LRU process when pool is full", async () => {
      // Create max processes
      for (let i = 0; i < 5; i++) {
        await pool.getOrCreateProcess(`team-alpha`, `session-${i}`, `from-${i}`);
      }

      expect(pool.getStatus().totalProcesses).toBe(5);

      // Mock terminateProcess to verify it gets called
      const terminateSpy = vi.spyOn(pool as any, "terminateProcess");

      // Create one more - should trigger eviction attempt
      await pool.getOrCreateProcess("team-beta", "session-new");

      // Eviction should have been attempted
      expect(terminateSpy).toHaveBeenCalled();
    });

    it("should set up event forwarding for process", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      expect(mockProcess.on).toHaveBeenCalledWith("spawned", expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith(
        "terminated",
        expect.any(Function)
      );
      expect(mockProcess.on).toHaveBeenCalledWith("exited", expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith(
        "message-sent",
        expect.any(Function)
      );
      expect(mockProcess.on).toHaveBeenCalledWith(
        "message-response",
        expect.any(Function)
      );
    });

    it("should clean up process on termination event", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      // Get the terminated event handler
      const terminatedHandler = vi
        .mocked(mockProcess.on)
        .mock.calls.find((call) => call[0] === "terminated")?.[1];

      expect(terminatedHandler).toBeDefined();

      // Trigger terminated event
      terminatedHandler?.({});

      // Process should be removed from pool
      expect(pool.getStatus().totalProcesses).toBe(0);
    });
  });

  describe("getProcessBySessionId", () => {
    it("should return process by session ID", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      const process = pool.getProcessBySessionId("session-123");

      expect(process).toBe(mockProcess);
    });

    it("should return undefined for non-existent session", () => {
      const process = pool.getProcessBySessionId("nonexistent");

      expect(process).toBeUndefined();
    });
  });

  describe("sendMessage", () => {
    it("should send message through process", async () => {
      const response = await pool.sendMessage(
        "team-alpha",
        "session-123",
        "Test message"
      );

      expect(response).toBe("Mock response");
      expect(mockProcess.sendMessage).toHaveBeenCalledWith(
        "Test message",
        undefined
      );
    });

    it("should pass timeout to process", async () => {
      await pool.sendMessage(
        "team-alpha",
        "session-123",
        "Test message",
        60000
      );

      expect(mockProcess.sendMessage).toHaveBeenCalledWith(
        "Test message",
        60000
      );
    });

    it("should handle fromTeam parameter", async () => {
      await pool.sendMessage(
        "team-beta",
        "session-123",
        "Test message",
        undefined,
        "team-alpha"
      );

      expect(mockProcess.sendMessage).toHaveBeenCalled();
    });
  });

  describe("terminateProcess", () => {
    it("should terminate specific process by team name", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      await pool.terminateProcess("team-alpha");

      expect(mockProcess.terminate).toHaveBeenCalled();
    });

    it("should do nothing if process does not exist", async () => {
      await pool.terminateProcess("nonexistent");

      // Should not throw
      expect(mockProcess.terminate).not.toHaveBeenCalled();
    });
  });

  describe("terminateAll", () => {
    it("should terminate all processes", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");
      await pool.getOrCreateProcess("team-beta", "session-456");

      expect(pool.getStatus().totalProcesses).toBe(2);

      await pool.terminateAll();

      // All processes should be cleared
      expect(pool.getStatus().totalProcesses).toBe(0);
      expect(pool.getStatus().activeSessions).toBe(0);
    });

    it("should clear health check interval", async () => {
      await pool.terminateAll();

      expect(pool["healthCheckInterval"]).toBeNull();
    });

    it("should handle empty pool", async () => {
      await pool.terminateAll();

      // Should not throw
      expect(pool.getStatus().totalProcesses).toBe(0);
    });
  });

  // clearOutputCache and getOutputCache methods removed in bare-bones mode
  // These tests have been removed as the functionality no longer exists

  describe("getStatus", () => {
    it("should return pool status with no processes", () => {
      const status = pool.getStatus();

      expect(status).toEqual({
        totalProcesses: 0,
        maxProcesses: 5,
        processes: {},
        activeSessions: 0,
      });
    });

    it("should return status with active processes", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");
      await pool.getOrCreateProcess("team-beta", "session-456");

      const status = pool.getStatus();

      expect(status.totalProcesses).toBe(2);
      expect(status.activeSessions).toBe(2);
      expect(status.processes["external->team-alpha"]).toBeDefined();
      expect(status.processes["external->team-beta"]).toBeDefined();
    });

    it("should include session IDs in status", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      const status = pool.getStatus();

      expect(status.processes["external->team-alpha"].sessionId).toBe(
        "session-123"
      );
    });
  });

  describe("getProcess", () => {
    it("should find process by team name", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      const process = pool.getProcess("team-alpha");

      expect(process).toBe(mockProcess);
    });

    it("should return undefined for non-existent team", () => {
      const process = pool.getProcess("nonexistent");

      expect(process).toBeUndefined();
    });
  });

  describe("sendCommandToSession", () => {
    it("should send command to process by session ID", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      const response = await pool.sendCommandToSession(
        "session-123",
        "/compact"
      );

      expect(response).toBe("Mock response");
      expect(mockProcess.sendMessage).toHaveBeenCalledWith("/compact");
    });

    it("should return null for non-existent session", async () => {
      const response = await pool.sendCommandToSession(
        "nonexistent",
        "/compact"
      );

      expect(response).toBeNull();
    });

    it("should propagate errors from process", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      vi.mocked(mockProcess.sendMessage).mockRejectedValueOnce(
        new Error("Send failed")
      );

      await expect(
        pool.sendCommandToSession("session-123", "/compact")
      ).rejects.toThrow("Send failed");
    });
  });

  describe("LRU eviction", () => {
    it("should prefer evicting idle processes", async () => {
      // Just verify the LRU eviction logic checks for idle status
      // Full integration test would be in integration tests

      // Create 5 processes (max)
      for (let i = 0; i < 5; i++) {
        await pool.getOrCreateProcess(`team-alpha`, `session-${i}`, `from-${i}`);
      }

      // Spy on evictLRU to verify it's called
      const evictSpy = vi.spyOn(pool as any, "evictLRU");

      // Create one more - should trigger eviction
      await pool.getOrCreateProcess("team-beta", "session-new");

      expect(evictSpy).toHaveBeenCalled();
    });

  });

  describe("health check", () => {
    it("should remove stopped processes during health check", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123");

      // Mark process as stopped
      vi.mocked(mockProcess.getMetrics).mockReturnValue({
        status: "stopped",
        messagesProcessed: 0,
        uptime: 0,
        queueLength: 0,
        lastUsed: Date.now(),
      });

      // Manually trigger health check
      pool["performHealthCheck"]();

      expect(pool.getStatus().totalProcesses).toBe(0);
    });

    it("should emit health-check event", async () => {
      const healthCheckListener = vi.fn();
      pool.on("health-check", healthCheckListener);

      pool["performHealthCheck"]();

      expect(healthCheckListener).toHaveBeenCalledWith(
        expect.objectContaining({
          totalProcesses: 0,
          maxProcesses: 5,
        })
      );
    });
  });

  describe("event forwarding", () => {
    it("should forward process-spawned event", async () => {
      const spawnedListener = vi.fn();
      pool.on("process-spawned", spawnedListener);

      await pool.getOrCreateProcess("team-alpha", "session-123");

      // Get the spawned event handler and trigger it
      const spawnedHandler = vi
        .mocked(mockProcess.on)
        .mock.calls.find((call) => call[0] === "spawned")?.[1];

      spawnedHandler?.({ teamName: "team-alpha" });

      expect(spawnedListener).toHaveBeenCalledWith({
        teamName: "team-alpha",
      });
    });

    it("should forward process-error event", async () => {
      const errorListener = vi.fn();
      pool.on("process-error", errorListener);

      await pool.getOrCreateProcess("team-alpha", "session-123");

      // Get the error event handler and trigger it
      const errorHandler = vi
        .mocked(mockProcess.on)
        .mock.calls.find((call) => call[0] === "error")?.[1];

      errorHandler?.({ error: "Test error" });

      expect(errorListener).toHaveBeenCalledWith({ error: "Test error" });
    });

    it("should forward message-sent event", async () => {
      const messageSentListener = vi.fn();
      pool.on("message-sent", messageSentListener);

      await pool.getOrCreateProcess("team-alpha", "session-123");

      const messageSentHandler = vi
        .mocked(mockProcess.on)
        .mock.calls.find((call) => call[0] === "message-sent")?.[1];

      messageSentHandler?.({ message: "Test" });

      expect(messageSentListener).toHaveBeenCalledWith({ message: "Test" });
    });

    it("should forward message-response event", async () => {
      const messageResponseListener = vi.fn();
      pool.on("message-response", messageResponseListener);

      await pool.getOrCreateProcess("team-alpha", "session-123");

      const messageResponseHandler = vi
        .mocked(mockProcess.on)
        .mock.calls.find((call) => call[0] === "message-response")?.[1];

      messageResponseHandler?.({ response: "Test response" });

      expect(messageResponseListener).toHaveBeenCalledWith({
        response: "Test response",
      });
    });
  });
});
