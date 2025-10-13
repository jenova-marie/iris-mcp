/**
 * Integration tests for ClaudeProcess
 * Tests actual spawning and communication with Claude CLI
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { TeamConfig } from "../../../src/process-pool/types.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import { CacheEntryImpl } from "../../../src/cache/cache-entry.js";
import { CacheEntryType } from "../../../src/cache/types.js";
import { existsSync } from "fs";

describe("ClaudeProcess Integration (New Architecture)", () => {
  let claudeProcess: ClaudeProcess;
  const testTeamConfig: TeamConfig = {
    path: process.cwd(),
    description: "Test team for integration tests",
    skipPermissions: true,
  };

  // Load config early to get timeout value
  const testConfigPath = "./tests/config.json";
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout = tempConfigManager.getConfig().settings.sessionInitTimeout;

  afterEach(async () => {
    if (claudeProcess) {
      const metrics = claudeProcess.getBasicMetrics();
      // Only terminate if process is not already stopped
      if (metrics.status !== "stopped") {
        await claudeProcess.terminate();
      }
    }
  });

  describe("process spawning", () => {
    it("should spawn claude process successfully", async () => {
      claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, "test-session-spawn");

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.pid).toBeDefined();
      // Process might be "processing" (waiting for result) or "idle" (result arrived)
      expect(["idle", "processing"]).toContain(metrics.status);
    });

    it.skip("should handle spawn errors gracefully", async () => {
      const invalidConfig: TeamConfig = {
        path: "/nonexistent/path",
        description: "Invalid path",
        skipPermissions: true,
      };

      claudeProcess = new ClaudeProcess("invalid-team", invalidConfig, "test-session-invalid");

      // Attach error handler to prevent unhandled error
      const errorPromise = new Promise((resolve) => {
        claudeProcess.once("error", (data) => {
          resolve(data);
        });
      });

      // Should either throw or emit error event
      try {
        const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
        await Promise.race([claudeProcess.spawn(spawnCacheEntry), errorPromise]);
        // Process might spawn but then immediately fail
        const metrics = claudeProcess.getBasicMetrics();
        expect(metrics.status).toBeDefined();
      } catch (error) {
        // Expected - spawn failed
        expect(error).toBeDefined();
      }
    }, 15000);

    it("should emit spawned event when ready", async () => {
      claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, "test-session-event");

      const spawnedPromise = new Promise((resolve) => {
        claudeProcess.once("process-spawned", (data) => {
          resolve(data);
        });
      });

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);
      const spawnedData = await spawnedPromise;

      expect(spawnedData).toMatchObject({
        teamName: "team-alpha",
        pid: expect.any(Number),
      });
    });
  });

  describe.skip("stdio communication - TODO: Rewrite for new dumb pipe architecture", () => {
    beforeEach(async () => {
      claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, "test-session-stdio");
      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);
    }, sessionInitTimeout); // Use config timeout (longer than waitForReady's 20s timeout)

    it("should send simple message and receive response", async () => {
      const response = await claudeProcess.sendMessage("Hello, Claude!", 30000);

      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
    }, 35000);

    it("should emit message-sent and message-response events", async () => {
      const messageSentPromise = new Promise((resolve) => {
        claudeProcess.once("message-sent", (data) => {
          resolve(data);
        });
      });

      const messageResponsePromise = new Promise((resolve) => {
        claudeProcess.once("message-response", (data) => {
          resolve(data);
        });
      });

      const responsePromise = claudeProcess.sendMessage("Test message", 30000);

      const sentData = await messageSentPromise;
      const responseData = await messageResponsePromise;
      const response = await responsePromise;

      expect(sentData).toMatchObject({
        teamName: "team-alpha",
        message: expect.any(String),
      });

      expect(responseData).toMatchObject({
        teamName: "team-alpha",
        response: expect.any(String),
      });

      expect(response).toBeDefined();
    }, 35000);
  });

  describe.skip("process lifecycle - TODO: Rewrite for new dumb pipe architecture", () => {
    it("should transition through states correctly", async () => {
      claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, "test-session-lifecycle");

      // Initial state
      expect(claudeProcess.getBasicMetrics().status).toBe("stopped");

      // After spawn
      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);
      expect(claudeProcess.getBasicMetrics().status).toBe("idle");

      // During message processing
      const responsePromise = claudeProcess.sendMessage("Test", 35000);

      // Small delay to let processing start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // After response
      await responsePromise;
      expect(claudeProcess.getBasicMetrics().status).toBe("idle");

      // After terminate
      await claudeProcess.terminate();
      expect(claudeProcess.getBasicMetrics().status).toBe("stopped");
    }, 40000);

    it("should track message count", async () => {
      claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, "test-session-count");
      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      const initialCount = claudeProcess.getBasicMetrics().messagesProcessed;

      await claudeProcess.sendMessage("Test 1", 35000);
      await claudeProcess.sendMessage("Test 2", 35000);

      const finalCount = claudeProcess.getBasicMetrics().messagesProcessed;
      expect(finalCount).toBe(initialCount + 2);
    }, 75000);
  });

  describe.skip("error handling - TODO: Rewrite for new dumb pipe architecture", () => {
    beforeEach(async () => {
      claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, "test-session-error");
      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);
    }, sessionInitTimeout); // Use config timeout (longer than waitForReady's 20s timeout)

    it("should timeout on messages that take too long", async () => {
      await expect(
        claudeProcess.sendMessage("This might timeout", 1000), // Short timeout to force timeout
      ).rejects.toThrow();
    }, 10000);

    it("should handle process errors", async () => {
      const errorPromise = new Promise((resolve) => {
        claudeProcess.once("error", (data) => {
          resolve(data);
        });
      });

      // Force an error by terminating the process while it has a message
      const messagePromise = claudeProcess.sendMessage("Test", 35000);

      // Give message time to start processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      await claudeProcess.terminate();

      // Either the error event fires or the message rejects
      try {
        await Promise.race([messagePromise, errorPromise]);
      } catch (error) {
        expect(error).toBeDefined();
      }
    }, 40000);
  });
});
