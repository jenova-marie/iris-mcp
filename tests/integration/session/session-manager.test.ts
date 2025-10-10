/**
 * Integration tests for SessionManager
 * Tests core session lifecycle and management operations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

  // Single initialization for ALL tests (much faster!)
  beforeAll(async () => {
    cleanDatabase(); // Start with clean DB
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    manager = new SessionManager(teamsConfig, testDbPath);
    await manager.initialize();
  }, 120000); // 2 minute timeout for full initialization

  afterAll(() => {
    if (manager) {
      manager.close();
    }
    cleanDatabase();
  });

  // Tests that spawn claude processes
  describe("Session creation (spawns claude)", () => {
    it("should create new session for team pair", async () => {
      const session = await manager.createSession("team-alpha", "team-delta");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-alpha");
      expect(session.toTeam).toBe("team-delta");
      expect(session.sessionId).toBeTruthy();
      expect(session.status).toBe("active");
    }, 30000); // 30 second timeout

    it("should create session with specific fromTeam", async () => {
      const session = await manager.createSession("team-gamma", "team-alpha");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-gamma");
      expect(session.toTeam).toBe("team-alpha");
    }, 30000); // 30 second timeout

    it("should reject unknown team", async () => {
      await expect(
        manager.createSession("team-alpha", "unknown-team"),
      ).rejects.toThrow("Unknown team");
    });
  });

  describe("Session retrieval (spawns claude)", () => {
    it("should get or create session", async () => {
      const session1 = await manager.getOrCreateSession(
        "team-gamma",
        "team-alpha",
      );
      const session2 = await manager.getOrCreateSession(
        "team-gamma",
        "team-alpha",
      );

      expect(session1.sessionId).toBe(session2.sessionId);
    }, 30000);

    it("should retrieve session by ID", async () => {
      const created = await manager.createSession("team-alpha", "team-beta");
      const retrieved = manager.getSessionById(created.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    }, 30000);

    it("should return null for non-existent session", () => {
      const session = manager.getSession("team-delta", "team-gamma");
      expect(session).toBeNull();
    });
  });
});
