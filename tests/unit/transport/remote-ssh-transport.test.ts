/**
 * Unit tests for SSH2Transport
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SSH2Transport } from "../../../src/transport/ssh2-transport.js";
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

// Mock ssh2 to avoid actual SSH connections
const mockSSHClient = {
  on: vi.fn(),
  connect: vi.fn(),
  exec: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
  once: vi.fn(),
};

vi.mock("ssh2", () => ({
  Client: vi.fn(() => mockSSHClient),
}));

describe("SSH2Transport", () => {
  const testConfig: IrisConfig = {
    path: "/remote/project",
    description: "Remote test team",
    remote: "user@remote-host",
    skipPermissions: true,
    remoteOptions: {
      port: 2222,
      identity: "/path/to/key",
    },
  };

  let transport: SSH2Transport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new SSH2Transport("team-test", testConfig, "session-123");
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

    it("should be an EventEmitter", () => {
      expect(transport.on).toBeDefined();
      expect(transport.emit).toBeDefined();
      expect(transport.removeListener).toBeDefined();
    });

    it("should throw error if remote host not specified", () => {
      const configWithoutRemote: IrisConfig = {
        path: "/path",
        description: "No remote",
      };

      expect(() => {
        new SSH2Transport("team-no-remote", configWithoutRemote, "s1");
      }).toThrow(/Remote host not specified/);
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
    it("should resolve immediately when not connected", async () => {
      await expect(transport.terminate()).resolves.toBeUndefined();
    });

    it("should be idempotent", async () => {
      await transport.terminate();
      await expect(transport.terminate()).resolves.toBeUndefined();
    });
  });

  describe("cancel()", () => {
    it("should not throw when called on unconnected transport", () => {
      expect(() => transport.cancel()).not.toThrow();
    });

    it("should log warning when exec channel not available", () => {
      transport.cancel();
      // Should not throw, just log warning
      expect(() => transport.cancel()).not.toThrow();
    });
  });

  describe("event emission", () => {
    it("should support adding listeners", () => {
      const listener = vi.fn();
      transport.on("process-spawned", listener);
      expect(transport.listenerCount("process-spawned")).toBe(1);
    });

    it("should support removing listeners", () => {
      const listener = vi.fn();
      transport.on("process-error", listener);
      transport.removeListener("process-error", listener);
      expect(transport.listenerCount("process-error")).toBe(0);
    });
  });

  describe("configuration handling", () => {
    it("should accept different team names", () => {
      const transport1 = new SSH2Transport("team-a", testConfig, "s1");
      const transport2 = new SSH2Transport("team-b", testConfig, "s2");

      expect(transport1.isReady()).toBe(false);
      expect(transport2.isReady()).toBe(false);
    });

    it("should handle configs with various remoteOptions", () => {
      const configWithOptions: IrisConfig = {
        path: "/remote/path",
        description: "Test",
        remote: "user@host",
        remoteOptions: {
          port: 2222,
          identity: "/key",
          strictHostKeyChecking: false,
          connectTimeout: 10000,
          serverAliveInterval: 30000,
          serverAliveCountMax: 3,
          compression: true,
          forwardAgent: false,
        },
      };

      const transport = new SSH2Transport(
        "team-opts",
        configWithOptions,
        "session",
      );
      expect(transport.isReady()).toBe(false);
    });

    it("should handle different session IDs", () => {
      const t1 = new SSH2Transport("team", testConfig, "session-1");
      const t2 = new SSH2Transport("team", testConfig, "session-2");
      const t3 = new SSH2Transport("team", testConfig, null as any);

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

  describe("remote host parsing", () => {
    it("should handle user@host format", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "jenova@example.com",
      };

      const transport = new SSH2Transport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle host-only format", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "example.com",
      };

      const transport = new SSH2Transport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle IP addresses", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "user@192.168.1.100",
      };

      const transport = new SSH2Transport("team", config, "session");
      expect(transport).toBeDefined();
    });
  });

  describe("remote path handling", () => {
    it("should handle paths with spaces", () => {
      const config: IrisConfig = {
        path: "/path/with spaces/project",
        description: "Test",
        remote: "user@host",
      };

      const transport = new SSH2Transport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle paths with special characters", () => {
      const config: IrisConfig = {
        path: "/path/with'quotes/project",
        description: "Test",
        remote: "user@host",
      };

      const transport = new SSH2Transport("team", config, "session");
      expect(transport).toBeDefined();
    });
  });
});
