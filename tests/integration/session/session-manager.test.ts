/**
 * Integration tests for SessionManager
 * Tests core session lifecycle and management operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import type { TeamsConfig } from "../../../src/process-pool/types.js";

describe("SessionManager Integration", () => {
  let manager: SessionManager;
  const testDbPath = "./test-integration-session-manager.db";
  const testProjectPath = "/tmp/test-iris-team-project";

  const testConfig: TeamsConfig = {
    settings: {
      idleTimeout: 300000,
      maxProcesses: 10,
      healthCheckInterval: 30000,
    },
    teams: {
      "team-a": {
        project: testProjectPath,
        description: "Test team A",
      },
      "team-b": {
        project: testProjectPath,
        description: "Test team B",
      },
    },
  };

  beforeEach(async () => {
    // Create test project directory
    mkdirSync(testProjectPath, { recursive: true });

    manager = new SessionManager(testConfig, testDbPath);
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

    // Cleanup test project
    if (testProjectPath.startsWith("/tmp/")) {
      const { rmSync } = require("fs");
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  describe("Session creation", () => {
    it("should create new session for team pair", async () => {
      const session = await manager.createSession("team-a", "team-b");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-a");
      expect(session.toTeam).toBe("team-b");
      expect(session.sessionId).toBeTruthy();
      expect(session.status).toBe("active");
    });

    it("should create session with null fromTeam", async () => {
      const session = await manager.createSession(null, "team-a");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBeNull();
      expect(session.toTeam).toBe("team-a");
    });

    it("should reject unknown team", async () => {
      await expect(
        manager.createSession("team-a", "unknown-team"),
      ).rejects.toThrow("Unknown team");
    });
  });

  describe("Session retrieval", () => {
    it("should get or create session", async () => {
      const session1 = await manager.getOrCreateSession("team-a", "team-b");
      const session2 = await manager.getOrCreateSession("team-a", "team-b");

      expect(session1.sessionId).toBe(session2.sessionId);
    });

    it("should retrieve session by ID", async () => {
      const created = await manager.createSession("team-a", "team-b");
      const retrieved = manager.getSessionById(created.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it("should return null for non-existent session", () => {
      const session = manager.getSession("team-a", "team-b");
      expect(session).toBeNull();
    });
  });

  describe("Session caching", () => {
    it("should use cache for repeated queries", async () => {
      const session1 = await manager.getOrCreateSession("team-a", "team-b");

      // Second call should use cache
      const session2 = manager.getSession("team-a", "team-b");

      expect(session2).toBeDefined();
      expect(session2?.sessionId).toBe(session1.sessionId);
    });

    it("should clear cache", async () => {
      await manager.getOrCreateSession("team-a", "team-b");
      manager.clearCache();

      // After cache clear, should still work but fetch from DB
      const session = manager.getSession("team-a", "team-b");
      expect(session).toBeDefined();
    });
  });

  describe("Session metadata", () => {
    it("should record session usage", async () => {
      const session = await manager.createSession("team-a", "team-b");
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
      const session = await manager.createSession("team-a", "team-b");

      manager.incrementMessageCount(session.sessionId, 5);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.messageCount).toBe(5);
    });
  });

  describe("Session listing", () => {
    it("should list all sessions", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-b", "team-a");

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it("should filter sessions by fromTeam", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-b", "team-a");

      const sessions = manager.listSessions({ fromTeam: "team-a" });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].fromTeam).toBe("team-a");
    });
  });

  describe("Session statistics", () => {
    it("should provide accurate statistics", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-b", "team-a");

      const stats = manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
    });
  });

  describe("Session deletion", () => {
    it("should delete session from database", async () => {
      const session = await manager.createSession("team-a", "team-b");

      await manager.deleteSession(session.sessionId, false);

      const retrieved = manager.getSessionById(session.sessionId);
      expect(retrieved).toBeNull();
    });
  });
});
