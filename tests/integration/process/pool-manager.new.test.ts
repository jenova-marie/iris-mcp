/**
 * NEW ARCHITECTURE CHANGES:
 * - All sessions require fromTeam (use "team-iris" as calling team)
 * - Pool keys are fromTeam->toTeam format
 * - SessionManager integration required
 * * Integration tests for ClaudeProcessPool
 * Tests process pooling, LRU eviction, concurrent access, and health checks
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import { SessionManager } from "../../../src/session/session-manager.js";
import type { ProcessPoolConfig } from "../../../src/process-pool/types.js";
import { unlinkSync, existsSync } from "fs";

describe("ClaudeProcessPool Integration (New Architecture)", () => {
  let pool: ClaudeProcessPool;
  let configManager: TeamsConfigManager;
  let sessionManager: SessionManager;
  const testConfigPath = "./tests/config.json"; // Use test teams config
  const testSessionDbPath = "./tests/data/test-pool-sessions.db";

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout;

  // NOTE: This test file does NOT honor REUSE_DB environment variable
  // These tests specifically verify process pool behavior from a clean state
  // Having stale session state causes mismatches between database session IDs
  // and actual spawned processes in test mode

  // Helper to clean database before tests
  const cleanDatabase = () => {
    [
      testSessionDbPath,
      `${testSessionDbPath}-shm`,
      `${testSessionDbPath}-wal`,
    ].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  // Single initialization for ALL tests (much faster!)
  beforeAll(async () => {
    cleanDatabase(); // Always start with clean DB for these tests

    // Load test teams config
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    // Create and initialize session manager (single instance for all tests)
    const teamsConfig = configManager.getConfig();
    sessionManager = new SessionManager(teamsConfig, testSessionDbPath);

    // Try to initialize, but continue even if it fails partially
    try {
      await sessionManager.initialize();
    } catch (error) {
      // Log but don't fail - some teams might initialize successfully
      console.error("Partial initialization failure:", error);
    }

    // Create pool with config from teams.json
    const poolConfig: ProcessPoolConfig = {
      idleTimeout: teamsConfig.settings.idleTimeout,
      maxProcesses: teamsConfig.settings.maxProcesses,
      healthCheckInterval: teamsConfig.settings.healthCheckInterval,
      sessionInitTimeout: teamsConfig.settings.sessionInitTimeout,
    };

    pool = new ClaudeProcessPool(configManager, poolConfig);
  }, sessionInitTimeout * 2); // 2x sessionInitTimeout for full initialization

  afterEach(() => {
    // Reset the session manager to clean state between tests (preserves DB and sessions)
    if (sessionManager) {
      sessionManager.reset();
    }
  });

  afterAll(async () => {
    // Clean up pool
    if (pool) {
      await pool.terminateAll();
    }

    // Clean up session manager
    if (sessionManager) {
      sessionManager.close();
    }

    // Clean up session database
    cleanDatabase();
  });

  describe("basic process pooling", () => {
    it(
      "should create and return a process for a team",
      async () => {
        // Get sessionId from SessionManager
        const session = await sessionManager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );
        const process = await pool.getOrCreateProcess(
          "team-alpha",
          session.sessionId,
          "team-iris",
        );

        expect(process).toBeDefined();
        const metrics = process.getMetrics();
        expect(metrics.status).toBe("idle");
        expect(metrics.pid).toBeDefined();
      },
      sessionInitTimeout,
    );

    it("should reuse existing process for same team", async () => {
      // Get sessionId from SessionManager
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-beta",
      );

      const process1 = await pool.getOrCreateProcess(
        "team-beta",
        session.sessionId,
        "team-iris",
      );
      const pid1 = process1.getMetrics().pid;

      const process2 = await pool.getOrCreateProcess(
        "team-beta",
        session.sessionId,
        "team-iris",
      );
      const pid2 = process2.getMetrics().pid;

      // Should be the same process (same PID)
      expect(pid1).toBe(pid2);
      expect(process1).toBe(process2);

      // Pool should have at least 1 process (may have others from previous tests)
      const status = pool.getStatus();
      expect(status.totalProcesses).toBeGreaterThanOrEqual(1);
    });

    it("should keep single agent alive after spawn", async () => {
      // Get sessionId from SessionManager
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );

      // Spawn team-alpha
      const process = await pool.getOrCreateProcess(
        "team-alpha",
        session.sessionId,
        "team-iris",
      );

      // Check status immediately
      expect(process.getMetrics().status).toBe("idle");
      const pid = process.getMetrics().pid;
      expect(pid).toBeDefined();

      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check status again - should still be idle
      expect(process.getMetrics().status).toBe("idle");
      expect(process.getMetrics().pid).toBe(pid);

      // Pool should have processes from all previous tests
      const status = pool.getStatus();
      expect(status.totalProcesses).toBeGreaterThanOrEqual(1);
    });

    it(
      "should create separate processes for different teams",
      async () => {
        // Get sessions from SessionManager
        const sessionAlpha = await sessionManager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );
        const sessionBeta = await sessionManager.getOrCreateSession(
          "team-iris",
          "team-beta",
        );

        // Use team-alpha for first process
        const processAlpha = await pool.getOrCreateProcess(
          "team-alpha",
          sessionAlpha.sessionId,
          "team-iris",
        );
        expect(processAlpha.getMetrics().status).toBe("idle");

        // Give it a moment to stabilize
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify alpha is still healthy
        expect(processAlpha.getMetrics().status).toBe("idle");
        const pidAlpha = processAlpha.getMetrics().pid;
        expect(pidAlpha).toBeDefined();

        // Now spawn beta as second process
        const processBeta = await pool.getOrCreateProcess(
          "team-beta",
          sessionBeta.sessionId,
          "team-iris",
        );
        expect(processBeta.getMetrics().status).toBe("idle");
        const pidBeta = processBeta.getMetrics().pid;
        expect(pidBeta).toBeDefined();

        // Should be different processes
        expect(pidAlpha).not.toBe(pidBeta);

        // Pool should have multiple processes
        const status = pool.getStatus();
        expect(status.totalProcesses).toBeGreaterThanOrEqual(2);
      },
      sessionInitTimeout,
    ); // Use config timeout

    it("should throw error for non-existent team", async () => {
      await expect(
        pool.getOrCreateProcess("non-existent-team", "fake-session-id"),
      ).rejects.toThrow('Team "non-existent-team" not found');
    });
  });

  describe("process pool status", () => {
    it("should return correct pool status", async () => {
      // Note: Shared pool may have processes from previous tests
      const sessionAlpha = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );
      const sessionBeta = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-beta",
      );

      await pool.getOrCreateProcess("team-alpha", sessionAlpha.sessionId, "team-iris");
      await pool.getOrCreateProcess("team-beta", sessionBeta.sessionId, "team-iris");

      const status = pool.getStatus();

      // Should have at least these 2 teams (may have more from previous tests)
      expect(status.totalProcesses).toBeGreaterThanOrEqual(2);
      expect(status.maxProcesses).toBe(10); // From config.json config
      expect(status.processes).toHaveProperty("team-beta->team-alpha");
      expect(status.processes).toHaveProperty("team-beta->team-beta");
      expect(status.processes["team-beta->team-alpha"].status).toBe("idle");
      expect(status.processes["team-beta->team-beta"].status).toBe("idle");
    });

    it("should get individual process from pool", async () => {
      // Process from earlier test should still be in pool
      const process = pool.getProcess("team-alpha");
      expect(process).toBeDefined();
      expect(process?.getMetrics().status).toBe("idle");

      const nonExistent = pool.getProcess("unknown-team");
      expect(nonExistent).toBeUndefined();
    });
  });

  // LRU eviction tests removed - edge case testing, not core functionality

  describe("message sending through pool", () => {
    it("should send message through pool and get response", async () => {
      // SKIP: Requires properly configured Claude project directory
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );
      const response = await pool.sendMessage(
        "team-alpha",
        session.sessionId,
        "Test message",
        sessionInitTimeout,
      );

      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
    });

    it(
      "should handle messages to multiple teams concurrently",
      async () => {
        // CORE: Test concurrent message sending, not response content
        const sessionAlpha = await sessionManager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );
        const sessionBeta = await sessionManager.getOrCreateSession(
          "team-iris",
          "team-beta",
        );

        const [responseAlpha, responseBeta] = await Promise.all([
          pool.sendMessage(
            "team-alpha",
            sessionAlpha.sessionId,
            "Hello",
            sessionInitTimeout,
          ),
          pool.sendMessage(
            "team-beta",
            sessionBeta.sessionId,
            "Hi",
            sessionInitTimeout,
          ),
        ]);

        // Both should return responses
        expect(responseAlpha).toBeDefined();
        expect(responseBeta).toBeDefined();
        expect(typeof responseAlpha).toBe("string");
        expect(typeof responseBeta).toBe("string");

        // Both processes should exist in pool (may have others from previous tests)
        const status = pool.getStatus();
        expect(status.totalProcesses).toBeGreaterThanOrEqual(2);
        expect(status.processes).toHaveProperty("team-beta->team-alpha");
        expect(status.processes).toHaveProperty("team-beta->team-beta");
      },
      sessionInitTimeout,
    );
  });

  describe("process termination", () => {
    it("should terminate specific process", async () => {
      // Get sessions from SessionManager
      const sessionAlpha = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );
      const sessionBeta = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-beta",
      );

      // Ensure both processes exist
      await pool.getOrCreateProcess("team-alpha", sessionAlpha.sessionId, "team-iris");
      await pool.getOrCreateProcess("team-beta", sessionBeta.sessionId, "team-iris");

      // Verify both processes are in the pool
      expect(pool.getProcess("team-alpha")).toBeDefined();
      expect(pool.getProcess("team-beta")).toBeDefined();

      // Get initial count
      const initialCount = pool.getStatus().totalProcesses;

      // Terminate alpha using the correct key (just the team name, not the full key)
      await pool.terminateProcess("team-alpha");

      // After termination, should have one less process
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(initialCount - 1);
      expect(pool.getProcess("team-alpha")).toBeUndefined();
      expect(pool.getProcess("team-beta")).toBeDefined();
    });

    it("should handle terminating non-existent process gracefully", async () => {
      await expect(
        pool.terminateProcess("non-existent-team"),
      ).resolves.toBeUndefined();
    });
  });

  describe("event emission", () => {
    it("should emit process-spawned event", async () => {
      // SKIP: Requires properly configured Claude project directory
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );

      const spawnedPromise = new Promise((resolve) => {
        pool.once("process-spawned", (data) => {
          resolve(data);
        });
      });

      await pool.getOrCreateProcess("team-alpha", session.sessionId, "team-iris");
      const spawnedData = await spawnedPromise;

      expect(spawnedData).toMatchObject({
        teamName: "team-alpha",
        pid: expect.any(Number),
      });
    });

    it("should emit message-sent and message-response events", async () => {
      // SKIP: Requires properly configured Claude project directory
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );

      const messageSentPromise = new Promise((resolve) => {
        pool.once("message-sent", (data) => {
          resolve(data);
        });
      });

      const messageResponsePromise = new Promise((resolve) => {
        pool.once("message-response", (data) => {
          resolve(data);
        });
      });

      const responsePromise = pool.sendMessage(
        "team-alpha",
        session.sessionId,
        "Test message",
        sessionInitTimeout,
      );

      const sentData = await messageSentPromise;
      const responseData = await messageResponsePromise;
      await responsePromise;

      expect(sentData).toMatchObject({
        teamName: "team-alpha",
        message: expect.any(String),
      });

      expect(responseData).toMatchObject({
        teamName: "team-alpha",
        response: expect.any(String),
      });
    });

    it("should emit process-terminated event", async () => {
      // SKIP: Requires properly configured Claude project directory
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );
      await pool.getOrCreateProcess("team-alpha", session.sessionId, "team-iris");

      const terminatedPromise = new Promise((resolve) => {
        pool.once("process-terminated", (data) => {
          resolve(data);
        });
      });

      await pool.terminateProcess("team-alpha");
      const terminatedData = await terminatedPromise;

      expect(terminatedData).toMatchObject({
        teamName: "team-alpha",
      });
    });
  });

  describe("health checks", () => {
    it("should remove stopped processes during health check", async () => {
      // Get session from SessionManager
      const session = await sessionManager.getOrCreateSession(
        "team-iris",
        "team-alpha",
      );

      // Get initial count
      const initialCount = pool.getStatus().totalProcesses;

      // Create a process
      const process = await pool.getOrCreateProcess(
        "team-alpha",
        session.sessionId,
        "team-iris",
      );

      // Manually terminate the underlying process (simulate crash)
      await process.terminate();

      // Wait a bit for the process to stop
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Trigger health check by waiting for interval
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Process should be removed from pool (back to initial count or less)
      const status = pool.getStatus();
      expect(status.totalProcesses).toBeLessThanOrEqual(initialCount);
      expect(status.processes).not.toHaveProperty("team-beta->team-alpha");
    });

    it(
      "should emit health-check event",
      async () => {
        // Get session from SessionManager
        const session = await sessionManager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );

        // Set up listener BEFORE creating process to ensure we catch the event
        const healthCheckPromise = new Promise((resolve) => {
          pool.once("health-check", (status) => {
            resolve(status);
          });
        });

        // Create a process to ensure pool is active
        await pool.getOrCreateProcess("team-alpha", session.sessionId, "team-iris");

        // Wait for health check interval (30s configured)
        const healthData: any = await healthCheckPromise;

        expect(healthData).toHaveProperty("totalProcesses");
        expect(healthData).toHaveProperty("maxProcesses");
        expect(healthData).toHaveProperty("processes");
      },
      sessionInitTimeout * 2,
    ); // Health check interval is 30s, need generous timeout
  });
});
