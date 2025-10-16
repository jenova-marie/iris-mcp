/**
 * Unit tests for LocalTransport
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalTransport } from "../../../src/transport/local-transport.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";

// Mock logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe("LocalTransport", () => {
  const testConfig: IrisConfig = {
    path: process.cwd(),
    description: "Test team",
    skipPermissions: true,
  };

  let transport: LocalTransport;

  beforeEach(() => {
    transport = new LocalTransport("team-test", testConfig, "session-123");
  });

  describe("constructor", () => {
    it("should create instance with correct initial state", () => {
      expect(transport).toBeDefined();
      expect(transport.isReady()).toBe(false);
      expect(transport.isBusy()).toBe(false);
    });

    it("should initialize metrics", () => {
      const metrics = transport.getMetrics();
      expect(metrics).toMatchObject({
        uptime: 0,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
    });

    it("should have RxJS observables", () => {
      expect(transport.status$).toBeDefined();
      expect(transport.errors$).toBeDefined();
      expect(typeof transport.status$.subscribe).toBe("function");
      expect(typeof transport.errors$.subscribe).toBe("function");
    });
  });

  describe("isReady()", () => {
    it("should return false before spawn", () => {
      expect(transport.isReady()).toBe(false);
    });
  });

  describe("isBusy()", () => {
    it("should return false before any operations", () => {
      expect(transport.isBusy()).toBe(false);
    });
  });

  describe("getMetrics()", () => {
    it("should return initial metrics", () => {
      const metrics = transport.getMetrics();
      expect(metrics.uptime).toBe(0);
      expect(metrics.messagesProcessed).toBe(0);
      expect(metrics.lastResponseAt).toBeNull();
    });

    it("should return consistent metrics on multiple calls", () => {
      const metrics1 = transport.getMetrics();
      const metrics2 = transport.getMetrics();

      expect(metrics1.uptime).toBe(metrics2.uptime);
      expect(metrics1.messagesProcessed).toBe(metrics2.messagesProcessed);
      expect(metrics1.lastResponseAt).toBe(metrics2.lastResponseAt);
    });
  });

  describe("terminate()", () => {
    it("should resolve immediately when not spawned", async () => {
      await expect(transport.terminate()).resolves.toBeUndefined();
    });

    it("should be idempotent", async () => {
      await transport.terminate();
      await expect(transport.terminate()).resolves.toBeUndefined();
    });
  });

  describe("cancel()", () => {
    it("should not throw when called on unspawned transport", () => {
      expect(() => transport.cancel()).not.toThrow();
    });
  });

  describe("observable subscriptions", () => {
    it("should support subscribing to status$", () => {
      const statusValues: any[] = [];
      const subscription = transport.status$.subscribe((status) => {
        statusValues.push(status);
      });

      // Should get initial value (STOPPED) immediately from BehaviorSubject
      expect(statusValues.length).toBeGreaterThan(0);

      subscription.unsubscribe();
    });

    it("should support subscribing to errors$", () => {
      const errors: any[] = [];
      const subscription = transport.errors$.subscribe((error) => {
        errors.push(error);
      });

      // errors$ is a Subject (no initial value)
      expect(errors.length).toBe(0);

      subscription.unsubscribe();
    });
  });

  describe("configuration handling", () => {
    it("should accept different team names", () => {
      const transport1 = new LocalTransport("team-a", testConfig, "s1");
      const transport2 = new LocalTransport("team-b", testConfig, "s2");

      expect(transport1.isReady()).toBe(false);
      expect(transport2.isReady()).toBe(false);
    });

    it("should handle configs with optional fields", () => {
      const configWithOptions: IrisConfig = {
        path: "/path",
        description: "Test",
        idleTimeout: 60000,
        skipPermissions: true,
        color: "#ff0000",
      };

      const transport = new LocalTransport(
        "team-opts",
        configWithOptions,
        "session",
      );
      expect(transport.isReady()).toBe(false);
    });

    it("should handle different session IDs", () => {
      const t1 = new LocalTransport("team", testConfig, "session-1");
      const t2 = new LocalTransport("team", testConfig, "session-2");
      const t3 = new LocalTransport("team", testConfig, null);

      expect(t1.getMetrics().uptime).toBe(0);
      expect(t2.getMetrics().uptime).toBe(0);
      expect(t3.getMetrics().uptime).toBe(0);
    });
  });

  describe("state consistency", () => {
    it("should maintain consistent state", () => {
      expect(transport.isReady()).toBe(false);
      expect(transport.isBusy()).toBe(false);

      const metrics = transport.getMetrics();
      expect(metrics.uptime).toBe(0);
    });

    it("should not be ready and busy at the same time initially", () => {
      const isReady = transport.isReady();
      const isBusy = transport.isBusy();

      if (isReady && isBusy) {
        throw new Error("Transport cannot be ready and busy simultaneously");
      }
      // Initial state: both should be false
      expect(isReady).toBe(false);
      expect(isBusy).toBe(false);
    });
  });
});
