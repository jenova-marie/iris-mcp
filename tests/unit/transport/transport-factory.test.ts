/**
 * Unit tests for TransportFactory
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransportFactory } from "../../../src/transport/transport-factory.js";
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

    it("should throw error for remote config (Phase 1)", () => {
      expect(() => {
        TransportFactory.create("team-remote", remoteConfig, "session-456");
      }).toThrow(/Remote execution not yet implemented/);
    });

    it("should include team name in remote error message", () => {
      expect(() => {
        TransportFactory.create("team-remote", remoteConfig, "session-456");
      }).toThrow(/team-remote/);
    });

    it("should include remote host in error message", () => {
      expect(() => {
        TransportFactory.create("team-remote", remoteConfig, "session-456");
      }).toThrow(/user@remote-host/);
    });

    it("should reference implementation plan in error message", () => {
      expect(() => {
        TransportFactory.create("team-remote", remoteConfig, "session-456");
      }).toThrow(/REMOTE_IMPLEMENTATION_PLAN\.md/);
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
