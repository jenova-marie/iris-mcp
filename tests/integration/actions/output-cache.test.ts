/**
 * Integration tests for output caching with async messages
 * Tests the issue where async messages (waitForResponse=false) don't cache output
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { IrisOrchestrator } from "../../../src/iris.js";
import { SessionManager } from "../../../src/session/session-manager.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import { tell } from "../../../src/actions/tell.js";
import { report } from "../../../src/actions/report.js";
import { Logger } from "../../../src/utils/logger.js";

const logger = new Logger("test:output-cache");

describe("Output Cache with Async Messages", () => {
  let iris: IrisOrchestrator;
  let sessionManager: SessionManager;
  let processPool: ClaudeProcessPool;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./tests/teams.test.json";
  const testDbPath = "./tests/data/test-output-cache.db";

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout || 60000;

  // Check for REUSE_DB env var to skip database cleanup (faster iteration during development)
  // Usage: REUSE_DB=1 pnpm test:run tests/integration/actions/output-cache.test.ts
  const reuseDb =
    process.env.REUSE_DB === "1" || process.env.REUSE_DB === "true";

  // Helper to clean database files
  const cleanDatabase = () => {
    if (reuseDb) {
      console.log("⚡ Reusing existing database (REUSE_DB=1)");
      return;
    }
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  beforeAll(async () => {
    cleanDatabase(); // Start with clean DB (or reuse existing)

    // Load configuration following the pattern from actions.test.ts
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();

    // Initialize components following the correct pattern
    sessionManager = new SessionManager(teamsConfig, testDbPath);

    // Try to initialize, but continue even if it fails partially
    try {
      await sessionManager.initialize();
    } catch (error) {
      // Log but don't fail - some teams might initialize successfully
      console.error("Partial initialization failure:", error);
    }

    processPool = new ClaudeProcessPool(configManager, {
      maxProcesses: teamsConfig.settings.maxProcesses,
      idleTimeout: teamsConfig.settings.idleTimeout,
      healthCheckInterval: teamsConfig.settings.healthCheckInterval,
      sessionInitTimeout: teamsConfig.settings.sessionInitTimeout,
    });

    iris = new IrisOrchestrator(sessionManager, processPool);
  }, 120000); // 2 minute timeout for initialization

  afterAll(async () => {
    // Clean up
    if (processPool) {
      await processPool.terminateAll();
    }
    if (sessionManager) {
      sessionManager.close();
    }
    cleanDatabase();
  });

  it(
    "should capture output for synchronous messages",
    async () => {
      logger.info("Testing synchronous message output caching");

      // Send synchronous message (waitForResponse=true)
      const syncResult = await tell(
        {
          toTeam: "team-alpha",
          message:
            "Please say 'Synchronous test message' to confirm you received this",
          fromTeam: undefined, // External request
          waitForResponse: true,
          clearCache: true, // Clear before this test
        },
        iris,
      );

      expect(syncResult.response).toBeDefined();
      expect(syncResult.async).toBe(false);

      // Report at the output cache
      const cacheAfterSync = await report(
        {
          team: "team-alpha",
          fromTeam: undefined,
        },
        processPool,
      );

      logger.info("Cache after sync message", {
        hasStdout: cacheAfterSync.stdout.length > 0,
        hasStderr: cacheAfterSync.stderr.length > 0,
        stdoutLength: cacheAfterSync.stdout.length,
        stderrLength: cacheAfterSync.stderr.length,
      });

      // For synchronous messages, we expect some output to be cached
      expect(cacheAfterSync.hasProcess).toBe(true);
      // The cache should contain something (stdout or stderr)
      expect(cacheAfterSync.totalBytes).toBeGreaterThan(0);
    },
    sessionInitTimeout,
  );

  it(
    "should capture output for asynchronous messages",
    async () => {
      logger.info("Testing asynchronous message output caching");

      // First ensure the process is spawned and ready
      await tell(
        {
          toTeam: "team-alpha",
          message: "ping", // Simple message to warm up the process
          fromTeam: undefined,
          waitForResponse: true,
          clearCache: true, // Start with clean cache
        },
        iris,
      );

      logger.info("Process warmed up, sending async message");

      // Now send asynchronous message (waitForResponse=false)
      const asyncResult = await tell(
        {
          toTeam: "team-alpha",
          message:
            "Please say 'Asynchronous test message' to confirm you received this async message",
          fromTeam: undefined,
          waitForResponse: false,
          clearCache: false, // Don't clear cache
        },
        iris,
      );

      expect(asyncResult.async).toBe(true);
      expect(asyncResult.response).toBeUndefined();

      // Wait longer for the async message to process
      logger.info("Waiting for async message to process...");
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Report at the output cache
      const cacheAfterAsync = await report(
        {
          team: "team-alpha",
          fromTeam: undefined,
        },
        processPool,
      );

      logger.info("Cache after async message", {
        hasStdout: cacheAfterAsync.stdout.length > 0,
        hasStderr: cacheAfterAsync.stderr.length > 0,
        stdoutLength: cacheAfterAsync.stdout.length,
        stderrLength: cacheAfterAsync.stderr.length,
        stdoutPreview: cacheAfterAsync.stdout.substring(0, 200),
        stderrPreview: cacheAfterAsync.stderr.substring(0, 200),
      });

      // For asynchronous messages, output SHOULD be cached
      expect(cacheAfterAsync.hasProcess).toBe(true);

      // THIS IS THE BUG: The cache should contain the async message output
      // but currently it doesn't
      expect(cacheAfterAsync.totalBytes).toBeGreaterThan(0);

      // The output should contain evidence of our async message processing
      const combinedOutput = cacheAfterAsync.stdout + cacheAfterAsync.stderr;
      expect(combinedOutput).toContain("Asynchronous test message");
    },
    sessionInitTimeout,
  );

  it(
    "should handle multiple async messages correctly",
    async () => {
      logger.info("Testing multiple async messages");

      // Clear cache first
      await iris.clearOutputCache("team-alpha");

      // Send multiple async messages
      const messages = [
        "Please say exactly: 'First async message response'",
        "Please say exactly: 'Second async message response'",
        "Please say exactly: 'Third async message response'",
      ];

      for (const msg of messages) {
        await tell(
          {
            toTeam: "team-alpha",
            message: msg,
            fromTeam: undefined,
            waitForResponse: false,
            clearCache: false, // Don't clear between messages
          },
          iris,
        );
        // Small delay between messages
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Wait for all messages to process
      logger.info("Waiting for all async messages to process...");
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Increased wait time

      // Report at the final output cache
      const finalCache = await report(
        {
          team: "team-alpha",
          fromTeam: undefined,
        },
        processPool,
      );

      logger.info("Cache after multiple async messages", {
        stdoutLength: finalCache.stdout.length,
        stderrLength: finalCache.stderr.length,
        totalBytes: finalCache.totalBytes,
      });

      // The cache should contain output from all messages
      expect(finalCache.hasProcess).toBe(true);
      expect(finalCache.totalBytes).toBeGreaterThan(0);

      const combinedOutput = finalCache.stdout + finalCache.stderr;
      expect(combinedOutput).toContain("First async message response");
      expect(combinedOutput).toContain("Second async message response");
      expect(combinedOutput).toContain("Third async message response");
    },
    sessionInitTimeout,
  );

  it(
    "should preserve cache when clearCache=false",
    async () => {
      logger.info("Testing cache preservation with clearCache=false");

      // Send first message to populate cache
      await tell(
        {
          toTeam: "team-alpha",
          message: "echo 'Initial cache content'",
          fromTeam: undefined,
          waitForResponse: true,
          clearCache: true, // Clear initially
        },
        iris,
      );

      // Send async message with clearCache=false
      await tell(
        {
          toTeam: "team-alpha",
          message: "echo 'Should be added to cache'",
          fromTeam: undefined,
          waitForResponse: false,
          clearCache: false, // Preserve existing cache
        },
        iris,
      );

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check cache
      const cache = await report(
        {
          team: "team-alpha",
          fromTeam: undefined,
        },
        processPool,
      );

      const combinedOutput = cache.stdout + cache.stderr;
      logger.info("Combined output with clearCache=false", {
        length: combinedOutput.length,
        preview: combinedOutput.substring(0, 300),
      });

      // Should contain both messages
      expect(combinedOutput).toContain("Initial cache content");
      expect(combinedOutput).toContain("Should be added to cache");
    },
    sessionInitTimeout,
  );
});
