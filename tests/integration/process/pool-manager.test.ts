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
    }, 15000);

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
    }, 15000);

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
    }, 20000);

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
    }, 20000);

    it("should get individual process from pool", async () => {
      await pool.getOrCreateProcess("team-alpha");

      const process = pool.getProcess("team-alpha");
      expect(process).toBeDefined();
      expect(process?.getMetrics().status).toBe("idle");

      const nonExistent = pool.getProcess("team-delta");
      expect(nonExistent).toBeUndefined();
    }, 15000);
  });

  describe("LRU eviction", () => {
    it("should evict least recently used process when pool is full", async () => {
      // Fill pool to max (3 processes)
      const processAlpha = await pool.getOrCreateProcess("team-alpha");
      const processBeta = await pool.getOrCreateProcess("team-beta");
      const processGamma = await pool.getOrCreateProcess("team-gamma");

      const pidAlpha = processAlpha.getMetrics().pid;

      expect(pool.getStatus().totalProcesses).toBe(3);

      // Access beta and gamma to make alpha the LRU
      await pool.getOrCreateProcess("team-beta");
      await pool.getOrCreateProcess("team-gamma");

      // Create a 4th process - should evict alpha
      const processDelta = await pool.getOrCreateProcess("team-delta");

      // Pool should still have 3 processes
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(3);

      // Alpha should be gone
      expect(status.processes).not.toHaveProperty("team-alpha");

      // Delta should exist
      expect(status.processes).toHaveProperty("team-delta");
    }, 30000);

    it("should evict idle process over busy process", async () => {
      // Create 3 processes
      await pool.getOrCreateProcess("team-alpha");
      await pool.getOrCreateProcess("team-beta");
      const processGamma = await pool.getOrCreateProcess("team-gamma");

      // Start a long-running message on gamma (making it busy)
      const gammaMessagePromise = processGamma.sendMessage(
        "Count from 1 to 5, one number per line",
        60000,
      );

      // Give it time to start processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Access alpha to make beta the LRU idle process
      await pool.getOrCreateProcess("team-alpha");

      // Create delta - should evict beta (idle LRU), not gamma (busy)
      await pool.getOrCreateProcess("team-delta");

      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(3);
      expect(status.processes).not.toHaveProperty("team-beta");
      expect(status.processes).toHaveProperty("team-gamma");
      expect(status.processes).toHaveProperty("team-delta");

      // Wait for gamma message to complete
      await gammaMessagePromise;
    }, 80000);
  });

  describe("message sending through pool", () => {
    it("should send message through pool and get response", async () => {
      const response = await pool.sendMessage(
        "team-alpha",
        "What is 5+5? Reply with just the number.",
        30000,
      );

      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
      expect(response.trim()).toContain("10");
    }, 35000);

    it("should handle messages to multiple teams concurrently", async () => {
      const [responseAlpha, responseBeta] = await Promise.all([
        pool.sendMessage(
          "team-alpha",
          "What is 2+2? Reply with just the number.",
          30000,
        ),
        pool.sendMessage(
          "team-beta",
          "What is 3+3? Reply with just the number.",
          30000,
        ),
      ]);

      expect(responseAlpha).toBeDefined();
      expect(responseBeta).toBeDefined();
      expect(responseAlpha.trim()).toContain("4");
      expect(responseBeta.trim()).toContain("6");

      // Both processes should exist in pool
      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(2);
    }, 40000);
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
    }, 20000);

    it("should terminate all processes", async () => {
      await pool.getOrCreateProcess("team-alpha");
      await pool.getOrCreateProcess("team-beta");
      await pool.getOrCreateProcess("team-gamma");

      expect(pool.getStatus().totalProcesses).toBe(3);

      await pool.terminateAll();

      const status = pool.getStatus();
      expect(status.totalProcesses).toBe(0);
      expect(Object.keys(status.processes)).toHaveLength(0);
    }, 30000);

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
    }, 15000);

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
        "Say hello",
        30000,
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
    }, 35000);

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
    }, 20000);
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
    }, 15000);

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
    }, 15000);
  });
});
