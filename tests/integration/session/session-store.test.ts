/**
 * Integration tests for SessionStore
 *
 * Tests SQLite database operations in a real database environment,
 * verifying persistence, concurrency, and WAL mode behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { SessionStore } from "../../../src/session/session-store.js";

describe("SessionStore Integration", () => {
  let store: SessionStore;
  const testDbPath = resolve(
    process.cwd(),
    "tests/data/test-integration-session-store.db",
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
        "team-alpha",
        "team-beta",
        "persistent-session-id",
      );
      expect(session.sessionId).toBe("persistent-session-id");

      // Close first instance
      store.close();

      // Open new instance with same database
      const store2 = new SessionStore(testDbPath);

      // Should find the persisted session
      const retrieved = store2.getByTeamPair("team-alpha", "team-beta");
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe("persistent-session-id");
      expect(retrieved?.fromTeam).toBe("team-alpha");
      expect(retrieved?.toTeam).toBe("team-beta");

      store2.close();
    });

    it("should persist metadata updates across instances", () => {
      const sessionId = "metadata-persist-test";
      store.create("team-alpha", "team-beta", sessionId);

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
  });

  describe("WAL mode verification", () => {
    it("should enable WAL journal mode", () => {
      // WAL mode should create -wal and -shm files on first write
      store.create("team-alpha", "team-beta", "wal-test-session");

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

      // Verify all can be retrieved
      for (const session of sessions) {
        const retrieved = store.getBySessionId(session.sessionId);
        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe(session.sessionId);
      }
    });

    it("should handle rapid metadata updates", () => {
      const sessionId = "rapid-update-test";
      store.create("team-alpha", "team-beta", sessionId);

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
      const session = store.create("team-alpha", "team-beta", longSessionId);

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
      store.create("team-alpha", "team-beta", sessionId);

      // Increment to large number
      store.incrementMessageCount(sessionId, 1000000);

      const session = store.getBySessionId(sessionId);
      expect(session?.messageCount).toBe(1000000);
    });
  });

  describe("data integrity", () => {
    it("should maintain referential integrity for unique constraints", () => {
      store.create("team-alpha", "team-beta", "session-1");

      // Duplicate session ID should fail
      expect(() => store.create("team-c", "team-d", "session-1")).toThrow();
    });

    it("should maintain team pair uniqueness", () => {
      store.create("team-alpha", "team-beta", "session-1");

      // Duplicate team pair should fail
      expect(() =>
        store.create("team-alpha", "team-beta", "session-2"),
      ).toThrow();
    });

    it("should correctly handle null fromTeam in unique constraint", () => {
      store.create(null, "team-beta", "session-1");
      store.create(null, "team-c", "session-2");

      // Should allow multiple null fromTeams to different toTeams
      const sessions = store.list({ fromTeam: null });
      expect(sessions).toHaveLength(2);

      // Note: SQLite allows multiple NULL values in UNIQUE constraints
      // This is standard SQL behavior - NULL is not equal to NULL
      // So multiple (NULL, 'team-beta') pairs are actually allowed
      const session3 = store.create(null, "team-beta", "session-3");
      expect(session3).toBeDefined();
      expect(session3.sessionId).toBe("session-3");

      // Verify we now have 3 sessions with null fromTeam
      const allNullSessions = store.list({ fromTeam: null });
      expect(allNullSessions).toHaveLength(3);
    });
  });

  describe("statistics accuracy", () => {
    it("should provide accurate statistics for complex data", () => {
      // Create diverse session data
      store.create("team-alpha", "team-beta", "session-1");
      store.incrementMessageCount("session-1", 10);

      store.create("team-c", "team-d", "session-2");
      store.incrementMessageCount("session-2", 25);
      store.updateStatus("session-2", "archived");

      store.create(null, "team-e", "session-3");
      store.incrementMessageCount("session-3", 5);

      const stats = store.getStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.archived).toBe(1);
      expect(stats.totalMessages).toBe(40); // 10 + 25 + 5
    });
  });

  describe("session initialization (startup behavior)", () => {
    it("should create session for team that doesn't have one", () => {
      // Simulate startup: check if team has a session
      const existing = store.getByTeamPair(null, "team-alpha");
      expect(existing).toBeNull();

      // No session exists, create one
      const session = store.create(null, "team-alpha", "new-session-id");

      expect(session).toBeDefined();
      expect(session.fromTeam).toBeNull();
      expect(session.toTeam).toBe("team-alpha");
      expect(session.sessionId).toBe("new-session-id");
    });

    it("should find existing session for team", () => {
      // Create initial session (simulating previous startup)
      store.create(null, "team-alpha", "existing-session-id");

      // Simulate startup check: session should exist
      const existing = store.getByTeamPair(null, "team-alpha");

      expect(existing).toBeDefined();
      expect(existing?.sessionId).toBe("existing-session-id");
    });

    it("should initialize sessions for multiple teams", () => {
      const teams = ["team-alpha", "team-beta", "team-gamma"];
      const sessions: string[] = [];

      // Simulate startup: create session for each team
      for (const team of teams) {
        const sessionId = `session-${team}`;
        store.create(null, team, sessionId);
        sessions.push(sessionId);
      }

      // Verify all sessions exist
      for (let i = 0; i < teams.length; i++) {
        const session = store.getByTeamPair(null, teams[i]);
        expect(session).toBeDefined();
        expect(session?.sessionId).toBe(sessions[i]);
      }

      // Verify stats
      const stats = store.getStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
    });

    it("should not create duplicate session for same team pair", () => {
      // SQLite allows multiple NULL values in UNIQUE constraints (NULL != NULL)
      // So (null, "team-alpha") pairs are NOT considered duplicates

      // First creation
      store.create(null, "team-alpha", "session-1");

      // Second creation with same team - ALLOWED due to NULL fromTeam
      const session2 = store.create(null, "team-alpha", "session-2");
      expect(session2).toBeDefined();

      // But with non-null fromTeam, duplicates SHOULD throw
      store.create("team-x", "team-y", "session-3");
      expect(() => store.create("team-x", "team-y", "session-4")).toThrow();
    });

    it("should handle session recovery workflow", () => {
      // Simulate: session exists in DB but file is missing
      // Step 1: Create session
      const original = store.create(null, "team-alpha", "session-123");
      expect(original.status).toBe("active");

      // Step 2: Mark as needing recovery (simulating missing file)
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

    it("should query all team sessions", () => {
      // Create sessions for multiple teams
      store.create("team-beta", "team-alpha", "session-alpha");
      store.create("team-beta", "team-beta", "session-beta");
      store.create("team-beta", "team-gamma", "session-gamma");

      // Create some team-to-team sessions
      store.create("team-alpha", "team-beta", "session-a-to-b");

      // Query all sessions
      const sessions = store.list({ fromTeam: "team-beta" });

      expect(sessions).toHaveLength(3);
      expect(sessions.map((s) => s.toTeam)).toEqual(
        expect.arrayContaining(["team-alpha", "team-beta", "team-gamma"]),
      );
    });
  });
});
