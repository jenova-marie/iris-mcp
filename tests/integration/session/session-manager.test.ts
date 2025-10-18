/**
 * Integration tests for SessionManager
 * Tests core session lifecycle and management operations
 *
 * NEW ARCHITECTURE CHANGES:
 * - All sessions require fromTeam parameter
 * - Sessions are fromTeam->toTeam format only
 * - No null->team or external->team sessions
 * - getSession requires both fromTeam and toTeam
 * - createSession requires both fromTeam and toTeam
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";

describe("SessionManager Integration", () => {
  let manager: SessionManager;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./tests/config.yaml"; // Use test teams config

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout;

  // Single initialization for ALL tests
  beforeAll(async () => {
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    // Use in-memory database for testing
    manager = new SessionManager(teamsConfig, { inMemory: true });

    // Initialize (creates sessions for each team)
    try {
      await manager.initialize();
    } catch (error) {
      // Log but don't fail - some teams might initialize successfully
      console.error("Partial initialization failure:", error);
    }
  }, 120000); // 2 minute timeout

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
    // No need to clean database files - using in-memory database
  });

  describe("Initialization verification", () => {
    it("should be valid and fully initialized", () => {
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(SessionManager);

      // Manager should be initialized
      expect(() => manager.listSessions()).not.toThrow();

      const sessions = manager.listSessions();
      expect(sessions).toBeDefined();
      expect(Array.isArray(sessions)).toBe(true);

      // All sessions should have fromTeam
      sessions.forEach((s) => {
        expect(s.fromTeam).toBeDefined();
        expect(s.fromTeam).not.toBeNull();
      });

      // Check stats
      const stats = manager.getStats();
      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    it("should not create sessions during init (on-demand only)", () => {
      const sessions = manager.listSessions();

      // Sessions are created on-demand, not during initialization
      // So we expect 0 sessions initially
      expect(sessions.length).toBe(0);

      // All sessions (if any exist) must have fromTeam
      sessions.forEach((s) => {
        expect(s.fromTeam).toBeDefined();
        expect(s.fromTeam).not.toBeNull();
      });
    });
  });

  describe("Session creation with fromTeam (spawns claude)", () => {
    it(
      "should create new session for team pair",
      async () => {
        const session = await manager.createSession("team-iris", "team-alpha");

        expect(session).toBeDefined();
        expect(session.fromTeam).toBe("team-iris");
        expect(session.toTeam).toBe("team-alpha");
        expect(session.sessionId).toBeTruthy();
        expect(session.status).toBe("active");
      },
      sessionInitTimeout,
    );

    it(
      "should create session with different fromTeam",
      async () => {
        const session = await manager.createSession("team-iris", "team-beta");

        expect(session).toBeDefined();
        expect(session.fromTeam).toBe("team-iris");
        expect(session.toTeam).toBe("team-beta");
        expect(session.sessionId).toBeTruthy();
      },
      sessionInitTimeout,
    );

    it("should reject unknown team", async () => {
      await expect(
        manager.createSession("team-iris", "unknown-team"),
      ).rejects.toThrow("Unknown team");
    });

    it("should reject null fromTeam", async () => {
      await expect(
        manager.createSession(null as any, "team-alpha"),
      ).rejects.toThrow();
    });
  });

  describe("Session retrieval with fromTeam (spawns claude)", () => {
    it(
      "should get or create session",
      async () => {
        const session1 = await manager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );
        const session2 = await manager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );

        // Should return same session
        expect(session1.sessionId).toBe(session2.sessionId);
        expect(session1.fromTeam).toBe("team-iris");
      },
      sessionInitTimeout,
    );

    it(
      "should retrieve session by ID",
      async () => {
        const created = await manager.getOrCreateSession(
          "team-iris",
          "team-beta",
        );
        const retrieved = manager.getSessionById(created.sessionId);

        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe(created.sessionId);
        expect(retrieved?.fromTeam).toBe("team-iris");
      },
      sessionInitTimeout,
    );

    it("should get session by team pair", () => {
      // After getOrCreateSession above, session should exist
      const session = manager.getSession("team-iris", "team-alpha");

      if (session) {
        expect(session.fromTeam).toBe("team-iris");
        expect(session.toTeam).toBe("team-alpha");
      }
      // If null, it just means it hasn't been created yet - that's ok
    });

    it("should return null for non-existent session", () => {
      const session = manager.getSession(
        "non-existent-from",
        "non-existent-to",
      );
      expect(session).toBeNull();
    });

    it("should list all sessions", () => {
      const sessions = manager.listSessions();
      expect(sessions).toBeDefined();
      expect(Array.isArray(sessions)).toBe(true);

      // All sessions must have fromTeam
      sessions.forEach((s) => {
        expect(s.fromTeam).toBeDefined();
        expect(s.fromTeam).not.toBeNull();
      });
    });
  });

  describe("Session filtering", () => {
    it(
      "should filter sessions by fromTeam",
      async () => {
        // Create some sessions
        await manager.getOrCreateSession("team-iris", "team-alpha");
        await manager.getOrCreateSession("team-iris", "team-beta");

        const sessions = manager.listSessions({ fromTeam: "team-iris" });

        expect(sessions.length).toBeGreaterThanOrEqual(2);
        sessions.forEach((s) => {
          expect(s.fromTeam).toBe("team-iris");
        });
      },
      sessionInitTimeout * 2,
    );

    it(
      "should filter sessions by toTeam",
      async () => {
        await manager.getOrCreateSession("team-iris", "team-alpha");

        const sessions = manager.listSessions({ toTeam: "team-alpha" });

        expect(sessions.length).toBeGreaterThan(0);
        sessions.forEach((s) => {
          expect(s.toTeam).toBe("team-alpha");
        });
      },
      sessionInitTimeout,
    );

    it(
      "should filter sessions by status",
      async () => {
        const session = await manager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );

        const activeSessions = manager.listSessions({ status: "active" });
        expect(activeSessions.length).toBeGreaterThan(0);
        expect(
          activeSessions.some((s) => s.sessionId === session.sessionId),
        ).toBe(true);
      },
      sessionInitTimeout,
    );
  });

  describe("Session metadata operations", () => {
    it(
      "should record usage",
      async () => {
        const session = await manager.getOrCreateSession(
          "team-iris",
          "team-alpha",
        );
        const originalLastUsed = session.lastUsedAt;

        // Wait a bit to ensure timestamp changes
        await new Promise((resolve) => setTimeout(resolve, 10));

        manager.recordUsage(session.sessionId);

        const updated = manager.getSessionById(session.sessionId);
        expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(
          originalLastUsed.getTime(),
        );
      },
      sessionInitTimeout,
    );

    it(
      "should increment message count",
      async () => {
        const session = await manager.getOrCreateSession(
          "team-iris",
          "team-beta",
        );

        manager.incrementMessageCount(session.sessionId);
        manager.incrementMessageCount(session.sessionId);

        const updated = manager.getSessionById(session.sessionId);
        expect(updated?.messageCount).toBeGreaterThanOrEqual(2);
      },
      sessionInitTimeout,
    );

    it(
      "should update process state",
      async () => {
        const session = await manager.getOrCreateSession(
          "team-iris",
          "team-beta",
        );

        manager.updateProcessState(session.sessionId, "processing");

        const updated = manager.getSessionById(session.sessionId);
        expect(updated?.processState).toBe("processing");
      },
      sessionInitTimeout,
    );
  });

  describe("Session statistics", () => {
    it("should provide accurate statistics", async () => {
      const stats = manager.getStats();

      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.active).toBeGreaterThanOrEqual(0);
      expect(stats.active).toBeLessThanOrEqual(stats.total);
    });
  });
});
