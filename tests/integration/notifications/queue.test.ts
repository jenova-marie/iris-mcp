/**
 * Integration tests for NotificationQueue
 * Tests actual SQLite database operations and persistence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NotificationQueue } from "../../../src/notifications/queue.js";
import { existsSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";

describe("NotificationQueue Integration Tests", () => {
  const TEST_DB_PATH = "./test-data/notifications-test.db";
  let queue: NotificationQueue;

  beforeEach(() => {
    // Ensure clean state - remove test database if exists
    const testDataDir = dirname(TEST_DB_PATH);
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }

    // Create fresh queue with test database
    queue = new NotificationQueue(TEST_DB_PATH);
  });

  afterEach(() => {
    // Close database connection
    if (queue) {
      queue.close();
    }

    // Clean up test database
    const testDataDir = dirname(TEST_DB_PATH);
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("Basic Operations", () => {
    it("should add a notification to the queue", () => {
      const notification = queue.add(
        "frontend",
        "Please review the PR",
        "backend",
      );

      expect(notification).toBeDefined();
      expect(notification.id).toBeDefined();
      expect(notification.toTeam).toBe("frontend");
      expect(notification.fromTeam).toBe("backend");
      expect(notification.message).toBe("Please review the PR");
      expect(notification.status).toBe("pending");
      expect(notification.createdAt).toBeDefined();
      expect(notification.expiresAt).toBeDefined();
    });

    it("should add notification without fromTeam", () => {
      const notification = queue.add("frontend", "System notification");

      expect(notification.fromTeam).toBeUndefined();
      expect(notification.toTeam).toBe("frontend");
      expect(notification.message).toBe("System notification");
    });

    it("should get pending notifications for a team", () => {
      // Add multiple notifications
      queue.add("frontend", "Message 1", "backend");
      queue.add("frontend", "Message 2", "backend");
      queue.add("backend", "Message 3", "frontend");

      const pending = queue.getPending("frontend");

      expect(pending).toHaveLength(2);
      expect(pending[0].toTeam).toBe("frontend");
      expect(pending[1].toTeam).toBe("frontend");
    });

    it("should return empty array for team with no notifications", () => {
      const pending = queue.getPending("nonexistent-team");
      expect(pending).toHaveLength(0);
    });

    it("should mark notification as read", () => {
      const notification = queue.add("frontend", "Test message");

      const marked = queue.markAsRead(notification.id);
      expect(marked).toBe(true);

      // Verify it's no longer in pending
      const pending = queue.getPending("frontend");
      expect(pending).toHaveLength(0);

      // Verify it's marked as read
      const retrieved = queue.getById(notification.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.status).toBe("read");
      expect(retrieved!.readAt).toBeDefined();
    });

    it("should return false when marking non-existent notification as read", () => {
      const marked = queue.markAsRead("non-existent-id");
      expect(marked).toBe(false);
    });

    it("should mark all pending notifications as read", () => {
      // Add multiple notifications to same team
      queue.add("frontend", "Message 1");
      queue.add("frontend", "Message 2");
      queue.add("frontend", "Message 3");
      queue.add("backend", "Message 4");

      const count = queue.markAllAsRead("frontend");

      expect(count).toBe(3);

      // Verify frontend has no pending
      const pendingFrontend = queue.getPending("frontend");
      expect(pendingFrontend).toHaveLength(0);

      // Verify backend still has pending
      const pendingBackend = queue.getPending("backend");
      expect(pendingBackend).toHaveLength(1);
    });

    it("should get notification by ID", () => {
      const notification = queue.add("frontend", "Test message", "backend");

      const retrieved = queue.getById(notification.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(notification.id);
      expect(retrieved!.message).toBe("Test message");
      expect(retrieved!.toTeam).toBe("frontend");
      expect(retrieved!.fromTeam).toBe("backend");
    });

    it("should return null for non-existent notification ID", () => {
      const retrieved = queue.getById("non-existent-id");
      expect(retrieved).toBeNull();
    });

    it("should get notification history", async () => {
      // Add notifications with different statuses
      const n1 = queue.add("frontend", "Message 1");

      await new Promise((resolve) => setTimeout(resolve, 10));
      const n2 = queue.add("frontend", "Message 2");

      await new Promise((resolve) => setTimeout(resolve, 10));
      const n3 = queue.add("frontend", "Message 3");

      queue.markAsRead(n2.id);

      const history = queue.getHistory("frontend");

      expect(history).toHaveLength(3);
      // Should be ordered by created_at DESC
      expect(history[0].id).toBe(n3.id);
      expect(history[1].id).toBe(n2.id);
      expect(history[2].id).toBe(n1.id);
    });

    it("should limit history results", () => {
      // Add more notifications than limit
      for (let i = 0; i < 10; i++) {
        queue.add("frontend", `Message ${i}`);
      }

      const history = queue.getHistory("frontend", 5);

      expect(history).toHaveLength(5);
    });

    it("should delete notification", () => {
      const notification = queue.add("frontend", "Test message");

      const deleted = queue.delete(notification.id);
      expect(deleted).toBe(true);

      // Verify it's gone
      const retrieved = queue.getById(notification.id);
      expect(retrieved).toBeNull();
    });

    it("should return false when deleting non-existent notification", () => {
      const deleted = queue.delete("non-existent-id");
      expect(deleted).toBe(false);
    });
  });

  describe("Statistics", () => {
    it("should get correct statistics", () => {
      // Add notifications with different statuses
      const n1 = queue.add("frontend", "Message 1");
      const n2 = queue.add("frontend", "Message 2");
      queue.add("frontend", "Message 3");
      queue.add("backend", "Message 4");

      // Mark some as read
      queue.markAsRead(n1.id);
      queue.markAsRead(n2.id);

      const stats = queue.getStats();

      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(2);
      expect(stats.read).toBe(2);
      expect(stats.expired).toBe(0);
    });

    it("should return zero stats for empty queue", () => {
      const stats = queue.getStats();

      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.read).toBe(0);
      expect(stats.expired).toBe(0);
    });
  });

  describe("TTL and Expiration", () => {
    it("should set expiration based on TTL", () => {
      const ttlDays = 7;
      const notification = queue.add(
        "frontend",
        "Test message",
        "backend",
        ttlDays,
      );

      const expectedExpiration =
        notification.createdAt + ttlDays * 24 * 60 * 60 * 1000;

      // Allow 1 second tolerance for test execution time
      expect(notification.expiresAt).toBeGreaterThanOrEqual(
        expectedExpiration - 1000,
      );
      expect(notification.expiresAt).toBeLessThanOrEqual(
        expectedExpiration + 1000,
      );
    });

    it("should use default 30 day TTL when not specified", () => {
      const notification = queue.add("frontend", "Test message");

      const expectedExpiration =
        notification.createdAt + 30 * 24 * 60 * 60 * 1000;

      expect(notification.expiresAt).toBeGreaterThanOrEqual(
        expectedExpiration - 1000,
      );
      expect(notification.expiresAt).toBeLessThanOrEqual(
        expectedExpiration + 1000,
      );
    });

    it("should mark expired notifications during cleanup", async () => {
      // Add notification with very short TTL (0 days = already expired)
      queue.add("frontend", "Expired message", "backend", 0);

      // Add normal notification
      queue.add("frontend", "Valid message", "backend", 30);

      // Wait to ensure expiration time has passed (TTL=0 means expiresAt = createdAt)
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Run cleanup
      queue.cleanup();

      // Check stats
      const stats = queue.getStats();
      expect(stats.expired).toBe(1);
      expect(stats.pending).toBe(1);
    });

    it("should delete old expired and read notifications during cleanup", async () => {
      // We can't easily test deletion of old (30+ days) notifications
      // without mocking time, but we can verify cleanup doesn't delete recent ones
      const n1 = queue.add("frontend", "Message 1");

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      const n2 = queue.add("frontend", "Message 2", "backend", 0);

      queue.markAsRead(n1.id);

      // Wait to ensure expiration time has passed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Run cleanup
      queue.cleanup();

      // Should not have deleted recent notifications (even if expired or read)
      const stats = queue.getStats();
      expect(stats.total).toBe(2);

      // Both notifications should still exist
      const retrieved1 = queue.getById(n1.id);
      const retrieved2 = queue.getById(n2.id);
      expect(retrieved1).toBeDefined();
      expect(retrieved2).toBeDefined();
    });
  });

  describe("Database Persistence", () => {
    it("should persist notifications across queue instances", () => {
      // Add notification
      const notification = queue.add(
        "frontend",
        "Persistent message",
        "backend",
      );

      // Close the queue
      queue.close();

      // Create new queue instance with same database
      const newQueue = new NotificationQueue(TEST_DB_PATH);

      // Should be able to retrieve the notification
      const retrieved = newQueue.getById(notification.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(notification.id);
      expect(retrieved!.message).toBe("Persistent message");

      newQueue.close();
    });

    it("should maintain stats across queue instances", () => {
      // Add multiple notifications
      queue.add("frontend", "Message 1");
      queue.add("frontend", "Message 2");
      const n3 = queue.add("backend", "Message 3");
      queue.markAsRead(n3.id);

      queue.close();

      // Create new queue instance
      const newQueue = new NotificationQueue(TEST_DB_PATH);

      const stats = newQueue.getStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(2);
      expect(stats.read).toBe(1);

      newQueue.close();
    });
  });

  describe("Multiple Teams", () => {
    it("should isolate notifications by team", () => {
      queue.add("frontend", "Frontend message 1");
      queue.add("frontend", "Frontend message 2");
      queue.add("backend", "Backend message 1");
      queue.add("mobile", "Mobile message 1");

      const frontendPending = queue.getPending("frontend");
      const backendPending = queue.getPending("backend");
      const mobilePending = queue.getPending("mobile");

      expect(frontendPending).toHaveLength(2);
      expect(backendPending).toHaveLength(1);
      expect(mobilePending).toHaveLength(1);
    });

    it("should only mark notifications for specified team as read", () => {
      queue.add("frontend", "Frontend message");
      queue.add("backend", "Backend message");

      queue.markAllAsRead("frontend");

      const frontendPending = queue.getPending("frontend");
      const backendPending = queue.getPending("backend");

      expect(frontendPending).toHaveLength(0);
      expect(backendPending).toHaveLength(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle limit parameter correctly in getPending", () => {
      // Add 10 notifications
      for (let i = 0; i < 10; i++) {
        queue.add("frontend", `Message ${i}`);
      }

      const pending = queue.getPending("frontend", 5);
      expect(pending).toHaveLength(5);
    });

    it("should handle attempting to mark already-read notification as read", () => {
      const notification = queue.add("frontend", "Test message");

      // Mark as read first time
      const first = queue.markAsRead(notification.id);
      expect(first).toBe(true);

      // Try to mark as read again
      const second = queue.markAsRead(notification.id);
      expect(second).toBe(false); // Should return false (no changes)
    });

    it("should handle marking all as read when no pending notifications", () => {
      const count = queue.markAllAsRead("frontend");
      expect(count).toBe(0);
    });

    it("should create data directory if it does not exist", () => {
      // Close existing queue
      queue.close();

      // Remove test data directory
      const testDataDir = dirname(TEST_DB_PATH);
      if (existsSync(testDataDir)) {
        rmSync(testDataDir, { recursive: true, force: true });
      }

      // Create new queue - should create directory
      const newQueue = new NotificationQueue(TEST_DB_PATH);

      expect(existsSync(testDataDir)).toBe(true);
      expect(existsSync(TEST_DB_PATH)).toBe(true);

      newQueue.close();
    });
  });

  describe("Ordering", () => {
    it("should return pending notifications in DESC order by created_at", async () => {
      // Add notifications with small delays to ensure different timestamps
      queue.add("frontend", "First message");

      await new Promise((resolve) => setTimeout(resolve, 10));
      queue.add("frontend", "Second message");

      await new Promise((resolve) => setTimeout(resolve, 10));
      queue.add("frontend", "Third message");

      const pending = queue.getPending("frontend");

      // Should be newest first
      expect(pending[0].message).toBe("Third message");
      expect(pending[1].message).toBe("Second message");
      expect(pending[2].message).toBe("First message");
    });

    it("should return history in DESC order by created_at", async () => {
      queue.add("frontend", "First message");

      await new Promise((resolve) => setTimeout(resolve, 10));
      const n2 = queue.add("frontend", "Second message");

      await new Promise((resolve) => setTimeout(resolve, 10));
      queue.add("frontend", "Third message");

      queue.markAsRead(n2.id);

      const history = queue.getHistory("frontend");

      // Should be newest first regardless of status
      expect(history[0].message).toBe("Third message");
      expect(history[1].message).toBe("Second message");
      expect(history[2].message).toBe("First message");
    });
  });
});
