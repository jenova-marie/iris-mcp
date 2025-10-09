/**
 * Integration tests for SessionManager
 * Tests core session lifecycle and management operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";

describe("SessionManager Integration", () => {
  let manager: SessionManager;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./teams.json"; // Use real teams.json
  const testDbPath = "./test-integration-session-manager.db";

  // Helper to clean database and session files before tests
  const cleanDatabase = () => {
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  // Helper to clean up orphaned session files
  const cleanSessionFiles = () => {
    const { rmSync } = require("fs");
    const { join } = require("path");
    const { homedir } = require("os");

    const teams = ["iris-mcp", "team-alpha", "team-beta", "team-delta", "team-gamma"];

    for (const team of teams) {
      // Construct the escaped path for each team
      const teamPath = join(
        homedir(),
        ".claude",
        "projects",
        `-Users-jenova-projects-jenova-marie-iris-mcp${team === "iris-mcp" ? "" : `-teams-${team}`}`,
      );

      // Remove all session files in this team's directory
      try {
        if (existsSync(teamPath)) {
          rmSync(teamPath, { recursive: true, force: true });
        }
      } catch (error) {
        // Ignore errors, directory might not exist
      }
    }
  };

  afterEach(() => {
    if (manager) {
      manager.close();
    }
    cleanDatabase();
    cleanSessionFiles();
  });

  // Tests that spawn claude processes
  describe("Session creation (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should create new session for team pair",
      async () => {
        const session = await manager.createSession("iris-mcp", "team-alpha");

        expect(session).toBeDefined();
        expect(session.fromTeam).toBe("iris-mcp");
        expect(session.toTeam).toBe("team-alpha");
        expect(session.sessionId).toBeTruthy();
        expect(session.status).toBe("active");
      },
      30000,
    ); // 30 second timeout

    it(
      "should create session with null fromTeam",
      async () => {
        const session = await manager.createSession(null, "team-alpha");

        expect(session).toBeDefined();
        expect(session.fromTeam).toBeNull();
        expect(session.toTeam).toBe("team-alpha");
      },
      30000,
    ); // 30 second timeout

    it("should reject unknown team", async () => {
      await expect(
        manager.createSession("iris-mcp", "unknown-team"),
      ).rejects.toThrow("Unknown team");
    });
  });

  describe("Session retrieval (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should get or create session",
      async () => {
        const session1 = await manager.getOrCreateSession(
          "iris-mcp",
          "team-alpha",
        );
        const session2 = await manager.getOrCreateSession(
          "iris-mcp",
          "team-alpha",
        );

        expect(session1.sessionId).toBe(session2.sessionId);
      },
      30000,
    );

    it(
      "should retrieve session by ID",
      async () => {
        const created = await manager.createSession("iris-mcp", "team-alpha");
        const retrieved = manager.getSessionById(created.sessionId);

        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe(created.sessionId);
      },
      30000,
    );

    it("should return null for non-existent session", () => {
      const session = manager.getSession("iris-mcp", "team-alpha");
      expect(session).toBeNull();
    });
  });

  describe("Session caching (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should use cache for repeated queries",
      async () => {
        const session1 = await manager.getOrCreateSession(
          "iris-mcp",
          "team-alpha",
        );

        // Second call should use cache
        const session2 = manager.getSession("iris-mcp", "team-alpha");

        expect(session2).toBeDefined();
        expect(session2?.sessionId).toBe(session1.sessionId);
      },
      30000,
    );

    it(
      "should clear cache",
      async () => {
        await manager.getOrCreateSession("iris-mcp", "team-alpha");
        manager.clearCache();

        // After cache clear, should still work but fetch from DB
        const session = manager.getSession("iris-mcp", "team-alpha");
        expect(session).toBeDefined();
      },
      30000,
    );
  });

  describe("Session metadata (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should record session usage",
      async () => {
        const session = await manager.createSession("iris-mcp", "team-alpha");
        const originalTime = session.lastUsedAt;

        // Wait a bit to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 10));

        manager.recordUsage(session.sessionId);

        const updated = manager.getSessionById(session.sessionId);
        expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(
          originalTime.getTime(),
        );
      },
      30000,
    );

    it(
      "should increment message count",
      async () => {
        const session = await manager.createSession("iris-mcp", "team-alpha");

        manager.incrementMessageCount(session.sessionId, 5);

        const updated = manager.getSessionById(session.sessionId);
        expect(updated?.messageCount).toBe(5);
      },
      30000,
    );
  });

  describe("Session listing (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should list all sessions",
      async () => {
        // Note: initialize() already created sessions for all 5 teams
        // Check how many we start with
        const initialSessions = manager.listSessions();
        const initialCount = initialSessions.length;

        // Create 2 additional sessions
        await manager.createSession("iris-mcp", "team-alpha");
        await manager.createSession("team-alpha", "team-beta");

        const sessions = manager.listSessions();
        expect(sessions).toHaveLength(initialCount + 2);
      },
      60000,
    );

    it(
      "should filter sessions by fromTeam",
      async () => {
        // Create test sessions with specific fromTeam
        await manager.createSession("iris-mcp", "team-alpha");
        await manager.createSession("team-alpha", "team-beta");

        // Filter to only get sessions FROM iris-mcp
        const sessions = manager.listSessions({ fromTeam: "iris-mcp" });

        // Should only get the one we explicitly created with fromTeam=iris-mcp
        expect(sessions.length).toBeGreaterThanOrEqual(1);

        // Find our created session
        const ourSession = sessions.find(s => s.toTeam === "team-alpha");
        expect(ourSession).toBeDefined();
        expect(ourSession?.fromTeam).toBe("iris-mcp");
      },
      60000,
    );
  });

  describe("Session statistics (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should provide accurate statistics",
      async () => {
        // Get baseline stats (from initialization)
        const initialStats = manager.getStats();

        // Create 2 additional sessions
        await manager.createSession("iris-mcp", "team-alpha");
        await manager.createSession("team-alpha", "team-beta");

        const stats = manager.getStats();
        expect(stats.total).toBe(initialStats.total + 2);
        expect(stats.active).toBe(initialStats.active + 2);
      },
      60000,
    );
  });

  describe("Session deletion (spawns claude)", () => {
    beforeEach(async () => {
      cleanDatabase(); // Start with clean DB
      configManager = new TeamsConfigManager(testConfigPath);
      configManager.load();

      const teamsConfig = configManager.getConfig();
      manager = new SessionManager(teamsConfig, testDbPath);
      await manager.initialize();
    }, 60000);
    it(
      "should delete session from database",
      async () => {
        const session = await manager.createSession("iris-mcp", "team-alpha");

        await manager.deleteSession(session.sessionId, false);

        const retrieved = manager.getSessionById(session.sessionId);
        expect(retrieved).toBeNull();
      },
      30000,
    );
  });
});
