/**
 * Unit tests for ClaudeProcessPool
 *
 * Focused on testing the new architecture:
 * - Session-based process pooling
 * - BasicProcessMetrics API
 * - LRU eviction
 * - Health checks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger BEFORE imports using hoisting
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { TeamsConfig } from "../../../src/process-pool/types.js";

// Mock ClaudeProcess with proper EventEmitter interface and RxJS observables
vi.mock("../../../src/process-pool/claude-process.js", () => {
  const { EventEmitter } = require("events");
  const { BehaviorSubject, Subject } = require("rxjs");

  class MockClaudeProcess extends EventEmitter {
    teamName: string;
    sessionId: string;
    spawn = vi.fn();
    terminate = vi.fn();
    getBasicMetrics = vi.fn();

    // RxJS observables (required by pool-manager)
    status$: any;
    errors$: any;
    private statusSubject: any;
    private errorsSubject: any;

    constructor(teamName: string, config: any, sessionId: string) {
      super();
      this.teamName = teamName;
      this.sessionId = sessionId;

      // Setup RxJS observables
      this.statusSubject = new BehaviorSubject("stopped");
      this.errorsSubject = new Subject();
      this.status$ = this.statusSubject.asObservable();
      this.errors$ = this.errorsSubject.asObservable();

      // Setup spawn to resolve immediately and update status
      this.spawn.mockImplementation(async () => {
        this.statusSubject.next("idle");
      });

      // Setup terminate to emit "terminated" event, update status, and resolve
      this.terminate.mockImplementation(async () => {
        this.statusSubject.next("stopped");
        this.emit("terminated", {
          teamName: this.teamName,
          sessionId: this.sessionId,
        });
      });

      // Setup default metrics
      this.getBasicMetrics.mockReturnValue({
        teamName,
        pid: 12345,
        uptime: 1000,
        status: "idle",
        isReady: true,
        isSpawning: false,
        isBusy: false,
        messagesProcessed: 0,
        queueLength: 0,
        messageCount: 0,
      });
    }
  }

  return {
    ClaudeProcess: MockClaudeProcess,
    ProcessStatus: {
      STOPPED: "stopped",
      SPAWNING: "spawning",
      IDLE: "idle",
      PROCESSING: "processing",
    },
  };
});

describe("ClaudeProcessPool", () => {
  let pool: ClaudeProcessPool;
  let testConfig: TeamsConfig;
  let mockConfigManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    testConfig = {
      settings: {
        idleTimeout: 300000,
        maxProcesses: 3,
        healthCheckInterval: 30000,
        sessionInitTimeout: 30000,
        responseTimeout: 120000,
      },
      teams: {
        "team-alpha": {
          path: "/path/to/alpha",
          description: "Alpha team",
          skipPermissions: true,
        },
        "team-beta": {
          path: "/path/to/beta",
          description: "Beta team",
          skipPermissions: true,
        },
        "team-gamma": {
          path: "/path/to/gamma",
          description: "Gamma team",
          skipPermissions: true,
        },
      },
    };

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue(testConfig),
      getIrisConfig: vi.fn(
        (teamName: string) => testConfig.teams[teamName] || null,
      ),
    };

    pool = new ClaudeProcessPool(mockConfigManager, testConfig.settings);
  });

  afterEach(async () => {
    if (pool) {
      try {
        await pool.terminateAll();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create pool with config", () => {
      expect(pool).toBeDefined();
      expect(pool.getConfig()).toMatchObject(testConfig);
    });

    it("should be an EventEmitter", () => {
      expect(pool.on).toBeDefined();
      expect(pool.emit).toBeDefined();
    });
  });

  describe("getOrCreateProcess", () => {
    it("should create new process for team", async () => {
      const process = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123",
        "team-beta",
      );

      expect(process).toBeDefined();
      expect(process.teamName).toBe("team-alpha");
      expect(process.sessionId).toBe("session-123");
      expect(process.spawn).toHaveBeenCalled();
    });

    it("should return existing process for same team", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123",
        "team-beta",
      );
      const process2 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123",
        "team-beta",
      );

      expect(process1).toBe(process2);
      // spawn should only be called once since we're reusing the process
      expect(process1.spawn).toHaveBeenCalledTimes(1);
    });

    it("should create different processes for different fromTeam values", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-1",
        "team-beta",
      );
      const process2 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-2",
        "team-gamma",
      );

      // Different fromTeam values should create different processes (different pool keys)
      expect(process1).not.toBe(process2);
      expect(process1.teamName).toBe("team-alpha");
      expect(process2.teamName).toBe("team-alpha");
    });
  });

  describe("getProcess", () => {
    it("should return undefined for non-existent process", () => {
      const process = pool.getProcess("team-alpha");

      expect(process).toBeUndefined();
    });

    it("should return existing process", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123", "team-beta");

      const process = pool.getProcess("team-alpha");

      expect(process).toBeDefined();
    });
  });

  describe("getProcessBySessionId", () => {
    it("should return undefined for non-existent session", () => {
      const process = pool.getProcessBySessionId("non-existent-session");

      expect(process).toBeUndefined();
    });

    it("should return process for existing session", async () => {
      const createdProcess = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123",
        "team-beta",
      );

      const retrievedProcess = pool.getProcessBySessionId("session-123");

      expect(retrievedProcess).toBeDefined();
      expect(retrievedProcess).toBe(createdProcess);
      expect(retrievedProcess?.teamName).toBe("team-alpha");
      expect(retrievedProcess?.sessionId).toBe("session-123");
    });

    it("should distinguish between different sessions", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-1",
        "team-beta",
      );
      const process2 = await pool.getOrCreateProcess(
        "team-beta",
        "session-2",
        "team-gamma",
      );

      const retrieved1 = pool.getProcessBySessionId("session-1");
      const retrieved2 = pool.getProcessBySessionId("session-2");

      expect(retrieved1).toBe(process1);
      expect(retrieved2).toBe(process2);
      expect(retrieved1).not.toBe(retrieved2);
    });

    it("should return undefined after process termination", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123", "team-beta");

      // Verify process exists
      expect(pool.getProcessBySessionId("session-123")).toBeDefined();

      // Terminate process
      await pool.terminateProcess("team-alpha");

      // Should no longer find process
      expect(pool.getProcessBySessionId("session-123")).toBeUndefined();
    });

    it("should handle multiple processes with different sessions", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-1",
        "team-beta",
      );
      const process2 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-2",
        "team-gamma",
      );
      const process3 = await pool.getOrCreateProcess(
        "team-beta",
        "session-3",
        "team-alpha",
      );

      expect(pool.getProcessBySessionId("session-1")).toBe(process1);
      expect(pool.getProcessBySessionId("session-2")).toBe(process2);
      expect(pool.getProcessBySessionId("session-3")).toBe(process3);
    });

    it("should work correctly after LRU eviction", async () => {
      // Fill pool to max
      await pool.getOrCreateProcess("team-alpha", "session-1", "team-beta");
      await pool.getOrCreateProcess("team-beta", "session-2", "team-beta");
      const process3 = await pool.getOrCreateProcess(
        "team-gamma",
        "session-3",
        "team-beta",
      );

      // Add team-delta to config
      mockConfigManager.getIrisConfig = vi.fn((teamName: string) => {
        if (teamName === "team-delta") {
          return {
            path: "/path/to/delta",
            description: "Delta team",
            skipPermissions: true,
          };
        }
        return testConfig.teams[teamName] || null;
      });

      // This should evict session-1
      const process4 = await pool.getOrCreateProcess(
        "team-delta",
        "session-4",
        "team-beta",
      );

      // Evicted session should return undefined
      expect(pool.getProcessBySessionId("session-1")).toBeUndefined();

      // Active sessions should still work
      expect(pool.getProcessBySessionId("session-3")).toBe(process3);
      expect(pool.getProcessBySessionId("session-4")).toBe(process4);
    });

    it("should handle empty session ID", () => {
      const process = pool.getProcessBySessionId("");

      expect(process).toBeUndefined();
    });
  });

  describe("terminateProcess", () => {
    it("should terminate specific process", async () => {
      const process = await pool.getOrCreateProcess(
        "team-alpha",
        "session-123",
        "team-beta",
      );

      await pool.terminateProcess("team-alpha");

      expect(process.terminate).toHaveBeenCalled();
      expect(pool.getProcess("team-alpha")).toBeUndefined();
    });

    it("should not throw for non-existent process", async () => {
      await expect(pool.terminateProcess("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("terminateAll", () => {
    it("should terminate all processes", async () => {
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-1",
        "team-beta",
      );
      const process2 = await pool.getOrCreateProcess(
        "team-beta",
        "session-2",
        "team-beta",
      );

      await pool.terminateAll();

      expect(process1.terminate).toHaveBeenCalled();
      expect(process2.terminate).toHaveBeenCalled();
      expect(pool.getProcess("team-alpha")).toBeUndefined();
      expect(pool.getProcess("team-beta")).toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("should return empty status initially", () => {
      const status = pool.getStatus();

      expect(status).toMatchObject({
        maxProcesses: 3,
        processes: {},
      });
    });

    it("should return process status", async () => {
      await pool.getOrCreateProcess("team-alpha", "session-123", "team-beta");

      const status = pool.getStatus();

      // With session-based architecture, the pool key is "team-beta->team-alpha"
      const poolKey = "team-beta->team-alpha";
      expect(status.processes[poolKey]).toBeDefined();
      expect(status.processes[poolKey].pid).toBe(12345);
      expect(status.processes[poolKey].sessionId).toBe("session-123");
    });
  });

  describe("LRU eviction", () => {
    it("should evict least recently used when maxProcesses exceeded", async () => {
      // Fill pool to max
      const process1 = await pool.getOrCreateProcess(
        "team-alpha",
        "session-1",
        "team-beta",
      );
      const process2 = await pool.getOrCreateProcess(
        "team-beta",
        "session-2",
        "team-beta",
      );
      const process3 = await pool.getOrCreateProcess(
        "team-gamma",
        "session-3",
        "team-beta",
      );

      // Access process2 and process3 to make process1 LRU
      pool.getProcess("team-beta");
      pool.getProcess("team-gamma");

      // Add team-delta to config for this test
      mockConfigManager.getIrisConfig = vi.fn((teamName: string) => {
        if (teamName === "team-delta") {
          return {
            path: "/path/to/delta",
            description: "Delta team",
            skipPermissions: true,
          };
        }
        return testConfig.teams[teamName] || null;
      });

      // This should evict team-alpha (LRU)
      await pool.getOrCreateProcess("team-delta", "session-4", "team-beta");

      expect(process1.terminate).toHaveBeenCalled();
      expect(pool.getProcess("team-alpha")).toBeUndefined();
      expect(pool.getProcess("team-beta")).toBeDefined();
      expect(pool.getProcess("team-gamma")).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should throw for unknown team", async () => {
      await expect(
        pool.getOrCreateProcess("unknown-team", "session-123", "team-beta"),
      ).rejects.toThrow("not found in configuration");
    });

    it("should return config", () => {
      const config = pool.getConfig();

      expect(config).toMatchObject(testConfig);
      expect(config.teams["team-alpha"]).toBeDefined();
    });
  });
});
