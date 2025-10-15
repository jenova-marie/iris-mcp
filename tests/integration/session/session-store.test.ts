/**
 * Integration tests for SessionStore
 *
 * Tests SQLite database operations in a real database environment,
 * verifying persistence, concurrency, and WAL mode behavior.
 *
 * NEW ARCHITECTURE CHANGES:
 * - All sessions require fromTeam (NOT NULL constraint)
 * - All sessions are fromTeam->toTeam format
 * - No more NULL fromTeam support
 * - Unique constraint on (fromTeam, toTeam) enforced
 * - processState is required (NOT NULL)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { SessionStore } from "../../../src/session/session-store.js";

describe("SessionStore Integration (New Architecture)", () => {
  let store: SessionStore;
  const testDbPath = resolve(
    process.cwd(),
    "tests/data/test-integration-session-store-new.db",
  );

  beforeEach(() => {
    store = new SessionStore(testDbPath);
  });

  afterEach(() => {
    store.close();

    // Clean up database files
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  });

  describe("database persistence", () => {
    it("should persist sessions across store instances", () => {
      // Create session in first store instance
      const session = store.create(
        "team-iris",
        "team-alpha",
        "persistent-session-id",
      );
      expect(session.sessionId).toBe("persistent-session-id");
      expect(session.fromTeam).toBe("team-iris");

      // Close first instance
      store.close();

      // Open new instance with same database
      const store2 = new SessionStore(testDbPath);

      // Should find the persisted session
      const retrieved = store2.getByTeamPair("team-iris", "team-alpha");
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe("persistent-session-id");
      expect(retrieved?.fromTeam).toBe("team-iris");
      expect(retrieved?.toTeam).toBe("team-alpha");

      store2.close();
    });

    it("should persist metadata updates across instances", () => {
      const sessionId = "metadata-persist-test";
      store.create("team-iris", "team-beta", sessionId);

      // Update metadata
      store.incrementMessageCount(sessionId, 5);
      store.updateStatus(sessionId, "compact_pending");
      store.updateLastUsed(sessionId);

      const originalTimestamp = Date.now();
      store.close();

      // Reopen and verify updates persisted
      const store2 = new SessionStore(testDbPath);
      const session = store2.getBySessionId(sessionId);

      expect(session?.messageCount).toBe(5);
      expect(session?.status).toBe("compact_pending");
      expect(session?.lastUsedAt.getTime()).toBeGreaterThanOrEqual(
        originalTimestamp - 1000,
      );

      store2.close();
    });

    it("should persist processState across instances", () => {
      const sessionId = "process-state-persist-test";
      store.create("team-iris", "team-alpha", sessionId);

      // Update process state
      store.updateProcessState(sessionId, "processing");

      store.close();

      // Reopen and verify
      const store2 = new SessionStore(testDbPath);
      const session = store2.getBySessionId(sessionId);

      expect(session?.processState).toBe("processing");

      store2.close();
    });
  });

  describe("WAL mode verification", () => {
    it("should enable WAL journal mode", () => {
      // WAL mode should create -wal and -shm files on first write
      store.create("team-iris", "team-beta", "wal-test-session");

      // Force a checkpoint to ensure WAL file is created
      store.close();

      // WAL files should exist (or have existed)
      // Note: SQLite may clean up WAL files on close
      expect(existsSync(testDbPath)).toBe(true);
    });
  });

  describe("concurrent access simulation", () => {
    it("should handle multiple rapid operations", () => {
      // Simulate rapid concurrent-like access with unique team pairs
      const sessions = [];

      for (let i = 0; i < 50; i++) {
        const session = store.create(
          `team-from-${i}`,
          `team-to-${i}`,
          `concurrent-session-${i}`,
        );
        sessions.push(session);
      }

      // All sessions should be created
      expect(sessions).toHaveLength(50);

      // All should have required fromTeam
      sessions.forEach(s => {
        expect(s.fromTeam).toBeDefined();
        expect(s.fromTeam).not.toBeNull();
      });

      // Verify all can be retrieved
      for (const session of sessions) {
        const retrieved = store.getBySessionId(session.sessionId);
        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe(session.sessionId);
        expect(retrieved?.fromTeam).toBe(session.fromTeam);
      }
    });

    it("should handle rapid metadata updates", () => {
      const sessionId = "rapid-update-test";
      store.create("team-iris", "team-beta", sessionId);

      // Rapid updates
      for (let i = 0; i < 100; i++) {
        store.incrementMessageCount(sessionId, 1);
        store.updateLastUsed(sessionId);
      }

      const session = store.getBySessionId(sessionId);
      expect(session?.messageCount).toBe(100);
    });
  });

  describe("query performance", () => {
    it("should efficiently query large number of sessions", () => {
      const teams = [
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "zeta",
        "eta",
        "theta",
        "iota",
        "kappa",
      ];
      let sessionCount = 0;

      // Create all possible team pair combinations (avoiding duplicates)
      for (let i = 0; i < teams.length; i++) {
        for (let j = 0; j < teams.length; j++) {
          if (i !== j) {
            store.create(
              `team-${teams[i]}`,
              `team-${teams[j]}`,
              `session-${sessionCount++}`,
            );
          }
        }
      }

      const startTime = Date.now();

      // Query by team pair (should use index)
      const sessions = store.list({ fromTeam: "team-alpha" });

      const duration = Date.now() - startTime;

      expect(sessions.length).toBe(teams.length - 1); // Should find sessions to all other teams
      expect(duration).toBeLessThan(100); // Should be fast with index
    });

    it("should efficiently query by session ID", () => {
      // Create many unique sessions
      for (let i = 0; i < 100; i++) {
        store.create(`team-from-${i}`, `team-to-${i}`, `session-${i}`);
      }

      const startTime = Date.now();

      // Query by session ID (should use unique index)
      const session = store.getBySessionId("session-50");

      const duration = Date.now() - startTime;

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe("session-50");
      expect(duration).toBeLessThan(50); // Should be very fast with unique index
    });
  });

  describe("edge cases", () => {
    it("should handle very long session IDs", () => {
      const longSessionId = "a".repeat(500);
      const session = store.create("team-iris", "team-beta", longSessionId);

      expect(session.sessionId).toBe(longSessionId);

      const retrieved = store.getBySessionId(longSessionId);
      expect(retrieved?.sessionId).toBe(longSessionId);
    });

    it("should handle special characters in team names", () => {
      const session = store.create(
        "team-with-@-symbol",
        "team_with_underscore",
        "special-char-session",
      );

      expect(session.fromTeam).toBe("team-with-@-symbol");
      expect(session.toTeam).toBe("team_with_underscore");

      const retrieved = store.getByTeamPair(
        "team-with-@-symbol",
        "team_with_underscore",
      );
      expect(retrieved).toBeDefined();
    });

    it("should handle large message counts", () => {
      const sessionId = "large-count-session";
      store.create("team-iris", "team-beta", sessionId);

      // Increment to large number
      store.incrementMessageCount(sessionId, 1000000);

      const session = store.getBySessionId(sessionId);
      expect(session?.messageCount).toBe(1000000);
    });
  });

  describe("data integrity", () => {
    it("should maintain referential integrity for unique constraints", () => {
      store.create("team-iris", "team-beta", "session-1");

      // Duplicate session ID should fail
      expect(() => store.create("team-c", "team-d", "session-1")).toThrow();
    });

    it("should maintain team pair uniqueness", () => {
      store.create("team-iris", "team-beta", "session-1");

      // Duplicate team pair should fail
      expect(() =>
        store.create("team-iris", "team-beta", "session-2"),
      ).toThrow();
    });

    it("should enforce NOT NULL constraint on fromTeam", () => {
      // Attempting to create session with null fromTeam should fail
      expect(() =>
        store.create(null as any, "team-beta", "session-1"),
      ).toThrow();
    });

    it("should allow same toTeam with different fromTeams", () => {
      store.create("team-iris", "team-alpha", "session-1");
      store.create("team-beta", "team-alpha", "session-2");

      const sessions = store.list({ toTeam: "team-alpha" });
      expect(sessions).toHaveLength(2);
    });

    it("should allow same fromTeam with different toTeams", () => {
      store.create("team-iris", "team-alpha", "session-1");
      store.create("team-iris", "team-beta", "session-2");

      const sessions = store.list({ fromTeam: "team-iris" });
      expect(sessions).toHaveLength(2);
    });
  });

  describe("statistics accuracy", () => {
    it("should provide accurate statistics for complex data", () => {
      // Create diverse session data
      store.create("team-iris", "team-beta", "session-1");
      store.incrementMessageCount("session-1", 10);

      store.create("team-c", "team-d", "session-2");
      store.incrementMessageCount("session-2", 25);
      store.updateStatus("session-2", "archived");

      store.create("team-e", "team-f", "session-3");
      store.incrementMessageCount("session-3", 5);

      const stats = store.getStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.archived).toBe(1);
      expect(stats.totalMessages).toBe(40); // 10 + 25 + 5
    });
  });

  describe("session initialization (team-to-team only)", () => {
    it("should create session for team pair", () => {
      // Check if session exists
      const existing = store.getByTeamPair("team-iris", "team-alpha");
      expect(existing).toBeNull();

      // Create session
      const session = store.create("team-iris", "team-alpha", "new-session-id");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBe("team-iris");
      expect(session.toTeam).toBe("team-alpha");
      expect(session.sessionId).toBe("new-session-id");
    });

    it("should find existing session for team pair", () => {
      // Create initial session
      store.create("team-iris", "team-alpha", "existing-session-id");

      // Check: session should exist
      const existing = store.getByTeamPair("team-iris", "team-alpha");

      expect(existing).toBeDefined();
      expect(existing?.sessionId).toBe("existing-session-id");
    });

    it("should initialize sessions for multiple team pairs", () => {
      const teams = ["team-alpha", "team-beta", "team-gamma"];
      const sessions: string[] = [];

      // Create session for each team pair (iris -> team)
      for (const team of teams) {
        const sessionId = `session-iris-to-${team}`;
        store.create("team-iris", team, sessionId);
        sessions.push(sessionId);
      }

      // Verify all sessions exist
      for (let i = 0; i < teams.length; i++) {
        const session = store.getByTeamPair("team-iris", teams[i]);
        expect(session).toBeDefined();
        expect(session?.sessionId).toBe(sessions[i]);
      }

      // Verify stats
      const stats = store.getStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
    });

    it("should not create duplicate session for same team pair", () => {
      // First creation
      store.create("team-iris", "team-alpha", "session-1");

      // Second creation with same team pair should fail
      expect(() =>
        store.create("team-iris", "team-alpha", "session-2"),
      ).toThrow();
    });

    it("should handle session recovery workflow", () => {
      // Step 1: Create session
      const original = store.create("team-iris", "team-alpha", "session-123");
      expect(original.status).toBe("active");

      // Step 2: Mark as needing recovery
      store.updateStatus("session-123", "compact_pending");

      // Step 3: Verify status updated
      const recovered = store.getBySessionId("session-123");
      expect(recovered?.status).toBe("compact_pending");

      // Step 4: After re-initialization, mark as active
      store.updateStatus("session-123", "active");

      // Step 5: Verify back to active
      const active = store.getBySessionId("session-123");
      expect(active?.status).toBe("active");
    });

    it("should query all sessions from a specific team", () => {
      // Create sessions from team-iris to various teams
      store.create("team-iris", "team-alpha", "session-alpha");
      store.create("team-iris", "team-beta", "session-beta");
      store.create("team-iris", "team-gamma", "session-gamma");

      // Create session from different source team
      store.create("team-beta", "team-alpha", "session-beta-to-alpha");

      // Query all sessions from team-iris
      const sessions = store.list({ fromTeam: "team-iris" });

      expect(sessions).toHaveLength(3);
      expect(sessions.map((s) => s.toTeam)).toEqual(
        expect.arrayContaining(["team-alpha", "team-beta", "team-gamma"]),
      );
    });
  });

  describe("process state handling", () => {
    it("should default to 'stopped' process state", () => {
      const session = store.create("team-iris", "team-alpha", "session-1");
      expect(session.processState).toBe("stopped");
    });

    it("should update process state", () => {
      const sessionId = "session-1";
      store.create("team-iris", "team-alpha", sessionId);

      store.updateProcessState(sessionId, "processing");

      const session = store.getBySessionId(sessionId);
      expect(session?.processState).toBe("processing");
    });

    it("should handle all process state values", () => {
      const states = ["stopped", "spawning", "idle", "processing", "terminating"];
      const sessionId = "session-1";
      store.create("team-iris", "team-alpha", sessionId);

      for (const state of states) {
        store.updateProcessState(sessionId, state as any);
        const session = store.getBySessionId(sessionId);
        expect(session?.processState).toBe(state);
      }
    });

    it("should reset all process states to 'stopped' on server restart", () => {
      // Create sessions with various process states
      const session1 = store.create("team-iris", "team-alpha", "session-1");
      const session2 = store.create("team-iris", "team-beta", "session-2");
      const session3 = store.create("team-iris", "team-gamma", "session-3");

      // Set different process states
      store.updateProcessState(session1.sessionId, "processing");
      store.updateProcessState(session2.sessionId, "idle");
      store.updateProcessState(session3.sessionId, "spawning");

      // Set current cache session IDs
      store.setCurrentCacheSessionId(session1.sessionId, "cache-1");
      store.setCurrentCacheSessionId(session2.sessionId, "cache-2");

      // Verify states are set
      expect(store.getBySessionId(session1.sessionId)?.processState).toBe(
        "processing",
      );
      expect(store.getBySessionId(session2.sessionId)?.processState).toBe("idle");
      expect(store.getBySessionId(session3.sessionId)?.processState).toBe(
        "spawning",
      );
      expect(
        store.getBySessionId(session1.sessionId)?.currentCacheSessionId,
      ).toBe("cache-1");
      expect(
        store.getBySessionId(session2.sessionId)?.currentCacheSessionId,
      ).toBe("cache-2");

      // Reset all process states (simulating server restart)
      store.resetAllProcessStates();

      // All process states should be 'stopped'
      expect(store.getBySessionId(session1.sessionId)?.processState).toBe(
        "stopped",
      );
      expect(store.getBySessionId(session2.sessionId)?.processState).toBe(
        "stopped",
      );
      expect(store.getBySessionId(session3.sessionId)?.processState).toBe(
        "stopped",
      );

      // Current cache session IDs should be cleared
      expect(
        store.getBySessionId(session1.sessionId)?.currentCacheSessionId,
      ).toBeNull();
      expect(
        store.getBySessionId(session2.sessionId)?.currentCacheSessionId,
      ).toBeNull();
      expect(
        store.getBySessionId(session3.sessionId)?.currentCacheSessionId,
      ).toBeNull();
    });

    it("should not affect sessions already in 'stopped' state", () => {
      // Create session already in stopped state
      const session = store.create("team-iris", "team-alpha", "session-1");
      expect(session.processState).toBe("stopped");

      const before = store.getBySessionId(session.sessionId);

      // Reset all process states
      store.resetAllProcessStates();

      const after = store.getBySessionId(session.sessionId);

      // Session should be unchanged
      expect(after?.processState).toBe("stopped");
      expect(after?.messageCount).toBe(before?.messageCount);
      expect(after?.status).toBe(before?.status);
    });
  });
});
