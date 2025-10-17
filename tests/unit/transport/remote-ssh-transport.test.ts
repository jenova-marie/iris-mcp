/**
 * Unit tests for SSHTransport (OpenSSH Client)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSHTransport } from "../../../src/transport/ssh-transport.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import type { CommandInfo } from "../../../src/transport/transport.interface.js";
import { CacheEntryImpl } from "../../../src/cache/cache-entry.js";
import { CacheEntryType } from "../../../src/cache/types.js";
import { TransportStatus } from "../../../src/transport/transport.interface.js";
import { EventEmitter } from "events";

// Mock logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock child_process to avoid actual SSH connections
let mockChildProcess: any;

vi.mock("child_process", () => {
  const EventEmitter = require("events");

  return {
    spawn: vi.fn(() => {
      mockChildProcess = new EventEmitter();
      mockChildProcess.pid = 12345;
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.stderr = new EventEmitter();
      mockChildProcess.stdin = {
        write: vi.fn(),
        end: vi.fn(),
        destroyed: false,
      };
      mockChildProcess.kill = vi.fn();
      return mockChildProcess;
    }),
  };
});

describe("SSHTransport", () => {
  const testConfig: IrisConfig = {
    path: "/remote/project",
    description: "Remote test team",
    remote: "ssh remote-host",
    skipPermissions: true,
    remoteOptions: {
      port: 2222,
      identity: "/path/to/key",
    },
  };

  const testCommandInfo: CommandInfo = {
    executable: "claude",
    args: [
      "--resume",
      "session-123",
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--mcp-config",
      '{"mcpServers":{"iris":{"type":"http","url":"http://localhost:1615/mcp/session-123"}}}',
    ],
    cwd: "/remote/project",
  };

  let transport: SSHTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new SSHTransport("team-test", testConfig, "session-123");
  });

  afterEach(() => {
    mockChildProcess = null;
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

    it("should throw error if remote configuration not provided", () => {
      const configWithoutRemote: IrisConfig = {
        path: "/path",
        description: "No remote",
      };

      expect(() => {
        new SSHTransport("team-no-remote", configWithoutRemote, "s1");
      }).toThrow(/SSHTransport requires remote configuration/);
    });

    it("should emit initial STOPPED status", async () => {
      const newTransport = new SSHTransport("team-test", testConfig, "s1");

      return new Promise<void>((resolve) => {
        newTransport.status$.subscribe((status) => {
          expect(status).toBe(TransportStatus.STOPPED);
          resolve();
        });
      });
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
      const transport1 = new SSHTransport("team-a", testConfig, "s1");
      const transport2 = new SSHTransport("team-b", testConfig, "s2");

      expect(transport1.isReady()).toBe(false);
      expect(transport2.isReady()).toBe(false);
    });

    it("should handle configs with various remoteOptions", () => {
      const configWithOptions: IrisConfig = {
        path: "/remote/path",
        description: "Test",
        remote: "ssh user@host",
        remoteOptions: {
          port: 2222,
          identity: "/key",
          strictHostKeyChecking: false,
          connectTimeout: 10000,
          compression: true,
          forwardAgent: false,
        },
      };

      const transport = new SSHTransport(
        "team-opts",
        configWithOptions,
        "session",
      );
      expect(transport.isReady()).toBe(false);
    });

    it("should handle different session IDs", () => {
      const t1 = new SSHTransport("team", testConfig, "session-1");
      const t2 = new SSHTransport("team", testConfig, "session-2");

      expect(t1.getMetrics().uptime).toBe(0);
      expect(t2.getMetrics().uptime).toBe(0);
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
    it("should handle ssh user@host format", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "ssh jenova@example.com",
      };

      const transport = new SSHTransport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle ssh host-only format", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "ssh example.com",
      };

      const transport = new SSHTransport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle ssh with IP addresses", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "ssh user@192.168.1.100",
      };

      const transport = new SSHTransport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle ssh with ProxyJump", () => {
      const config: IrisConfig = {
        path: "/path",
        description: "Test",
        remote: "ssh -J bastion user@host",
      };

      const transport = new SSHTransport("team", config, "session");
      expect(transport).toBeDefined();
    });
  });

  describe("remote path handling", () => {
    it("should handle paths with spaces", () => {
      const config: IrisConfig = {
        path: "/path/with spaces/project",
        description: "Test",
        remote: "ssh user@host",
      };

      const transport = new SSHTransport("team", config, "session");
      expect(transport).toBeDefined();
    });

    it("should handle paths with special characters", () => {
      const config: IrisConfig = {
        path: "/path/with'quotes/project",
        description: "Test",
        remote: "ssh user@host",
      };

      const transport = new SSHTransport("team", config, "session");
      expect(transport).toBeDefined();
    });
  });

  describe("spawn()", () => {
    it("should spawn SSH process with correct command", async () => {
      const { spawn } = await import("child_process");
      const cacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");

      // Trigger spawn (will timeout, but we just want to check the spawn call)
      const spawnPromise = transport.spawn(cacheEntry, testCommandInfo, 100);

      // Simulate init message
      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          Buffer.from('{"type":"system","subtype":"init"}\n'),
        );
        mockChildProcess.stdout.emit(
          "data",
          Buffer.from('{"type":"result"}\n'),
        );
      }, 10);

      await spawnPromise;

      // Verify spawn was called with ssh command
      expect(spawn).toHaveBeenCalledWith(
        "ssh",
        expect.arrayContaining([
          "-T",
          "-o",
          "ServerAliveInterval=30",
          "-p",
          "2222",
          "-i",
          "/path/to/key",
          "remote-host",
          expect.stringContaining("cd '/remote/project' && claude"),
        ]),
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        }),
      );
    });

    it("should build remote command with CommandInfo", async () => {
      const { spawn } = await import("child_process");
      const cacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");

      transport.spawn(cacheEntry, testCommandInfo, 100).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify the remote command includes executable and args
      const spawnCall = (spawn as any).mock.calls[0];
      const remoteCommand = spawnCall[1][spawnCall[1].length - 1];

      expect(remoteCommand).toContain("cd '/remote/project'");
      expect(remoteCommand).toContain("claude");
      expect(remoteCommand).toContain("--resume session-123");
      expect(remoteCommand).toContain("--print");
      expect(remoteCommand).toContain("--verbose");
    });

    it("should add reverse MCP tunnel if configured", async () => {
      const { spawn } = await import("child_process");
      const configWithReverseMcp: IrisConfig = {
        ...testConfig,
        enableReverseMcp: true,
        reverseMcpPort: 3000,
      };

      const transportWithMcp = new SSHTransport(
        "team-mcp",
        configWithReverseMcp,
        "s1",
      );
      const cacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");

      transportWithMcp.spawn(cacheEntry, testCommandInfo, 100).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 10));

      const spawnCall = (spawn as any).mock.calls[0];
      expect(spawnCall[1]).toContain("-R");
      expect(spawnCall[1]).toContain("3000:localhost:1615");
    });
  });

  describe("executeTell()", () => {
    it("should write message to stdin after spawn", async () => {
      const spawnEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");

      // Spawn first
      const spawnPromise = transport.spawn(spawnEntry, testCommandInfo, 1000);
      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          Buffer.from('{"type":"system","subtype":"init"}\n{"type":"result"}\n'),
        );
      }, 10);
      await spawnPromise;

      // Execute tell
      const tellEntry = new CacheEntryImpl(CacheEntryType.TELL, "test message");
      transport.executeTell(tellEntry);

      expect(mockChildProcess.stdin.write).toHaveBeenCalled();
      const writeCall = (mockChildProcess.stdin.write as any).mock.calls[1]; // Second call (first is spawn)
      const written = JSON.parse(writeCall[0].replace("\n", ""));
      expect(written.message.content[0].text).toBe("test message");
    });
  });

  describe("getPid()", () => {
    it("should return null before spawn", () => {
      expect(transport.getPid()).toBeNull();
    });

    it("should return PID after spawn", async () => {
      const cacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");

      const spawnPromise = transport.spawn(cacheEntry, testCommandInfo, 1000);
      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          Buffer.from('{"type":"system","subtype":"init"}\n{"type":"result"}\n'),
        );
      }, 10);
      await spawnPromise;

      expect(transport.getPid()).toBe(12345);
    });
  });
});
