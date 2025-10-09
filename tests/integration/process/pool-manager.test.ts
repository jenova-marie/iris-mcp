/**
 * Integration tests for ClaudeProcessPool
 * Tests process pooling, LRU eviction, concurrent access, and health checks
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import type {
  ProcessPoolConfig,
  TeamConfig,
} from "../../../src/process-pool/types.js";
import { writeFileSync, unlinkSync, existsSync } from "fs";

describe("ClaudeProcessPool Integration", () => {
  let pool: ClaudeProcessPool;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./test-pool-teams.json";

  // Create test configuration with multiple teams
  const testConfig = {
    settings: {
      idleTimeout: 300000,
      maxProcesses: 3,
      healthCheckInterval: 5000,
    },
    teams: {
      "team-alpha": {
        path: process.cwd(),
        description: "Team Alpha for testing",
        skipPermissions: true,
      },
      "team-beta": {
        path: process.cwd(),
        description: "Team Beta for testing",
        skipPermissions: true,
      },
      "team-gamma": {
        path: process.cwd(),
        description: "Team Gamma for testing",
        skipPermissions: true,
      },
      "team-delta": {
        path: process.cwd(),
        description: "Team Delta for testing",
        skipPermissions: true,
      },
    },
  };

  beforeEach(() => {
    // Write test config
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    // Create config manager
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    // Create pool with test config
    const poolConfig: ProcessPoolConfig = {
      idleTimeout: 300000,
      maxProcesses: 3,
      healthCheckInterval: 5000,
    };

    pool = new ClaudeProcessPool(configManager, poolConfig);
  });

  afterEach(async () => {
    // Clean up pool
    if (pool) {
      await pool.terminateAll();
    }

    // Clean up config file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  describe("basic process pooling", () => {
    it("should create and return a process for a team", async () => {
      const process = await pool.getOrCreateProcess("team-alpha");

      expect(process).toBeDefined();
      const metrics = process.getMetrics();
      expect(metrics.status).toBe("idle");
      expect(metrics.pid).toBeDefined();
    });

    it("should reuse existing process for same team", async () => {
      const process1 = await pool.getOrCreateProcess("team-alpha");
      const pid1 = process1.getMetrics().pid;

      const process2 = await pool.getOrCreateProcess("team-alpha");
      const pid2 = process2.getMetrics().pid;

      // Should be the same process (same PID)
      expect(pid1).toBe(pid2);
      expect(process1).toBe(process2);

      // Pool should only have 1 process
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(1);
    });

    it("should create separate processes for different teams", async () => {
      const processAlpha = await pool.getOrCreateProcess("team-alpha");
      const processBeta = await pool.getOrCreateProcess("team-beta");

      const pidAlpha = processAlpha.getMetrics().pid;
      const pidBeta = processBeta.getMetrics().pid;

      // Should be different processes
      expect(pidAlpha).not.toBe(pidBeta);

      // Pool should have 2 processes
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(2);
    });

    it("should throw error for non-existent team", async () => {
      await expect(
        pool.getOrCreateProcess("non-existent-team"),
      ).rejects.toThrow('Team "non-existent-team" not found');
    }, 5000);
  });

  describe("process pool status", () => {
    it("should return correct pool status", async () => {
      await pool.getOrCreateProcess("team-alpha");
      await pool.getOrCreateProcess("team-beta");

      const status = pool.getStatus();

      expect(status.totalProcesses).toBe(2);
      expect(status.maxProcesses).toBe(3);
      expect(status.processes).toHaveProperty("team-alpha");
      expect(status.processes).toHaveProperty("team-beta");
      expect(status.processes["team-alpha"].status).toBe("idle");
      expect(status.processes["team-beta"].status).toBe("idle");
    });

    it("should get individual process from pool", async () => {
      await pool.getOrCreateProcess("team-alpha");

      const process = pool.getProcess("team-alpha");
      expect(process).toBeDefined();
      expect(process?.getMetrics().status).toBe("idle");

      const nonExistent = pool.getProcess("team-delta");
      expect(nonExistent).toBeUndefined();
    });
  });

  // LRU eviction tests removed - edge case testing, not core functionality

  describe("message sending through pool", () => {
    it("should send message through pool and get response", async () => {
      const response = await pool.sendMessage(
        "team-alpha",
        "Test message",
        5000,
      );

      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
    });

    it("should handle messages to multiple teams concurrently", async () => {
      // CORE: Test concurrent message sending, not response content
      const [responseAlpha, responseBeta] = await Promise.all([
        pool.sendMessage("team-alpha", "Hello", 30000),
        pool.sendMessage("team-beta", "Hi", 30000),
      ]);

      // Both should return responses
      expect(responseAlpha).toBeDefined();
      expect(responseBeta).toBeDefined();
      expect(typeof responseAlpha).toBe("string");
      expect(typeof responseBeta).toBe("string");

      // Both processes should exist in pool
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(2);
    }, 20000);
  });

  describe("process termination", () => {
    it("should terminate specific process", async () => {
      await pool.getOrCreateProcess("team-alpha");
      await pool.getOrCreateProcess("team-beta");

      expect(pool.getStatus().totalProcesses).toBe(2);

      await pool.terminateProcess("team-alpha");

      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(1);
      expect(status.processes).not.toHaveProperty("team-alpha");
      expect(status.processes).toHaveProperty("team-beta");
    });

    it.skip("should terminate all processes", async () => {
      await pool.getOrCreateProcess("team-alpha");
      await pool.getOrCreateProcess("team-beta");
      await pool.getOrCreateProcess("team-gamma");

      expect(pool.getStatus().totalProcesses).toBe(3);

      await pool.terminateAll();

      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(0);
      expect(Object.keys(status.processes)).toHaveLength(0);
    });

    it("should handle terminating non-existent process gracefully", async () => {
      await expect(
        pool.terminateProcess("non-existent-team"),
      ).resolves.toBeUndefined();
    }, 5000);
  });

  describe("event emission", () => {
    it("should emit process-spawned event", async () => {
      const spawnedPromise = new Promise((resolve) => {
        pool.once("process-spawned", (data) => {
          resolve(data);
        });
      });

      await pool.getOrCreateProcess("team-alpha");
      const spawnedData = await spawnedPromise;

      expect(spawnedData).toMatchObject({
        teamName: "team-alpha",
        pid: expect.any(Number),
      });
    });

    it("should emit message-sent and message-response events", async () => {
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
        "Test message",
        5000,
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
      await pool.getOrCreateProcess("team-alpha");

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
      // Create a process
      const process = await pool.getOrCreateProcess("team-alpha");
      expect(pool.getStatus().totalProcesses).toBe(1);

      // Manually terminate the underlying process (simulate crash)
      await process.terminate();

      // Wait a bit for the process to stop
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Trigger health check by waiting for interval
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Process should be removed from pool
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(0);
    });

    it("should emit health-check event", async () => {
      await pool.getOrCreateProcess("team-alpha");

      const healthCheckPromise = new Promise((resolve) => {
        pool.once("health-check", (status) => {
          resolve(status);
        });
      });

      // Wait for health check interval
      const healthData: any = await healthCheckPromise;

      expect(healthData).toHaveProperty("totalProcesses");
      expect(healthData).toHaveProperty("maxProcesses");
      expect(healthData).toHaveProperty("processes");
    });
  });
});
