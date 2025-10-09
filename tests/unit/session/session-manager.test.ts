/**
 * Unit tests for SessionManager
 *
 * Tests session lifecycle orchestration and team-to-team session management
 * as documented in docs/SESSION.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "../../../src/session/session-manager.js";
import type { TeamsConfig } from "../../../src/process-pool/types.js";

describe("SessionManager", () => {
  let manager: SessionManager;
  let testConfig: TeamsConfig;
  const testDbPath = "./test-session-manager.db";
  let testProjectPaths: string[] = [];

  beforeEach(() => {
    // Create temporary test project directories
    const teamAPath = join(tmpdir(), "iris-test-team-a");
    const teamBPath = join(tmpdir(), "iris-test-team-b");
    const teamCPath = join(tmpdir(), "iris-test-team-c");

    testProjectPaths = [teamAPath, teamBPath, teamCPath];

    for (const path of testProjectPaths) {
      mkdirSync(path, { recursive: true });
    }

    // Create test configuration
    testConfig = {
      settings: {
        idleTimeout: 300000,
        maxProcesses: 5,
        healthCheckInterval: 30000,
      },
      teams: {
        "team-a": {
          project: teamAPath,
          path: teamAPath,
          description: "Test Team A",
          skipPermissions: true,
        },
        "team-b": {
          project: teamBPath,
          path: teamBPath,
          description: "Test Team B",
          skipPermissions: true,
        },
        "team-c": {
          project: teamCPath,
          path: teamCPath,
          description: "Test Team C",
          skipPermissions: false,
        },
      },
    };

    manager = new SessionManager(testConfig, testDbPath);
  });

  afterEach(() => {
    // Clean up
    manager.close();

    // Remove database files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }

    // Remove test project directories
    for (const path of testProjectPaths) {
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
      }
    }
  });

  describe("initialization", () => {
    it("should initialize successfully with valid config", async () => {
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it("should validate all team project paths", async () => {
      const invalidConfig: TeamsConfig = {
        settings: testConfig.settings,
        teams: {
          "invalid-team": {
            project: "/nonexistent/path/12345",
            path: "/nonexistent/path/12345",
            description: "Invalid team",
            skipPermissions: true,
          },
        },
      };

      const invalidManager = new SessionManager(invalidConfig, testDbPath);

      await expect(invalidManager.initialize()).rejects.toThrow(
        "Invalid project path",
      );

      invalidManager.close();
    });

    it("should not allow multiple initializations", async () => {
      await manager.initialize();
      await manager.initialize(); // Should log warning but not throw
    });

    it("should set initialized flag", async () => {
      await manager.initialize();

      // Should not throw when calling methods that require initialization
      expect(() => manager.getSession(null, "team-a")).not.toThrow();
    });
  });

  describe("getOrCreateSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create new session for team pair", async () => {
      const session = await manager.getOrCreateSession("team-a", "team-b");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-a");
      expect(session.toTeam).toBe("team-b");
      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ); // UUID v4 format
      expect(session.status).toBe("active");
      expect(session.messageCount).toBe(0);
    });

    it("should create session with null fromTeam", async () => {
      const session = await manager.getOrCreateSession(null, "team-b");

      expect(session.fromTeam).toBe(null);
      expect(session.toTeam).toBe("team-b");
    });

    it("should reuse existing session for same team pair", async () => {
      const session1 = await manager.getOrCreateSession("team-a", "team-b");
      const session2 = await manager.getOrCreateSession("team-a", "team-b");

      expect(session1.sessionId).toBe(session2.sessionId);
      expect(session1.id).toBe(session2.id);
    });

    it("should create different sessions for different team pairs", async () => {
      const sessionAB = await manager.getOrCreateSession("team-a", "team-b");
      const sessionBA = await manager.getOrCreateSession("team-b", "team-a");

      expect(sessionAB.sessionId).not.toBe(sessionBA.sessionId);
      expect(sessionAB.fromTeam).toBe("team-a");
      expect(sessionBA.fromTeam).toBe("team-b");
    });

    it("should throw error for unknown toTeam", async () => {
      await expect(
        manager.getOrCreateSession("team-a", "nonexistent"),
      ).rejects.toThrow("Unknown team");
    });

    it("should throw error for unknown fromTeam", async () => {
      await expect(
        manager.getOrCreateSession("nonexistent", "team-a"),
      ).rejects.toThrow("Unknown team");
    });

    it("should throw error if not initialized", async () => {
      const uninitializedManager = new SessionManager(testConfig, testDbPath);

      await expect(
        uninitializedManager.getOrCreateSession("team-a", "team-b"),
      ).rejects.toThrow("not initialized");

      uninitializedManager.close();
    });
  });

  describe("createSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create session with generated UUID", async () => {
      const session = await manager.createSession("team-a", "team-b");

      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should store session in database", async () => {
      const created = await manager.createSession("team-a", "team-b");

      const retrieved = manager.getSession("team-a", "team-b");

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it("should handle null fromTeam", async () => {
      const session = await manager.createSession(null, "team-b");

      expect(session.fromTeam).toBe(null);
      expect(session.toTeam).toBe("team-b");
    });
  });

  describe("getSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return null for non-existent session", () => {
      const session = manager.getSession("team-a", "team-b");

      expect(session).toBe(null);
    });

    it("should retrieve existing session", async () => {
      const created = await manager.createSession("team-a", "team-b");

      const retrieved = manager.getSession("team-a", "team-b");

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it("should distinguish between different team pairs", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-b", "team-a");

      const ab = manager.getSession("team-a", "team-b");
      const ba = manager.getSession("team-b", "team-a");

      expect(ab?.sessionId).not.toBe(ba?.sessionId);
    });
  });

  describe("getSessionById", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return null for non-existent session ID", () => {
      const session = manager.getSessionById("nonexistent-uuid");

      expect(session).toBe(null);
    });

    it("should retrieve session by ID", async () => {
      const created = await manager.createSession("team-a", "team-b");

      const retrieved = manager.getSessionById(created.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
      expect(retrieved?.fromTeam).toBe("team-a");
      expect(retrieved?.toTeam).toBe("team-b");
    });
  });

  describe("listSessions", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return empty array when no sessions", () => {
      const sessions = manager.listSessions();

      expect(sessions).toEqual([]);
    });

    it("should list all sessions", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-b", "team-a");
      await manager.createSession(null, "team-c");

      const sessions = manager.listSessions();

      expect(sessions).toHaveLength(3);
    });

    it("should filter by fromTeam", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-a", "team-c");
      await manager.createSession("team-b", "team-a");

      const sessions = manager.listSessions({ fromTeam: "team-a" });

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.fromTeam === "team-a")).toBe(true);
    });

    it("should filter by toTeam", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-c", "team-b");
      await manager.createSession("team-b", "team-a");

      const sessions = manager.listSessions({ toTeam: "team-b" });

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.toTeam === "team-b")).toBe(true);
    });
  });

  describe("recordUsage", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update last_used_at timestamp", async () => {
      const session = await manager.createSession("team-a", "team-b");
      const originalTimestamp = session.lastUsedAt.getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.recordUsage(session.sessionId);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(originalTimestamp);
    });
  });

  describe("incrementMessageCount", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should increment message count", async () => {
      const session = await manager.createSession("team-a", "team-b");

      manager.incrementMessageCount(session.sessionId, 1);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.messageCount).toBe(1);
    });

    it("should accumulate message counts", async () => {
      const session = await manager.createSession("team-a", "team-b");

      manager.incrementMessageCount(session.sessionId, 3);
      manager.incrementMessageCount(session.sessionId, 5);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.messageCount).toBe(8);
    });
  });

  describe("deleteSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should delete session from database", async () => {
      const session = await manager.createSession("team-a", "team-b");

      await manager.deleteSession(session.sessionId, false);

      const retrieved = manager.getSessionById(session.sessionId);
      expect(retrieved).toBe(null);
    });

    it("should handle deleting non-existent session gracefully", async () => {
      await expect(
        manager.deleteSession("nonexistent-uuid", false),
      ).resolves.not.toThrow();
    });
  });

  describe("getStats", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return session statistics", async () => {
      await manager.createSession("team-a", "team-b");
      await manager.createSession("team-b", "team-a");

      const session = await manager.createSession("team-a", "team-c");
      manager.incrementMessageCount(session.sessionId, 10);

      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
      expect(stats.totalMessages).toBe(10);
    });
  });

  describe("configuration handling", () => {
    it("should prefer project over path property", async () => {
      const projectPath = join(tmpdir(), "iris-test-project-preference");
      mkdirSync(projectPath, { recursive: true });

      const configWithBoth: TeamsConfig = {
        settings: testConfig.settings,
        teams: {
          "test-team": {
            project: projectPath,
            path: "/some/other/path", // Should be ignored
            description: "Test",
            skipPermissions: true,
          },
        },
      };

      const testManager = new SessionManager(configWithBoth, testDbPath);

      await expect(testManager.initialize()).resolves.not.toThrow();

      testManager.close();
      rmSync(projectPath, { recursive: true, force: true });
    });

    it("should fallback to path if project not specified", async () => {
      const pathValue = join(tmpdir(), "iris-test-path-fallback");
      mkdirSync(pathValue, { recursive: true });

      const configWithPath: TeamsConfig = {
        settings: testConfig.settings,
        teams: {
          "test-team": {
            path: pathValue,
            description: "Test",
            skipPermissions: true,
          },
        },
      };

      const testManager = new SessionManager(configWithPath, testDbPath);

      await expect(testManager.initialize()).resolves.not.toThrow();

      testManager.close();
      rmSync(pathValue, { recursive: true, force: true });
    });
  });
});
