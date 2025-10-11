/**
 * Unit tests for SessionStore
 *
 * Tests SQLite database operations for session metadata
 * as documented in docs/SESSION.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { SessionStore } from "../../../src/session/session-store.js";
import type { SessionInfo } from "../../../src/session/types.js";

describe("SessionStore", () => {
  let store: SessionStore;
  const testDbPath = resolve(process.cwd(), "tests/data/test-session-store.db");

  beforeEach(() => {
    // Create fresh store for each test
    store = new SessionStore(testDbPath);
  });

  afterEach(() => {
    // Clean up
    store.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
  });

  describe("initialization", () => {
    it("should create database file", () => {
      expect(existsSync(testDbPath)).toBe(true);
    });

    it("should create tables and indexes", () => {
      // Query table info to verify schema exists
      const session = store.create("team-alpha", "team-beta", "test-uuid");
      expect(session).toBeDefined();
      expect(session.id).toBeGreaterThan(0);
    });
  });

  describe("create", () => {
    it("should create session with fromTeam", () => {
      const sessionId = "uuid-12345";
      const session = store.create("frontend", "backend", sessionId);

      expect(session.fromTeam).toBe("frontend");
      expect(session.toTeam).toBe("backend");
      expect(session.sessionId).toBe(sessionId);
      expect(session.messageCount).toBe(0);
      expect(session.status).toBe("active");
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastUsedAt).toBeInstanceOf(Date);
    });

    it("should create session with null fromTeam", () => {
      const sessionId = "uuid-null-from";
      const session = store.create(null, "backend", sessionId);

      expect(session.fromTeam).toBe(null);
      expect(session.toTeam).toBe("backend");
      expect(session.sessionId).toBe(sessionId);
    });

    it("should enforce unique sessionId constraint", () => {
      const sessionId = "duplicate-uuid";
      store.create("team-alpha", "team-beta", sessionId);

      // Attempting to create with same sessionId should throw
      expect(() => store.create("team-c", "team-d", sessionId)).toThrow();
    });

    it("should enforce unique team pair constraint", () => {
      store.create("team-alpha", "team-beta", "session-1");

      // Attempting to create same team pair should throw
      expect(() =>
        store.create("team-alpha", "team-beta", "session-2"),
      ).toThrow();
    });

    it("should allow different team pairs", () => {
      const session1 = store.create("team-alpha", "team-beta", "session-1");
      const session2 = store.create("team-beta", "team-alpha", "session-2");

      expect(session1.sessionId).toBe("session-1");
      expect(session2.sessionId).toBe("session-2");
    });
  });

  describe("getByTeamPair", () => {
    it("should retrieve session by team pair", () => {
      const created = store.create("frontend", "backend", "uuid-123");

      const retrieved = store.getByTeamPair("frontend", "backend");

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe("uuid-123");
      expect(retrieved?.fromTeam).toBe("frontend");
      expect(retrieved?.toTeam).toBe("backend");
    });

    it("should handle null fromTeam", () => {
      store.create(null, "backend", "uuid-null");

      const retrieved = store.getByTeamPair(null, "backend");

      expect(retrieved).toBeDefined();
      expect(retrieved?.fromTeam).toBe(null);
      expect(retrieved?.toTeam).toBe("backend");
    });

    it("should return null for non-existent team pair", () => {
      const result = store.getByTeamPair("nonexistent", "team");

      expect(result).toBe(null);
    });

    it("should distinguish between different team pairs", () => {
      store.create("team-alpha", "team-beta", "session-ab");
      store.create("team-beta", "team-alpha", "session-ba");

      const ab = store.getByTeamPair("team-alpha", "team-beta");
      const ba = store.getByTeamPair("team-beta", "team-alpha");

      expect(ab?.sessionId).toBe("session-ab");
      expect(ba?.sessionId).toBe("session-ba");
    });
  });

  describe("getBySessionId", () => {
    it("should retrieve session by session ID", () => {
      store.create("team-alpha", "team-beta", "unique-session-id");

      const retrieved = store.getBySessionId("unique-session-id");

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe("unique-session-id");
      expect(retrieved?.fromTeam).toBe("team-alpha");
      expect(retrieved?.toTeam).toBe("team-beta");
    });

    it("should return null for non-existent session ID", () => {
      const result = store.getBySessionId("nonexistent-uuid");

      expect(result).toBe(null);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      // Create test data
      store.create("frontend", "backend", "session-1");
      store.create("mobile", "backend", "session-2");
      store.create(null, "backend", "session-3");
      store.create("frontend", "database", "session-4");
    });

    it("should list all sessions when no filters", () => {
      const sessions = store.list();

      expect(sessions).toHaveLength(4);
    });

    it("should filter by fromTeam", () => {
      const sessions = store.list({ fromTeam: "frontend" });

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.fromTeam === "frontend")).toBe(true);
    });

    it("should filter by null fromTeam", () => {
      const sessions = store.list({ fromTeam: null });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].fromTeam).toBe(null);
      expect(sessions[0].toTeam).toBe("backend");
    });

    it("should filter by toTeam", () => {
      const sessions = store.list({ toTeam: "backend" });

      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.toTeam === "backend")).toBe(true);
    });

    it("should filter by status", () => {
      store.updateStatus("session-1", "archived");

      const active = store.list({ status: "active" });
      const archived = store.list({ status: "archived" });

      expect(active).toHaveLength(3);
      expect(archived).toHaveLength(1);
      expect(archived[0].sessionId).toBe("session-1");
    });

    it("should respect limit parameter", () => {
      const sessions = store.list({ limit: 2 });

      expect(sessions).toHaveLength(2);
    });

    it("should order by last_used_at DESC", () => {
      // Update timestamps
      store.updateLastUsed("session-1");

      const sessions = store.list();

      // Most recently used should be first
      expect(sessions[0].sessionId).toBe("session-1");
    });
  });

  describe("updateLastUsed", () => {
    it("should update last_used_at timestamp", async () => {
      const session = store.create("team-alpha", "team-beta", "session-update");
      const originalTimestamp = session.lastUsedAt.getTime();

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      store.updateLastUsed("session-update");

      const updated = store.getBySessionId("session-update");
      expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(originalTimestamp);
    });
  });

  describe("incrementMessageCount", () => {
    it("should increment message count by 1 by default", () => {
      store.create("team-alpha", "team-beta", "session-count");

      store.incrementMessageCount("session-count");

      const session = store.getBySessionId("session-count");
      expect(session?.messageCount).toBe(1);
    });

    it("should increment message count by specified amount", () => {
      store.create("team-alpha", "team-beta", "session-count-multi");

      store.incrementMessageCount("session-count-multi", 5);

      const session = store.getBySessionId("session-count-multi");
      expect(session?.messageCount).toBe(5);
    });

    it("should accumulate message counts", () => {
      store.create("team-alpha", "team-beta", "session-accumulate");

      store.incrementMessageCount("session-accumulate", 3);
      store.incrementMessageCount("session-accumulate", 2);
      store.incrementMessageCount("session-accumulate", 1);

      const session = store.getBySessionId("session-accumulate");
      expect(session?.messageCount).toBe(6);
    });
  });

  describe("updateStatus", () => {
    it("should update session status", () => {
      store.create("team-alpha", "team-beta", "session-status");

      store.updateStatus("session-status", "compact_pending");

      let session = store.getBySessionId("session-status");
      expect(session?.status).toBe("compact_pending");

      store.updateStatus("session-status", "archived");

      session = store.getBySessionId("session-status");
      expect(session?.status).toBe("archived");
    });
  });

  describe("delete", () => {
    it("should delete session by session ID", () => {
      store.create("team-alpha", "team-beta", "session-delete");

      let session = store.getBySessionId("session-delete");
      expect(session).toBeDefined();

      store.delete("session-delete");

      session = store.getBySessionId("session-delete");
      expect(session).toBe(null);
    });
  });

  describe("deleteByTeamPair", () => {
    it("should delete session by team pair", () => {
      store.create("team-alpha", "team-beta", "session-pair-delete");

      let session = store.getByTeamPair("team-alpha", "team-beta");
      expect(session).toBeDefined();

      store.deleteByTeamPair("team-alpha", "team-beta");

      session = store.getByTeamPair("team-alpha", "team-beta");
      expect(session).toBe(null);
    });

    it("should handle null fromTeam", () => {
      store.create(null, "team-beta", "session-null-delete");

      store.deleteByTeamPair(null, "team-beta");

      const session = store.getByTeamPair(null, "team-beta");
      expect(session).toBe(null);
    });
  });

  describe("getStats", () => {
    it("should return zero stats for empty database", () => {
      const stats = store.getStats();

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.archived).toBe(0);
      expect(stats.totalMessages).toBe(0);
    });

    it("should count total sessions", () => {
      store.create("team-alpha", "team-beta", "session-1");
      store.create("team-c", "team-d", "session-2");

      const stats = store.getStats();

      expect(stats.total).toBe(2);
    });

    it("should count sessions by status", () => {
      store.create("team-alpha", "team-beta", "session-1");
      store.create("team-c", "team-d", "session-2");
      store.create("team-e", "team-f", "session-3");

      store.updateStatus("session-1", "archived");
      store.updateStatus("session-2", "archived");

      const stats = store.getStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.archived).toBe(2);
    });

    it("should sum total messages across all sessions", () => {
      store.create("team-alpha", "team-beta", "session-1");
      store.create("team-c", "team-d", "session-2");

      store.incrementMessageCount("session-1", 10);
      store.incrementMessageCount("session-2", 25);

      const stats = store.getStats();

      expect(stats.totalMessages).toBe(35);
    });
  });
});
