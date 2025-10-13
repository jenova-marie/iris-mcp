/**
 * Integration test: Session Creation
 *
 * Focused test to verify the core session creation flow works end-to-end:
 * - SessionManager initialization
 * - Creating a new session for a team pair
 * - ClaudeProcess.initializeSessionFile spawns REAL Claude process
 * - Session is properly stored in database
 *
 * This is a REAL integration test - no mocks, real processes spawned.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";

describe("Session Creation Integration", () => {
  let manager: SessionManager;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./tests/config.json";
  const testDbPath = "./tests/data/test-createSession.db";

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout = tempConfigManager.getConfig().settings.sessionInitTimeout;

  // Helper to clean database
  const cleanDatabase = () => {
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  beforeAll(async () => {
    cleanDatabase(); // Start fresh

    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    manager = new SessionManager(teamsConfig, testDbPath);

    // Initialize manager (validates team paths, no sessions created yet)
    await manager.initialize();
  }, 120000); // 2 minute timeout for setup

  afterAll(() => {
    if (manager) {
      manager.close();
    }
    cleanDatabase();
  });

  it(
    "should create a new session and spawn real Claude process",
    async () => {
      // ACT: Create session for team pair
      const session = await manager.createSession("team-iris", "team-alpha");

      // ASSERT: Session created with correct metadata
      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-iris");
      expect(session.toTeam).toBe("team-alpha");
      expect(session.sessionId).toBeTruthy();
      expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); // UUID v4
      expect(session.status).toBe("active");
      expect(session.processState).toBe("stopped"); // Initially stopped
      expect(session.messageCount).toBe(0);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastUsedAt).toBeInstanceOf(Date);

      // ASSERT: Session stored in database
      const retrieved = manager.getSessionById(session.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(session.sessionId);
      expect(retrieved?.fromTeam).toBe("team-iris");
      expect(retrieved?.toTeam).toBe("team-alpha");

      // ASSERT: Session retrievable by team pair
      const byTeamPair = manager.getSession("team-iris", "team-alpha");
      expect(byTeamPair).toBeDefined();
      expect(byTeamPair?.sessionId).toBe(session.sessionId);

      // ASSERT: Statistics reflect new session
      const stats = manager.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(1);
      expect(stats.active).toBeGreaterThanOrEqual(1);
    },
    sessionInitTimeout + 10000, // Add buffer to sessionInitTimeout
  );

  it(
    "should return existing session on second call (idempotency)",
    async () => {
      // First call - should return existing session from previous test
      const session1 = await manager.getOrCreateSession("team-iris", "team-alpha");

      // Second call - should return SAME session
      const session2 = await manager.getOrCreateSession("team-iris", "team-alpha");

      expect(session1.sessionId).toBe(session2.sessionId);
      expect(session1.fromTeam).toBe(session2.fromTeam);
      expect(session1.toTeam).toBe(session2.toTeam);

      // Should still only have 1 session for this team pair in database
      const sessions = manager.listSessions({
        fromTeam: "team-iris",
        toTeam: "team-alpha"
      });
      expect(sessions.length).toBe(1);
    },
    sessionInitTimeout + 10000,
  );
});
