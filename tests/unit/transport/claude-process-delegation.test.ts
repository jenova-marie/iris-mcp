/**
 * Unit tests for ClaudeProcess delegation to Transport
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import type { TransportMetrics } from "../../../src/transport/transport.interface.js";

// Mock logger first
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Create mock transport factory
const mockTransportMethods = {
  spawn: vi.fn().mockResolvedValue(undefined),
  executeTell: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
  isReady: vi.fn().mockReturnValue(false),
  isBusy: vi.fn().mockReturnValue(false),
  getMetrics: vi.fn().mockReturnValue({
    uptime: 0,
    messagesProcessed: 0,
    lastResponseAt: null,
  } as TransportMetrics),
  getPid: vi.fn().mockReturnValue(null),
  cancel: vi.fn(),
  // EventEmitter methods
  on: vi.fn(),
  emit: vi.fn(),
  removeListener: vi.fn(),
};

vi.mock("../../../src/transport/transport-factory.js", () => ({
  TransportFactory: {
    create: vi.fn(() => mockTransportMethods),
  },
}));

// Import ClaudeProcess AFTER mocks
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import { TransportFactory } from "../../../src/transport/transport-factory.js";

describe("ClaudeProcess Transport Delegation", () => {
  const testConfig: IrisConfig = {
    path: process.cwd(),
    description: "Test team",
    skipPermissions: true,
  };

  let claudeProcess: ClaudeProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    claudeProcess = new ClaudeProcess("team-test", testConfig, "session-123");
  });

  describe("constructor", () => {
    it("should create transport via TransportFactory", () => {
      expect(TransportFactory.create).toHaveBeenCalledWith(
        "team-test",
        testConfig,
        "session-123",
      );
    });
  });

  describe("getBasicMetrics()", () => {
    it("should delegate to transport.getMetrics()", () => {
      claudeProcess.getBasicMetrics();
      expect(mockTransportMethods.getMetrics).toHaveBeenCalled();
    });

    it("should delegate to transport.isReady()", () => {
      claudeProcess.getBasicMetrics();
      expect(mockTransportMethods.isReady).toHaveBeenCalled();
    });

    it("should delegate to transport.isBusy()", () => {
      claudeProcess.getBasicMetrics();
      expect(mockTransportMethods.isBusy).toHaveBeenCalled();
    });

    it("should delegate to transport.getPid()", () => {
      claudeProcess.getBasicMetrics();
      expect(mockTransportMethods.getPid).toHaveBeenCalled();
    });

    it("should derive status from transport state", () => {
      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBeDefined();
      expect(["stopped", "spawning", "idle", "processing"]).toContain(
        metrics.status,
      );
    });
  });

  describe("terminate()", () => {
    it("should delegate to transport.terminate()", async () => {
      await claudeProcess.terminate();
      expect(mockTransportMethods.terminate).toHaveBeenCalled();
    });
  });

  describe("cancel()", () => {
    it("should delegate to transport.cancel() if supported", () => {
      claudeProcess.cancel();
      expect(mockTransportMethods.cancel).toHaveBeenCalled();
    });

    it("should handle transport without cancel method", () => {
      const transportWithoutCancel = { ...mockTransportMethods };
      delete transportWithoutCancel.cancel;

      vi.mocked(TransportFactory.create).mockReturnValueOnce(
        transportWithoutCancel,
      );

      const process = new ClaudeProcess(
        "team-no-cancel",
        testConfig,
        "session-456",
      );
      expect(() => process.cancel()).not.toThrow();
    });
  });

  describe("status derivation", () => {
    it("should return stopped when uptime is 0", () => {
      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue({
        uptime: 0,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(null);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe("stopped");
    });

    it("should return spawning when not ready and uptime > 0 with PID", () => {
      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
      vi.mocked(mockTransportMethods.isReady).mockReturnValue(false);
      vi.mocked(mockTransportMethods.isBusy).mockReturnValue(false);
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(12345);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe("spawning");
    });

    it("should return stopped when PID is null and process had messages", () => {
      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 5,
        lastResponseAt: Date.now(),
      });
      vi.mocked(mockTransportMethods.isReady).mockReturnValue(false);
      vi.mocked(mockTransportMethods.isBusy).mockReturnValue(false);
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(null);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe("stopped");
    });

    it("should return processing when busy", () => {
      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 5,
        lastResponseAt: Date.now(),
      });
      vi.mocked(mockTransportMethods.isReady).mockReturnValue(true);
      vi.mocked(mockTransportMethods.isBusy).mockReturnValue(true);
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(12345);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe("processing");
    });

    it("should return idle when ready and not busy", () => {
      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue({
        uptime: 5000,
        messagesProcessed: 10,
        lastResponseAt: Date.now() - 1000,
      });
      vi.mocked(mockTransportMethods.isReady).mockReturnValue(true);
      vi.mocked(mockTransportMethods.isBusy).mockReturnValue(false);
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(12345);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe("idle");
    });
  });

  describe("metrics integration", () => {
    it("should correctly map transport metrics to process metrics", () => {
      const transportMetrics: TransportMetrics = {
        uptime: 12345,
        messagesProcessed: 42,
        lastResponseAt: Date.now() - 5000,
      };

      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue(transportMetrics);
      vi.mocked(mockTransportMethods.isReady).mockReturnValue(true);
      vi.mocked(mockTransportMethods.isBusy).mockReturnValue(false);
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(12345);

      const processMetrics = claudeProcess.getBasicMetrics();

      expect(processMetrics.uptime).toBe(transportMetrics.uptime);
      expect(processMetrics.messagesProcessed).toBe(
        transportMetrics.messagesProcessed,
      );
      expect(processMetrics.isReady).toBe(true);
      expect(processMetrics.isBusy).toBe(false);
      expect(processMetrics.pid).toBe(12345);
    });

    it("should handle null lastResponseAt", () => {
      vi.mocked(mockTransportMethods.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
      vi.mocked(mockTransportMethods.getPid).mockReturnValue(12345);

      const metrics = claudeProcess.getBasicMetrics();
      // When lastResponseAt is null, should fall back to spawnTime (which is 0 for unspawned process)
      expect(metrics.lastActivity).toBe(0);
    });
  });
});
