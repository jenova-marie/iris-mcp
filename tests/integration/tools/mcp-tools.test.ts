/**
 * Integration tests for MCP tools
 * Tests tool execution mechanisms without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { teamsAsk } from "../../../src/tools/teams-ask.js";
import { teamsSendMessage } from "../../../src/tools/teams-send-message.js";
import { teamsNotify } from "../../../src/tools/teams-notify.js";
import { teamsGetStatus } from "../../../src/tools/teams-get-status.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import { NotificationQueue } from "../../../src/notifications/queue.js";
import type { ProcessPoolConfig } from "../../../src/process-pool/types.js";
import { writeFileSync, unlinkSync, existsSync } from "fs";

describe("MCP Tools Integration", () => {
  let pool: ClaudeProcessPool;
  let configManager: TeamsConfigManager;
  let notificationQueue: NotificationQueue;
  const testConfigPath = "./test-mcp-tools-teams.json";
  const testDbPath = "./test-mcp-tools-notifications.db";

  // Create test configuration
  const testConfig = {
    settings: {
      idleTimeout: 300000,
      maxProcesses: 5,
      healthCheckInterval: 30000,
    },
    teams: {
      frontend: {
        path: process.cwd(),
        description: "Frontend team",
        skipPermissions: true,
      },
      backend: {
        path: process.cwd(),
        description: "Backend team",
        skipPermissions: true,
      },
      mobile: {
        path: process.cwd(),
        description: "Mobile team",
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

    // Create process pool
    const poolConfig: ProcessPoolConfig = {
      idleTimeout: 300000,
      maxProcesses: 5,
      healthCheckInterval: 30000,
    };
    pool = new ClaudeProcessPool(configManager, poolConfig);

    // Create notification queue
    notificationQueue = new NotificationQueue(testDbPath);
  });

  afterEach(async () => {
    // Clean up pool
    if (pool) {
      await pool.terminateAll();
    }

    // Clean up notification queue
    if (notificationQueue) {
      notificationQueue.close();
    }

    // Clean up files
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe("teams_ask", () => {
    it("should send question and receive response", async () => {
      const result = await teamsAsk(
        {
          team: "frontend",
          question: "What is 2+2? Reply with just the number.",
          timeout: 30000,
        },
        pool,
      );

      // Validate mechanism, not content
      expect(result).toBeDefined();
      expect(result.team).toBe("frontend");
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe("string");
      expect(result.duration).toBeGreaterThan(0);
    }, 35000);

    it("should throw validation error for invalid team name", async () => {
      await expect(
        teamsAsk(
          {
            team: "../invalid",
            question: "test",
            timeout: 30000,
          },
          pool,
        ),
      ).rejects.toThrow("Team name contains invalid characters");
    }, 5000);

    it("should throw validation error for empty question", async () => {
      await expect(
        teamsAsk(
          {
            team: "frontend",
            question: "",
            timeout: 30000,
          },
          pool,
        ),
      ).rejects.toThrow("Message is required and must be a string");
    }, 5000);

    it("should throw error for non-existent team", async () => {
      await expect(
        teamsAsk(
          {
            team: "nonexistent",
            question: "test",
            timeout: 30000,
          },
          pool,
        ),
      ).rejects.toThrow('Team "nonexistent" not found');
    }, 5000);
  });

  describe("teams_send_message", () => {
    it("should send message with waitForResponse=true and get response", async () => {
      const result = await teamsSendMessage(
        {
          toTeam: "backend",
          message: "What is 3+3? Reply with just the number.",
          fromTeam: "frontend",
          waitForResponse: true,
          timeout: 30000,
        },
        pool,
      );

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe("string");
    }, 35000);

    it("should send message with waitForResponse=false and return confirmation", async () => {
      const result = await teamsSendMessage(
        {
          toTeam: "backend",
          message: "Background task",
          fromTeam: "frontend",
          waitForResponse: false,
          timeout: 30000,
        },
        pool,
      );

      expect(result).toBeDefined();
      expect(result.async).toBe(true);
    }, 35000);

    it("should handle fromTeam parameter correctly", async () => {
      const result = await teamsSendMessage(
        {
          toTeam: "mobile",
          message: "Test message",
          fromTeam: "custom-sender",
          waitForResponse: true,
          timeout: 30000,
        },
        pool,
      );

      expect(result).toBeDefined();
      expect(result.from).toBe("custom-sender");
    }, 35000);

    it("should throw validation error for invalid team name", async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: "../invalid",
            message: "test",
            waitForResponse: true,
            timeout: 30000,
          },
          pool,
        ),
      ).rejects.toThrow("Team name contains invalid characters");
    }, 5000);

    it("should throw validation error for empty message", async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: "backend",
            message: "",
            waitForResponse: true,
            timeout: 30000,
          },
          pool,
        ),
      ).rejects.toThrow("Message is required and must be a string");
    }, 5000);

    it("should throw error for non-existent team", async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: "nonexistent",
            message: "test",
            waitForResponse: true,
            timeout: 30000,
          },
          pool,
        ),
      ).rejects.toThrow('Team "nonexistent" not found');
    }, 5000);
  });

  describe("teams_notify", () => {
    it("should add notification to queue", async () => {
      const result = await teamsNotify(
        {
          toTeam: "frontend",
          message: "Notification message",
          fromTeam: "backend",
          ttlDays: 30,
        },
        notificationQueue,
      );

      expect(result).toBeDefined();
      expect(result.to).toBe("frontend");
      expect(result.from).toBe("backend");

      // Verify notification was added to queue
      const notifications = notificationQueue.getForTeam("frontend");
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].message).toBe("Notification message");
      expect(notifications[0].fromTeam).toBe("backend");
    }, 5000);

    it("should handle optional fromTeam parameter", async () => {
      const result = await teamsNotify(
        {
          toTeam: "backend",
          message: "Test notification",
          ttlDays: 30,
        },
        notificationQueue,
      );

      expect(result).toBeDefined();
      expect(result.from).toBeUndefined();

      const notifications = notificationQueue.getForTeam("backend");
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].fromTeam).toBeNull();
    }, 5000);

    it("should handle optional ttlDays parameter", async () => {
      const result = await teamsNotify(
        {
          toTeam: "mobile",
          message: "Test notification",
          fromTeam: "frontend",
          ttlDays: 7, // 7 days TTL
        },
        notificationQueue,
      );

      expect(result).toBeDefined();
      const notifications = notificationQueue.getForTeam("mobile");
      expect(notifications.length).toBeGreaterThan(0);
    }, 5000);

    it("should throw validation error for invalid team name", async () => {
      await expect(
        teamsNotify(
          {
            toTeam: "../invalid",
            message: "test",
            ttlDays: 30,
          },
          notificationQueue,
        ),
      ).rejects.toThrow("Team name contains invalid characters");
    }, 5000);

    it("should throw validation error for empty message", async () => {
      await expect(
        teamsNotify(
          {
            toTeam: "frontend",
            message: "",
            ttlDays: 30,
          },
          notificationQueue,
        ),
      ).rejects.toThrow("Message is required and must be a string");
    }, 5000);

    it("should handle multiple notifications to same team", async () => {
      await teamsNotify(
        {
          toTeam: "frontend",
          message: "Message 1",
          fromTeam: "backend",
          ttlDays: 30,
        },
        notificationQueue,
      );
      await teamsNotify(
        {
          toTeam: "frontend",
          message: "Message 2",
          fromTeam: "mobile",
          ttlDays: 30,
        },
        notificationQueue,
      );
      await teamsNotify(
        {
          toTeam: "frontend",
          message: "Message 3",
          fromTeam: "backend",
          ttlDays: 30,
        },
        notificationQueue,
      );

      const notifications = notificationQueue.getForTeam("frontend");
      expect(notifications.length).toBe(3);
    }, 5000);
  });

  describe("teams_get_status", () => {
    it("should return status with no active processes", async () => {
      const result = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        true,
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result.teams).toBeDefined();
      expect(Array.isArray(result.teams)).toBe(true);
      expect(result.teams.length).toBeGreaterThan(0);
      expect(result.processPool).toBeDefined();
      expect(result.processPool.totalProcesses).toBe(0);
      expect(result.notifications).toBeDefined();
    }, 5000);

    it("should return status with active processes", async () => {
      // Create some processes
      await pool.getOrCreateProcess("frontend");
      await pool.getOrCreateProcess("backend");

      const result = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        true,
      );

      expect(result.processPool.totalProcesses).toBe(2);
      expect(result.processPool.processes).toHaveProperty("frontend");
      expect(result.processPool.processes).toHaveProperty("backend");
      expect(result.processPool.processes.frontend.status).toBe("idle");
    }, 20000);

    it("should return status for specific team only", async () => {
      await pool.getOrCreateProcess("frontend");
      await pool.getOrCreateProcess("backend");

      const result = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        "frontend",
        true,
      );

      expect(result).toBeDefined();
      expect(result.processPool.processes).toHaveProperty("frontend");
      // Should still show all processes, but focused on frontend team
      expect(result.teams).toBeDefined();
    }, 20000);

    it("should include notification statistics", async () => {
      // Add some notifications
      notificationQueue.add("frontend", "Test 1", "backend");
      notificationQueue.add("frontend", "Test 2", "mobile");
      notificationQueue.add("backend", "Test 3", "frontend");

      const result = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        true,
      );

      expect(result.notifications).toBeDefined();
      expect(result.notifications.totalPending).toBeGreaterThan(0);
      expect(result.notifications.byTeam).toBeDefined();
      expect(result.notifications.byTeam.frontend).toBeGreaterThan(0);
    }, 5000);

    it("should work with includeNotifications=false", async () => {
      const result = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        false,
      );

      expect(result).toBeDefined();
      expect(result.teams).toBeDefined();
      expect(result.processPool).toBeDefined();
      // Notifications should still be included but might be minimal
    }, 5000);

    it("should handle empty pool gracefully", async () => {
      const result = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        true,
      );

      expect(result.processPool.totalProcesses).toBe(0);
      expect(Object.keys(result.processPool.processes)).toHaveLength(0);
    }, 5000);
  });

  describe("cross-tool integration", () => {
    it("should handle ask, send, and notify in sequence", async () => {
      // Ask a question
      const askResult = await teamsAsk(
        { team: "frontend", question: "Hello", timeout: 30000 },
        pool,
      );
      expect(askResult).toBeDefined();

      // Send a message
      const sendResult = await teamsSendMessage(
        {
          toTeam: "backend",
          message: "Test",
          fromTeam: "frontend",
          waitForResponse: true,
          timeout: 30000,
        },
        pool,
      );
      expect(sendResult).toBeDefined();

      // Add notification
      const notifyResult = await teamsNotify(
        {
          toTeam: "mobile",
          message: "Notification",
          fromTeam: "backend",
          ttlDays: 30,
        },
        notificationQueue,
      );
      expect(notifyResult).toBeDefined();

      // Get status showing all activity
      const status = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        true,
      );

      expect(status.processPool.totalProcesses).toBeGreaterThan(0);
      expect(status.notifications.totalPending).toBeGreaterThan(0);
    }, 70000);

    it("should handle concurrent operations across tools", async () => {
      const operations = [
        teamsAsk(
          { team: "frontend", question: "Question 1", timeout: 30000 },
          pool,
        ),
        teamsSendMessage(
          {
            toTeam: "backend",
            message: "Message 1",
            fromTeam: "test",
            waitForResponse: true,
            timeout: 30000,
          },
          pool,
        ),
        teamsNotify(
          {
            toTeam: "mobile",
            message: "Notification 1",
            fromTeam: "frontend",
            ttlDays: 30,
          },
          notificationQueue,
        ),
      ];

      const results = await Promise.all(operations);

      // All operations should complete successfully
      expect(results[0]).toBeDefined(); // ask result
      expect(results[1]).toBeDefined(); // send result
      expect(results[2]).toBeDefined(); // notify result

      // Verify via status
      const status = await teamsGetStatus(
        pool,
        notificationQueue,
        configManager,
        undefined,
        true,
      );

      expect(status.processPool.totalProcesses).toBeGreaterThan(0);
    }, 40000);
  });
});
