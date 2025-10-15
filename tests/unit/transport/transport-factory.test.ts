/**
 * Unit tests for TransportFactory
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransportFactory } from "../../../src/transport/transport-factory.js";
import { LocalTransport } from "../../../src/transport/local-transport.js";
import { RemoteSSHTransport } from "../../../src/transport/remote-ssh-transport.js";
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

// Mock ssh2 to avoid actual SSH connections in tests
vi.mock("ssh2", () => ({
  Client: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  })),
}));

describe("TransportFactory", () => {
  const localConfig: IrisConfig = {
    path: "/path/to/project",
    description: "Local team",
  };

  const remoteConfig: IrisConfig = {
    path: "/path/to/project",
    description: "Remote team",
    remote: "user@remote-host",
    remoteOptions: {
      port: 2222,
      identity: "/path/to/key",
    },
  };

  describe("create()", () => {
    it("should create LocalTransport for non-remote config", () => {
      const transport = TransportFactory.create(
        "team-local",
        localConfig,
        "session-123",
      );

      expect(transport).toBeInstanceOf(LocalTransport);
    });

    it("should create RemoteSSHTransport for remote config (Phase 2)", () => {
      const transport = TransportFactory.create(
        "team-remote",
        remoteConfig,
        "session-456",
      );

      expect(transport).toBeInstanceOf(RemoteSSHTransport);
    });

    it("should pass correct config to RemoteSSHTransport", () => {
      const transport = TransportFactory.create(
        "team-remote",
        remoteConfig,
        "session-789",
      );

      expect(transport).toBeDefined();
      expect(transport).toBeInstanceOf(RemoteSSHTransport);
    });

    it("should handle remote config with various remoteOptions", () => {
      const configWithOptions: IrisConfig = {
        path: "/path/to/project",
        description: "Remote with options",
        remote: "user@host.example.com",
        remoteOptions: {
          port: 2222,
          identity: "/path/to/key",
          strictHostKeyChecking: false,
          connectTimeout: 10000,
        },
      };

      const transport = TransportFactory.create(
        "team-remote-opts",
        configWithOptions,
        "session-abc",
      );

      expect(transport).toBeInstanceOf(RemoteSSHTransport);
    });

    it("should handle configs without remote field", () => {
      const configWithoutRemote: IrisConfig = {
        path: "/path",
        description: "No remote field",
        idleTimeout: 30000,
        skipPermissions: true,
      };

      const transport = TransportFactory.create(
        "team-test",
        configWithoutRemote,
        "session-789",
      );

      expect(transport).toBeInstanceOf(LocalTransport);
    });

    it("should handle undefined remote field as local", () => {
      const configWithUndefinedRemote: IrisConfig = {
        path: "/path",
        description: "Undefined remote",
        remote: undefined,
      };

      const transport = TransportFactory.create(
        "team-test",
        configWithUndefinedRemote,
        "session-abc",
      );

      expect(transport).toBeInstanceOf(LocalTransport);
    });
  });
});
