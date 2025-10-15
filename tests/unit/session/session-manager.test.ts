/**
 * Unit tests for SessionManager
 *
 * Tests session lifecycle orchestration and team-to-team session management
 * as documented in docs/SESSION.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger BEFORE imports using hoisting
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "../../../src/session/session-manager.js";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { TeamsConfig } from "../../../src/process-pool/types.js";

describe("SessionManager", () => {
  let manager: SessionManager;
  let testConfig: TeamsConfig;
  let testProjectPaths: string[] = [];

  beforeEach(() => {
    // Mock ClaudeProcess.initializeSessionFile to avoid spawning real Claude processes in unit tests
    vi.spyOn(ClaudeProcess, "initializeSessionFile").mockResolvedValue(
      undefined,
    );

    // Create temporary test project directories
    const teamAPath = join(tmpdir(), "iris-test-team-alpha");
    const teamBPath = join(tmpdir(), "iris-test-team-beta");
    const teamCPath = join(tmpdir(), "iris-test-team-c");

    testProjectPaths = [teamAPath, teamBPath, teamCPath];

    for (const path of testProjectPaths) {
      mkdirSync(path, { recursive: true });
    }

    // Create test configuration with new responseTimeout setting
    testConfig = {
      settings: {
        idleTimeout: 300000,
        maxProcesses: 5,
        healthCheckInterval: 30000,
        sessionInitTimeout: 30000,
        responseTimeout: 120000, // NEW: Required for new architecture
      },
      teams: {
        "team-alpha": {
          path: teamAPath,
          description: "Test Team A",
          skipPermissions: true,
        },
        "team-beta": {
          path: teamBPath,
          description: "Test Team B",
          skipPermissions: true,
        },
        "team-c": {
          path: teamCPath,
          description: "Test Team C",
          skipPermissions: false,
        },
      },
    };

    // Use in-memory database for unit tests
    manager = new SessionManager(testConfig, { inMemory: true });
  });

  afterEach(() => {
    // Restore mocks
    vi.restoreAllMocks();

    // Clean up
    manager.close();

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
        settings: {
          ...testConfig.settings,
          responseTimeout: 120000,
        },
        teams: {
          "invalid-team": {
            path: "/nonexistent/path/12345",
            description: "Invalid team",
            skipPermissions: true,
          },
        },
      };

      const invalidManager = new SessionManager(invalidConfig, { inMemory: true });

      await expect(invalidManager.initialize()).rejects.toThrow(
        "Project path does not exist",
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
      expect(() => manager.getSession("team-beta", "team-alpha")).not.toThrow();
    });
  });

  describe("getOrCreateSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create new session for team pair", async () => {
      const session = await manager.getOrCreateSession(
        "team-alpha",
        "team-beta",
      );

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-alpha");
      expect(session.toTeam).toBe("team-beta");
      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ); // UUID v4 format
      expect(session.status).toBe("active");
      expect(session.messageCount).toBe(0);
    });

    it("should create session with fromTeam team-beta", async () => {
      const session = await manager.getOrCreateSession(
        "team-beta",
        "team-beta",
      );

      expect(session.fromTeam).toBe("team-beta");
      expect(session.toTeam).toBe("team-beta");
    });

    it("should reuse existing session for same team pair", async () => {
      const session1 = await manager.getOrCreateSession(
        "team-alpha",
        "team-beta",
      );
      const session2 = await manager.getOrCreateSession(
        "team-alpha",
        "team-beta",
      );

      expect(session1.sessionId).toBe(session2.sessionId);
      expect(session1.id).toBe(session2.id);
    });

    it("should create different sessions for different team pairs", async () => {
      const sessionAB = await manager.getOrCreateSession(
        "team-alpha",
        "team-beta",
      );
      const sessionBA = await manager.getOrCreateSession(
        "team-beta",
        "team-alpha",
      );

      expect(sessionAB.sessionId).not.toBe(sessionBA.sessionId);
      expect(sessionAB.fromTeam).toBe("team-alpha");
      expect(sessionBA.fromTeam).toBe("team-beta");
    });

    it("should throw error for unknown toTeam", async () => {
      await expect(
        manager.getOrCreateSession("team-alpha", "nonexistent"),
      ).rejects.toThrow("Unknown team");
    });

    it("should throw error for unknown fromTeam", async () => {
      await expect(
        manager.getOrCreateSession("nonexistent", "team-alpha"),
      ).rejects.toThrow("Unknown team");
    });

    it("should throw error if not initialized", async () => {
      const uninitializedManager = new SessionManager(testConfig, { inMemory: true });

      await expect(
        uninitializedManager.getOrCreateSession("team-alpha", "team-beta"),
      ).rejects.toThrow("not initialized");

      uninitializedManager.close();
    });
  });

  describe("createSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create session with generated UUID", async () => {
      const session = await manager.createSession("team-alpha", "team-beta");

      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should store session in database", async () => {
      const created = await manager.createSession("team-alpha", "team-beta");

      const retrieved = manager.getSession("team-alpha", "team-beta");

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it("should handle team-beta fromTeam", async () => {
      const session = await manager.createSession("team-beta", "team-beta");

      expect(session.fromTeam).toBe("team-beta");
      expect(session.toTeam).toBe("team-beta");
    });
  });

  describe("getSession", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return null for non-existent session", () => {
      const session = manager.getSession("team-alpha", "team-beta");

      expect(session).toBe(null);
    });

    it("should retrieve existing session", async () => {
      const created = await manager.createSession("team-alpha", "team-beta");

      const retrieved = manager.getSession("team-alpha", "team-beta");

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it("should distinguish between different team pairs", async () => {
      await manager.createSession("team-alpha", "team-beta");
      await manager.createSession("team-beta", "team-alpha");

      const ab = manager.getSession("team-alpha", "team-beta");
      const ba = manager.getSession("team-beta", "team-alpha");

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
      const created = await manager.createSession("team-alpha", "team-beta");

      const retrieved = manager.getSessionById(created.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
      expect(retrieved?.fromTeam).toBe("team-alpha");
      expect(retrieved?.toTeam).toBe("team-beta");
    });
  });

  describe("listSessions", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return empty list after init", () => {
      const sessions = manager.listSessions();

      // New architecture: sessions are created on-demand, not pre-initialized
      expect(sessions).toHaveLength(0);
    });

    it("should list all sessions", async () => {
      await manager.createSession("team-alpha", "team-beta");
      await manager.createSession("team-beta", "team-alpha");
      await manager.createSession("team-beta", "team-c");

      const sessions = manager.listSessions();

      // 3 created sessions (no pre-initialization in new architecture)
      expect(sessions).toHaveLength(3);
    });

    it("should filter by fromTeam", async () => {
      await manager.createSession("team-alpha", "team-beta");
      await manager.createSession("team-alpha", "team-c");
      await manager.createSession("team-beta", "team-alpha");

      const sessions = manager.listSessions({ fromTeam: "team-alpha" });

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.fromTeam === "team-alpha")).toBe(true);
    });

    it("should filter by toTeam", async () => {
      await manager.createSession("team-alpha", "team-beta");
      await manager.createSession("team-c", "team-beta");
      await manager.createSession("team-beta", "team-alpha");

      const sessions = manager.listSessions({ toTeam: "team-beta" });

      // 2 created sessions to team-beta (no pre-initialization in new architecture)
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.toTeam === "team-beta")).toBe(true);
    });
  });

  describe("recordUsage", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update last_used_at timestamp", async () => {
      const session = await manager.createSession("team-alpha", "team-beta");
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
      const session = await manager.createSession("team-alpha", "team-beta");

      manager.incrementMessageCount(session.sessionId, 1);

      const updated = manager.getSessionById(session.sessionId);
      expect(updated?.messageCount).toBe(1);
    });

    it("should accumulate message counts", async () => {
      const session = await manager.createSession("team-alpha", "team-beta");

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
      const session = await manager.createSession("team-alpha", "team-beta");

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
      await manager.createSession("team-alpha", "team-beta");
      await manager.createSession("team-beta", "team-alpha");

      const session = await manager.createSession("team-alpha", "team-c");
      manager.incrementMessageCount(session.sessionId, 10);

      const stats = manager.getStats();

      // 3 created sessions (no pre-initialization in new architecture)
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
      expect(stats.totalMessages).toBe(10);
    });
  });

  describe("configuration handling", () => {
    it("should accept valid path configuration", async () => {
      const pathValue = join(tmpdir(), "iris-test-path-config");
      mkdirSync(pathValue, { recursive: true });

      const configWithPath: TeamsConfig = {
        settings: {
          ...testConfig.settings,
          responseTimeout: 120000,
        },
        teams: {
          "test-team": {
            path: pathValue,
            description: "Test",
            skipPermissions: true,
          },
        },
      };

      const testManager = new SessionManager(configWithPath, { inMemory: true });

      await expect(testManager.initialize()).resolves.not.toThrow();

      testManager.close();
      rmSync(pathValue, { recursive: true, force: true });
    });
  });
});
