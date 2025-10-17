/**
 * Unit tests for PendingPermissionsManager
 *
 * Tests permission request queue with timeout and Promise-based resolution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PendingPermissionsManager,
  type PendingPermissionRequest,
} from "../../../src/permissions/pending-manager.js";

// Mock logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe("PendingPermissionsManager", () => {
  let manager: PendingPermissionsManager;

  beforeEach(() => {
    manager = new PendingPermissionsManager(30000); // 30 second default timeout
  });

  afterEach(() => {
    // Clean up any pending permissions
    manager.clearAll();
  });

  describe("createPendingPermission()", () => {
    it("should create pending permission request", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls -la" },
        "Need to list files",
      );

      expect(promise).toBeInstanceOf(Promise);
      expect(manager.pendingCount).toBe(1);

      const pending = manager.getPendingRequests();
      expect(pending).toHaveLength(1);
      expect(pending[0].sessionId).toBe("session-123");
      expect(pending[0].teamName).toBe("team-alpha");
      expect(pending[0].toolName).toBe("bash");
      expect(pending[0].toolInput).toEqual({ command: "ls -la" });
      expect(pending[0].reason).toBe("Need to list files");

      // Resolve to prevent hanging test
      manager.resolvePendingPermission(pending[0].permissionId, true);
      await promise;
    });

    it("should emit permission:created event", async () => {
      const createdSpy = vi.fn();
      manager.on("permission:created", createdSpy);

      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "pwd" },
      );

      expect(createdSpy).toHaveBeenCalledOnce();
      expect(createdSpy.mock.calls[0][0]).toMatchObject({
        sessionId: "session-123",
        teamName: "team-alpha",
        toolName: "bash",
      });

      // Resolve to prevent hanging test
      const pending = manager.getPendingRequests()[0];
      manager.resolvePendingPermission(pending.permissionId, true);
      await promise;
    });

    it("should generate unique permission IDs", async () => {
      const promise1 = manager.createPendingPermission(
        "session-1",
        "team-a",
        "tool1",
        {},
      );
      const promise2 = manager.createPendingPermission(
        "session-2",
        "team-b",
        "tool2",
        {},
      );

      const pending = manager.getPendingRequests();
      expect(pending[0].permissionId).not.toBe(pending[1].permissionId);

      // Resolve both
      manager.resolvePendingPermission(pending[0].permissionId, true);
      manager.resolvePendingPermission(pending[1].permissionId, true);
      await Promise.all([promise1, promise2]);
    });

    it("should handle requests without reason", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
        undefined, // No reason
      );

      const pending = manager.getPendingRequests()[0];
      expect(pending.reason).toBeUndefined();

      manager.resolvePendingPermission(pending.permissionId, true);
      await promise;
    });
  });

  describe("resolvePendingPermission()", () => {
    it("should resolve pending permission with approval", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
      );

      const pending = manager.getPendingRequests()[0];
      const resolved = manager.resolvePendingPermission(
        pending.permissionId,
        true,
        "Approved by user",
      );

      expect(resolved).toBe(true);
      expect(manager.pendingCount).toBe(0);

      const response = await promise;
      expect(response.approved).toBe(true);
      expect(response.reason).toBe("Approved by user");
    });

    it("should resolve pending permission with denial", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "rm -rf /" },
      );

      const pending = manager.getPendingRequests()[0];
      const resolved = manager.resolvePendingPermission(
        pending.permissionId,
        false,
        "Command too dangerous",
      );

      expect(resolved).toBe(true);
      expect(manager.pendingCount).toBe(0);

      const response = await promise;
      expect(response.approved).toBe(false);
      expect(response.reason).toBe("Command too dangerous");
    });

    it("should emit permission:resolved event", async () => {
      const resolvedSpy = vi.fn();
      manager.on("permission:resolved", resolvedSpy);

      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
      );

      const pending = manager.getPendingRequests()[0];
      manager.resolvePendingPermission(pending.permissionId, true);

      expect(resolvedSpy).toHaveBeenCalledOnce();
      expect(resolvedSpy.mock.calls[0][0]).toMatchObject({
        permissionId: pending.permissionId,
        approved: true,
      });

      await promise;
    });

    it("should return false for non-existent permission ID", () => {
      const resolved = manager.resolvePendingPermission(
        "nonexistent-id",
        true,
      );

      expect(resolved).toBe(false);
    });

    it("should clear timeout when resolved", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
        undefined,
        5000, // 5 second timeout
      );

      const pending = manager.getPendingRequests()[0];

      // Resolve immediately
      manager.resolvePendingPermission(pending.permissionId, true);

      const response = await promise;
      expect(response.approved).toBe(true);

      // Wait past timeout to ensure it doesn't fire
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Should still be approved (not timed out)
      expect(response.approved).toBe(true);
    });
  });

  describe("timeout handling", () => {
    it("should auto-deny on timeout", async () => {
      const timeoutSpy = vi.fn();
      manager.on("permission:timeout", timeoutSpy);

      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
        undefined,
        50, // 50ms timeout
      );

      const pending = manager.getPendingRequests()[0];

      // Wait for timeout
      const response = await promise;

      expect(response.approved).toBe(false);
      expect(response.reason).toContain("timed out");
      expect(manager.pendingCount).toBe(0);
      expect(timeoutSpy).toHaveBeenCalledOnce();
    });

    it("should use custom timeout when specified", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
        undefined,
        100, // 100ms custom timeout
      );

      // Should not timeout before 100ms
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(manager.pendingCount).toBe(1);

      // Should timeout after 100ms
      await promise;
      expect(manager.pendingCount).toBe(0);
    });

    it("should use default timeout when not specified", async () => {
      const shortManager = new PendingPermissionsManager(100); // 100ms default

      const promise = shortManager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
      );

      // Should timeout after 100ms
      const response = await promise;
      expect(response.approved).toBe(false);

      shortManager.clearAll();
    });
  });

  describe("getPendingRequests()", () => {
    it("should return empty array when no pending permissions", () => {
      const pending = manager.getPendingRequests();
      expect(pending).toEqual([]);
    });

    it("should return all pending permissions", async () => {
      const promise1 = manager.createPendingPermission(
        "session-1",
        "team-a",
        "tool1",
        {},
      );
      const promise2 = manager.createPendingPermission(
        "session-2",
        "team-b",
        "tool2",
        {},
      );

      const pending = manager.getPendingRequests();
      expect(pending).toHaveLength(2);

      // Clean up
      pending.forEach((p) => manager.resolvePendingPermission(p.permissionId, true));
      await Promise.all([promise1, promise2]);
    });

    it("should not mutate internal state", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        {},
      );

      const pending = manager.getPendingRequests();
      pending.pop(); // Try to remove from returned array

      // Should still have 1 pending
      expect(manager.pendingCount).toBe(1);

      // Clean up
      const actualPending = manager.getPendingRequests();
      manager.resolvePendingPermission(actualPending[0].permissionId, true);
      await promise;
    });
  });

  describe("getPendingRequest()", () => {
    it("should return specific pending request by ID", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
      );

      const pending = manager.getPendingRequests()[0];
      const retrieved = manager.getPendingRequest(pending.permissionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.permissionId).toBe(pending.permissionId);
      expect(retrieved?.sessionId).toBe("session-123");

      // Clean up
      manager.resolvePendingPermission(pending.permissionId, true);
      await promise;
    });

    it("should return undefined for non-existent ID", () => {
      const retrieved = manager.getPendingRequest("nonexistent-id");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("cancelPendingPermission()", () => {
    it("should cancel pending permission", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        { command: "ls" },
      );

      const pending = manager.getPendingRequests()[0];
      const canceled = manager.cancelPendingPermission(pending.permissionId);

      expect(canceled).toBe(true);
      expect(manager.pendingCount).toBe(0);

      const response = await promise;
      expect(response.approved).toBe(false);
      expect(response.reason).toContain("canceled");
    });

    it("should return false for non-existent permission ID", () => {
      const canceled = manager.cancelPendingPermission("nonexistent-id");
      expect(canceled).toBe(false);
    });
  });

  describe("clearAll()", () => {
    it("should clear all pending permissions", async () => {
      const promise1 = manager.createPendingPermission(
        "session-1",
        "team-a",
        "tool1",
        {},
      );
      const promise2 = manager.createPendingPermission(
        "session-2",
        "team-b",
        "tool2",
        {},
      );
      const promise3 = manager.createPendingPermission(
        "session-3",
        "team-c",
        "tool3",
        {},
      );

      expect(manager.pendingCount).toBe(3);

      manager.clearAll();

      expect(manager.pendingCount).toBe(0);
      expect(manager.getPendingRequests()).toEqual([]);

      // All promises should resolve with denial
      const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);
      expect(r1.approved).toBe(false);
      expect(r2.approved).toBe(false);
      expect(r3.approved).toBe(false);
      expect(r1.reason).toContain("shutting down");
    });

    it("should be safe to call when empty", () => {
      expect(() => manager.clearAll()).not.toThrow();
      expect(manager.pendingCount).toBe(0);
    });
  });

  describe("pendingCount", () => {
    it("should return correct count", async () => {
      expect(manager.pendingCount).toBe(0);

      const promise1 = manager.createPendingPermission(
        "s1",
        "t1",
        "tool",
        {},
      );
      expect(manager.pendingCount).toBe(1);

      const promise2 = manager.createPendingPermission(
        "s2",
        "t2",
        "tool",
        {},
      );
      expect(manager.pendingCount).toBe(2);

      const pending = manager.getPendingRequests();
      manager.resolvePendingPermission(pending[0].permissionId, true);
      expect(manager.pendingCount).toBe(1);

      manager.resolvePendingPermission(pending[1].permissionId, true);
      expect(manager.pendingCount).toBe(0);

      await Promise.all([promise1, promise2]);
    });
  });

  describe("concurrent operations", () => {
    it("should handle multiple simultaneous requests", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        manager.createPendingPermission(
          `session-${i}`,
          `team-${i}`,
          "bash",
          { command: `cmd-${i}` },
        ),
      );

      expect(manager.pendingCount).toBe(10);

      const pending = manager.getPendingRequests();
      expect(pending).toHaveLength(10);

      // Resolve all
      pending.forEach((p, i) =>
        manager.resolvePendingPermission(p.permissionId, i % 2 === 0),
      );

      const responses = await Promise.all(promises);

      expect(responses[0].approved).toBe(true);
      expect(responses[1].approved).toBe(false);
      expect(manager.pendingCount).toBe(0);
    });

    it("should handle rapid creation and resolution", async () => {
      const results: boolean[] = [];

      for (let i = 0; i < 5; i++) {
        const promise = manager.createPendingPermission(
          `session-${i}`,
          `team-${i}`,
          "bash",
          {},
        );

        const pending = manager.getPendingRequests();
        manager.resolvePendingPermission(pending[pending.length - 1].permissionId, true);

        const response = await promise;
        results.push(response.approved);
      }

      expect(results).toEqual([true, true, true, true, true]);
      expect(manager.pendingCount).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty tool input", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        {},
      );

      const pending = manager.getPendingRequests()[0];
      expect(pending.toolInput).toEqual({});

      manager.resolvePendingPermission(pending.permissionId, true);
      await promise;
    });

    it("should handle complex tool input", async () => {
      const complexInput = {
        nested: {
          object: {
            with: ["arrays", "and", "strings"],
          },
        },
        number: 42,
        boolean: true,
      };

      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "complex-tool",
        complexInput,
      );

      const pending = manager.getPendingRequests()[0];
      expect(pending.toolInput).toEqual(complexInput);

      manager.resolvePendingPermission(pending.permissionId, true);
      await promise;
    });

    it("should handle very short timeouts", async () => {
      const promise = manager.createPendingPermission(
        "session-123",
        "team-alpha",
        "bash",
        {},
        undefined,
        1, // 1ms timeout
      );

      const response = await promise;
      expect(response.approved).toBe(false);
    });
  });
});
