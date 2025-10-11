/**
 * Integration tests for SessionManager
 * Tests core session lifecycle and management operations
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";

describe("SessionManager Integration", () => {
  let manager: SessionManager;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./tests/config.json"; // Use test teams config
  const testDbPath = "./tests/data/test-integration-session-manager.db";

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout;

  // NOTE: This test file does NOT honor REUSE_DB environment variable
  // These tests specifically verify SessionManager initialization and lifecycle from a clean state
  // Other test files (pool-manager, session-first) can benefit from REUSE_DB for faster iteration
  // but session-manager tests REQUIRE a clean database to verify initialization behavior

  // Helper to clean database and session files before tests
  const cleanDatabase = () => {
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  // Single initialization for ALL tests (much faster!)
  beforeAll(async () => {
    cleanDatabase(); // Always start with clean DB for these tests
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    manager = new SessionManager(teamsConfig, testDbPath);

    // Try to initialize, but continue even if it fails partially
    try {
      await manager.initialize();
    } catch (error) {
      // Log but don't fail - some teams might initialize successfully
      console.error("Partial initialization failure:", error);
    }
  }, 120000); // 2 minute timeout for full initialization (needs to be longer than sessionInitTimeout)

  afterEach(() => {
    // Reset the manager to clean state between tests (preserves DB and sessions)
    if (manager) {
      manager.reset();
    }
  });

  afterAll(() => {
    if (manager) {
      manager.close();
    }
    cleanDatabase();
  });

  // Test to verify SessionManager initialization
  describe("Initialization verification", () => {
    it("should be valid and fully initialized", () => {
      // Core manager instance
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(SessionManager);

      // Manager should be initialized
      // We can verify by trying to list sessions (will throw if not initialized)
      expect(() => manager.listSessions()).not.toThrow();

      // After reset, caches are cleared but sessions in DB remain
      // The initial team sessions were created during initialize()
      const sessions = manager.listSessions();
      expect(sessions).toBeDefined();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThanOrEqual(2); // Should have team-alpha and team-beta sessions from init

      // After reset, cached sessions are cleared but DB sessions remain
      // The sessions for both teams should still exist in database
      const teamAlphaSession = manager.getSession(null, "team-alpha");
      expect(teamAlphaSession).toBeDefined(); // Should exist from initialization

      const teamBetaSession = manager.getSession(null, "team-beta");
      expect(teamBetaSession).toBeDefined(); // Should exist from initialization

      // Check stats to verify database is working
      const stats = manager.getStats();
      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(2); // At least team-alpha and team-beta sessions
    });
  });

  // Tests that spawn claude processes
  // Note: afterEach() resets the manager, clearing cache but preserving DB sessions
  describe("Session creation (spawns claude)", () => {
    it(
      "should create new session for team pair",
      async () => {
        const session = await manager.createSession("team-alpha", "team-beta");

        expect(session).toBeDefined();
        expect(session.fromTeam).toBe("team-alpha");
        expect(session.toTeam).toBe("team-beta");
        expect(session.sessionId).toBeTruthy();
        expect(session.status).toBe("active");
      },
      sessionInitTimeout,
    ); // Use config timeout

    it(
      "should create session with specific fromTeam",
      async () => {
        const session = await manager.createSession("team-beta", "team-alpha");

        expect(session).toBeDefined();
        expect(session.fromTeam).toBe("team-beta");
        expect(session.toTeam).toBe("team-alpha");
        expect(session.sessionId).toBeTruthy();
        expect(session.status).toBe("active");
      },
      sessionInitTimeout,
    ); // Use config timeout

    it("should reject unknown team", async () => {
      await expect(
        manager.createSession("team-alpha", "unknown-team"),
      ).rejects.toThrow("Unknown team");
    });
  });

  describe("Session retrieval (spawns claude)", () => {
    it(
      "should get or create session",
      async () => {
        const session1 = await manager.getOrCreateSession(
          "team-alpha",
          "team-beta",
        );
        const session2 = await manager.getOrCreateSession(
          "team-alpha",
          "team-beta",
        );

        expect(session1.sessionId).toBe(session2.sessionId);
      },
      sessionInitTimeout,
    );

    it(
      "should retrieve session by ID",
      async () => {
        // Use getOrCreateSession since the session might already exist from previous tests
        const created = await manager.getOrCreateSession(
          "team-alpha",
          "team-beta",
        );
        const retrieved = manager.getSessionById(created.sessionId);

        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe(created.sessionId);
      },
      sessionInitTimeout,
    );

    it("should return existing sessions from DB after reset", () => {
      // After reset, cache is cleared but DB sessions remain
      // The sessions created during initialize() should still be accessible
      const alphaSession = manager.getSession(null, "team-alpha");
      expect(alphaSession).toBeDefined(); // Self-session exists from init

      const betaSession = manager.getSession(null, "team-beta");
      expect(betaSession).toBeDefined(); // Self-session exists from init

      // Sessions between teams may not exist yet
      const crossSession = manager.getSession("team-alpha", "team-beta");
      // This could be null if not created yet, or could exist if created in a previous test
      // We just check it doesn't throw
      expect(() => manager.getSession("team-alpha", "team-beta")).not.toThrow();
    });
  });
});
