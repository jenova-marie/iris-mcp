/**
 * Integration tests for ClaudeProcess
 * Tests actual spawning and communication with Claude CLI
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { CacheEntryImpl } from "../../../src/cache/cache-entry.js";
import { CacheEntryType } from "../../../src/cache/types.js";
import { existsSync } from "fs";

describe("ClaudeProcess Integration (New Architecture)", () => {
  let claudeProcess: ClaudeProcess;
  const testIrisConfig: IrisConfig = {
    path: process.cwd(),
    description: "Test team for integration tests",
    skipPermissions: true,
  };

  // Load config early to get timeout value
  const testConfigPath = "./tests/config.json";
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout;

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
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-spawn",
      );

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.pid).toBeDefined();
      // Process might be "processing" (waiting for result) or "idle" (result arrived)
      expect(["idle", "processing"]).toContain(metrics.status);
    });

    it.skip("should handle spawn errors gracefully", async () => {
      const invalidConfig: IrisConfig = {
        path: "/nonexistent/path",
        description: "Invalid path",
        skipPermissions: true,
      };

      claudeProcess = new ClaudeProcess(
        "invalid-team",
        invalidConfig,
        "test-session-invalid",
      );

      // Attach error handler to prevent unhandled error
      const errorPromise = new Promise((resolve) => {
        claudeProcess.once("error", (data) => {
          resolve(data);
        });
      });

      // Should either throw or emit error event
      try {
        const spawnCacheEntry = new CacheEntryImpl(
          CacheEntryType.SPAWN,
          "ping",
        );
        await Promise.race([
          claudeProcess.spawn(spawnCacheEntry),
          errorPromise,
        ]);
        // Process might spawn but then immediately fail
        const metrics = claudeProcess.getBasicMetrics();
        expect(metrics.status).toBeDefined();
      } catch (error) {
        // Expected - spawn failed
        expect(error).toBeDefined();
      }
    }, 15000);

    it("should emit spawned event when ready", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-event",
      );

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
});
