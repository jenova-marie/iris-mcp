/**
 * Integration test to isolate the "pong contamination" bug
 *
 * This test verifies that when team-alpha sends a message to team-beta,
 * the response is NOT the initialization "pong" from beta's wakeup.
 *
 * Expected behavior: Beta should respond to alpha's actual message, not with "pong"
 * Bug behavior: Beta responds with "pong" from initialization ping
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import { SessionManager } from "../../../src/session/session-manager.js";
import type { ProcessPoolConfig } from "../../../src/process-pool/types.js";
import { unlinkSync, existsSync } from "fs";

describe("Session-First Message Test (Isolate Pong Bug)", () => {
  let pool: ClaudeProcessPool;
  let configManager: TeamsConfigManager;
  let sessionManager: SessionManager;
  const testConfigPath = "./tests/teams.test.json";
  const testSessionDbPath = "./tests/data/test-session-first.db";

  // Load config to get timeout
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout;

  // Check for REUSE_DB env var to skip database cleanup (faster iteration during development)
  // Usage: REUSE_DB=1 pnpm test:run tests/integration/session/session-first.test.ts
  const reuseDb = process.env.REUSE_DB === "1" || process.env.REUSE_DB === "true";

  // Helper to clean database
  const cleanDatabase = () => {
    if (reuseDb) {
      console.log("⚡ Reusing existing database (REUSE_DB=1)");
      return;
    }
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

  beforeAll(async () => {
    cleanDatabase(); // Start with clean DB (or reuse existing)

    // Load config
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    // Create SessionManager
    const teamsConfig = configManager.getConfig();
    sessionManager = new SessionManager(teamsConfig, testSessionDbPath);

    // Initialize sessions
    try {
      await sessionManager.initialize();
    } catch (error) {
      console.error("Session initialization error:", error);
      throw error;
    }

    // Create pool
    const poolConfig: ProcessPoolConfig = {
      idleTimeout: teamsConfig.settings.idleTimeout,
      maxProcesses: teamsConfig.settings.maxProcesses,
      healthCheckInterval: teamsConfig.settings.healthCheckInterval,
      sessionInitTimeout: teamsConfig.settings.sessionInitTimeout,
    };

    pool = new ClaudeProcessPool(configManager, poolConfig);
  }, sessionInitTimeout * 3); // Generous timeout for full initialization

  afterAll(async () => {
    // Clean up
    if (pool) {
      await pool.terminateAll();
    }

    if (sessionManager) {
      sessionManager.close();
    }

    cleanDatabase();
  });

  it(
    "should send 'hello' from team-alpha to team-beta and NOT receive 'pong'",
    async () => {
      // Get session for alpha -> beta communication
      const session = await sessionManager.getOrCreateSession(
        "team-alpha",
        "team-beta",
      );

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.fromTeam).toBe("team-alpha");
      expect(session.toTeam).toBe("team-beta");

      // Send message from alpha to beta via pool
      // This will wake up beta if not already awake
      const response = await pool.sendMessage(
        "team-beta",
        session.sessionId,
        "hello",
        sessionInitTimeout,
      );

      // Log the response for debugging
      console.log("Response from team-beta:", response);

      // CRITICAL ASSERTION: Response should NOT be "pong"
      // If it is "pong", the initialization ping has contaminated the response
      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
      expect(response.toLowerCase()).not.toBe("pong");
      expect(response.toLowerCase()).not.toContain("pong");

      // Response should be relevant to "hello", not initialization
      // (This is a loose check - just verifying it's not the init pong)
      expect(response.length).toBeGreaterThan(0);
    },
    sessionInitTimeout * 2,
  );

  it(
    "should send second message and also NOT receive 'pong'",
    async () => {
      // Get the same session (should be reused)
      const session = await sessionManager.getOrCreateSession(
        "team-alpha",
        "team-beta",
      );

      // Send a second message - this should definitely not get "pong"
      // since beta is already awake
      const response = await pool.sendMessage(
        "team-beta",
        session.sessionId,
        "how are you?",
        sessionInitTimeout,
      );

      console.log("Second response from team-beta:", response);

      // This should also not be "pong"
      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
      expect(response.toLowerCase()).not.toBe("pong");
      expect(response.toLowerCase()).not.toContain("pong");
    },
    sessionInitTimeout,
  );

  it(
    "should send from external (null) to team-alpha and NOT receive 'pong'",
    async () => {
      // Test with external -> team-alpha to ensure the bug isn't specific
      // to team-to-team communication
      const session = await sessionManager.getOrCreateSession(
        null,
        "team-alpha",
      );

      const response = await pool.sendMessage(
        "team-alpha",
        session.sessionId,
        "testing external message",
        sessionInitTimeout,
      );

      console.log("Response from team-alpha (external):", response);

      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
      expect(response.toLowerCase()).not.toBe("pong");
      expect(response.toLowerCase()).not.toContain("pong");
    },
    sessionInitTimeout,
  );
});
