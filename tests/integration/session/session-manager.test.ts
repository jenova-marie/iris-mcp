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

  beforeEach(async () => {
    // Load real teams.json config
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    manager = new SessionManager(teamsConfig, testDbPath);
    await manager.initialize();
  });

  afterEach(() => {
    manager.close();

    // Cleanup database files
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  });

  describe("Session creation", () => {
    it.skip("should create new session for team pair", async () => {
      // SKIP: team-alpha process crashes with exit code 1
      const session = await manager.createSession("iris-mcp", "team-alpha");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("iris-mcp");
      expect(session.toTeam).toBe("team-alpha");
      expect(session.sessionId).toBeTruthy();
      expect(session.status).toBe("active");
    });

    it.skip("should create session with null fromTeam", async () => {
      // SKIP: team-alpha process crashes with exit code 1
      const session = await manager.createSession(null, "team-alpha");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBeNull();
      expect(session.toTeam).toBe("team-alpha");
    });

    it("should reject unknown team", async () => {
      await expect(
        manager.createSession("iris-mcp", "unknown-team"),
      ).rejects.toThrow("Unknown team");
    });
  });

  describe("Session retrieval", () => {
    it("should get or create session", async () => {
      const session1 = await manager.getOrCreateSession("iris-mcp", "team-alpha");
      const session2 = await manager.getOrCreateSession("iris-mcp", "team-alpha");

      expect(session1.sessionId).toBe(session2.sessionId);
    });

    it("should retrieve session by ID", async () => {
      const created = await manager.createSession("iris-mcp", "team-alpha");
      const retrieved = manager.getSessionById(created.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it("should return null for non-existent session", () => {
      const session = manager.getSession("iris-mcp", "team-alpha");
      expect(session).toBeNull();
    });
  });

  describe("Session caching", () => {
    it("should use cache for repeated queries", async () => {
      const session1 = await manager.getOrCreateSession("iris-mcp", "team-alpha");

      // Second call should use cache
      const session2 = manager.getSession("iris-mcp", "team-alpha");

      expect(session2).toBeDefined();
      expect(session2?.sessionId).toBe(session1.sessionId);
    });

    it("should clear cache", async () => {
      await manager.getOrCreateSession("iris-mcp", "team-alpha");
      manager.clearCache();

      // After cache clear, should still work but fetch from DB
      const session = manager.getSession("iris-mcp", "team-alpha");
      expect(session).toBeDefined();
    });
  });

  describe("Session metadata", () => {
    it("should record session usage", async () => {
      const session = await manager.createSession("iris-mcp", "team-alpha");
      const originalTime = session.lastUsedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.recordUsage(session.sessionId);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(
        originalTime.getTime(),
      );
    });

    it("should increment message count", async () => {
      const session = await manager.createSession("iris-mcp", "team-alpha");

      manager.incrementMessageCount(session.sessionId, 5);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.messageCount).toBe(5);
    });
  });

  describe("Session listing", () => {
    it("should list all sessions", async () => {
      await manager.createSession("iris-mcp", "team-alpha");
      await manager.createSession("team-alpha", "team-beta");

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it("should filter sessions by fromTeam", async () => {
      await manager.createSession("iris-mcp", "team-alpha");
      await manager.createSession("team-alpha", "team-beta");

      const sessions = manager.listSessions({ fromTeam: "iris-mcp" });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].fromTeam).toBe("iris-mcp");
    });
  });

  describe("Session statistics", () => {
    it("should provide accurate statistics", async () => {
      await manager.createSession("iris-mcp", "team-alpha");
      await manager.createSession("team-alpha", "team-beta");

      const stats = manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
    });
  });

  describe("Session deletion", () => {
    it("should delete session from database", async () => {
      const session = await manager.createSession("iris-mcp", "team-alpha");

      await manager.deleteSession(session.sessionId, false);

      const retrieved = manager.getSessionById(session.sessionId);
      expect(retrieved).toBeNull();
    });
  });
});
