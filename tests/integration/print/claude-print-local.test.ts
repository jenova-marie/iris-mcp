/**
 * Integration tests for ClaudePrintExecutor - Local execution
 * Tests actual execution of claude --print commands
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ClaudePrintExecutor } from "../../../src/utils/claude-print.js";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";

describe("ClaudePrintExecutor Integration - Local", () => {
  let testConfig: IrisConfig;
  let sessionId: string;
  let sessionFilePath: string;

  // Load actual test config
  const testConfigPath = "./tests/config.yaml";
  const configManager = new TeamsConfigManager(testConfigPath);
  configManager.load();
  const config = configManager.getConfig();

  beforeAll(() => {
    // Use first configured team (team-iris)
    const firstTeam = Object.keys(config.teams)[0];
    testConfig = config.teams[firstTeam];

    // Generate unique session ID for this test run (must be UUID)
    sessionId = randomUUID();
    sessionFilePath = ClaudeProcess.getSessionFilePath(
      testConfig.path,
      sessionId,
    );
  });

  afterEach(() => {
    // Cleanup: Remove session file if it was created
    if (existsSync(sessionFilePath)) {
      try {
        unlinkSync(sessionFilePath);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe("Session initialization", () => {
    it("should initialize session using ping command", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      const result = await executor.execute({
        command: "ping",
        resume: false, // Use --session-id to create new session
        timeout: config.settings.sessionInitTimeout,
      });

      // Should complete successfully
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
      expect(result.stdout.length).toBeGreaterThan(0);

      // Should have reasonable duration
      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeLessThan(config.settings.sessionInitTimeout);

      // Session file should be created
      expect(existsSync(sessionFilePath)).toBe(true);
    }, 60000); // 60s timeout for initialization

    it("should capture debug log path", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      const result = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(result.success).toBe(true);

      // Debug log path should be captured from stderr
      if (result.debugLogPath) {
        expect(result.debugLogPath).toContain(".claude");
        expect(typeof result.debugLogPath).toBe("string");
      }
    }, 60000);
  });

  describe("Session resumption", () => {
    it("should resume existing session with --resume", async () => {
      // First, create session
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(existsSync(sessionFilePath)).toBe(true);

      // Now resume and send another command
      const result = await executor.execute({
        command: "ping",
        resume: true, // Use --resume for existing session
        timeout: 30000,
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    }, 90000); // 90s for two commands
  });

  describe("Error handling", () => {
    it("should handle non-existent session gracefully", async () => {
      const nonExistentSession = randomUUID();
      const executor = ClaudePrintExecutor.create(
        testConfig,
        nonExistentSession,
      );

      const result = await executor.execute({
        command: "ping",
        resume: true, // Try to resume non-existent session
        timeout: 30000,
      });

      // Should fail but not throw
      expect(result.success).toBe(false);
      // stderr should contain error information
      expect(result.stderr.length).toBeGreaterThan(0);
    }, 60000);

    it.skip("should handle invalid commands", async () => {
      // Create session first
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      // Try an invalid slash command
      const result = await executor.execute({
        command: "/invalid-command-that-does-not-exist",
        resume: true,
        timeout: 30000,
      });

      // May succeed or fail depending on Claude's behavior
      // Just verify we get a result and don't throw
      expect(result).toBeDefined();
      expect(result.exitCode).toBeDefined();
    }, 90000);
  });

  describe("Custom claudePath", () => {
    it.skip("should work with default claude executable", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      const result = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(result.success).toBe(true);
      expect(existsSync(sessionFilePath)).toBe(true);
    }, 60000);

    it("should respect custom claudePath if provided", async () => {
      // Skip if custom path is not configured
      if (!testConfig.claudePath) {
        return;
      }

      const customConfig: IrisConfig = {
        ...testConfig,
        claudePath: testConfig.claudePath,
      };

      const executor = ClaudePrintExecutor.create(customConfig, sessionId);

      const result = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(result.success).toBe(true);
      expect(existsSync(sessionFilePath)).toBe(true);
    }, 60000);
  });

  describe("Performance", () => {
    it("should complete session initialization within timeout", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      const startTime = Date.now();

      const result = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(config.settings.sessionInitTimeout);

      // Duration in result should match actual time
      expect(result.duration).toBeGreaterThan(0);
      expect(Math.abs(result.duration - duration)).toBeLessThan(100); // Within 100ms
    }, 60000);

    it("should track accurate duration for multiple commands", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      // Create session
      const result1 = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(result1.success).toBe(true);
      const duration1 = result1.duration;

      // Resume session
      const result2 = await executor.execute({
        command: "ping",
        resume: true,
        timeout: 30000,
      });

      expect(result2.success).toBe(true);
      const duration2 = result2.duration;

      // Both should have positive durations
      expect(duration1).toBeGreaterThan(0);
      expect(duration2).toBeGreaterThan(0);

      // Durations should be independent
      expect(duration1).not.toBe(duration2);
    }, 90000);
  });

  describe("Output handling", () => {
    it("should capture stdout and stderr separately", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      const result = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(result.success).toBe(true);

      // Should have stdout
      expect(result.stdout).toBeTruthy();
      expect(typeof result.stdout).toBe("string");

      // May have stderr (logging, etc)
      expect(typeof result.stderr).toBe("string");

      // Debug info might be in stderr
      if (result.stderr.length > 0) {
        expect(result.stderr).toBeTruthy();
      }
    }, 60000);

    it("should return complete output for successful commands", async () => {
      const executor = ClaudePrintExecutor.create(testConfig, sessionId);

      const result = await executor.execute({
        command: "ping",
        resume: false,
        timeout: config.settings.sessionInitTimeout,
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);

      // Output should contain response
      expect(result.stdout.length).toBeGreaterThan(0);

      // Should be valid text (not binary garbage)
      expect(result.stdout).toMatch(/[\w\s]/);
    }, 60000);
  });
});
