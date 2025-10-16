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

// Create mock transport factory with RxJS observables
const { BehaviorSubject, Subject } = await import("rxjs");
const { TransportStatus } = await import("../../../src/transport/transport.interface.js");

const createMockTransport = () => {
  const statusSubject = new BehaviorSubject(TransportStatus.STOPPED);
  const errorsSubject = new Subject();

  return {
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
    // RxJS observables (required)
    status$: statusSubject.asObservable(),
    errors$: errorsSubject.asObservable(),
    // Expose subject for tests to emit status changes
    _statusSubject: statusSubject,
  };
};

const mockTransportMethods = createMockTransport();

vi.mock("../../../src/transport/transport-factory.js", () => ({
  TransportFactory: {
    create: vi.fn(() => createMockTransport()),
  },
}));

// Import ClaudeProcess AFTER mocks
import { ClaudeProcess, ProcessStatus } from "../../../src/process-pool/claude-process.js";
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
    // Create fresh mock transport for each test
    vi.mocked(TransportFactory.create).mockReturnValue(createMockTransport());
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
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      claudeProcess.getBasicMetrics();
      expect(transport?.getMetrics).toHaveBeenCalled();
    });

    it("should delegate to transport.isReady()", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      claudeProcess.getBasicMetrics();
      expect(transport?.isReady).toHaveBeenCalled();
    });

    it("should delegate to transport.isBusy()", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      claudeProcess.getBasicMetrics();
      expect(transport?.isBusy).toHaveBeenCalled();
    });

    it("should delegate to transport.getPid()", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      claudeProcess.getBasicMetrics();
      expect(transport?.getPid).toHaveBeenCalled();
    });

    it("should derive status from transport state", () => {
      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBeDefined();
      expect([ProcessStatus.STOPPED, ProcessStatus.SPAWNING, ProcessStatus.IDLE, ProcessStatus.PROCESSING]).toContain(
        metrics.status,
      );
    });
  });

  describe("terminate()", () => {
    it("should delegate to transport.terminate()", async () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      await claudeProcess.terminate();
      expect(transport?.terminate).toHaveBeenCalled();
    });
  });

  describe("cancel()", () => {
    it("should delegate to transport.cancel() if supported", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      claudeProcess.cancel();
      expect(transport?.cancel).toHaveBeenCalled();
    });

    it("should handle transport without cancel method", () => {
      const transportWithoutCancel = createMockTransport();
      delete (transportWithoutCancel as any).cancel;

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
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      vi.mocked(transport!.getMetrics).mockReturnValue({
        uptime: 0,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
      vi.mocked(transport!.getPid).mockReturnValue(null);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe(ProcessStatus.STOPPED);
    });

    it("should return spawning when not ready and uptime > 0 with PID", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value as any;
      vi.mocked(transport!.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
      vi.mocked(transport!.isReady).mockReturnValue(false);
      vi.mocked(transport!.isBusy).mockReturnValue(false);
      vi.mocked(transport!.getPid).mockReturnValue(12345);

      // Emit SPAWNING status through the observable
      transport._statusSubject.next(TransportStatus.SPAWNING);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe(ProcessStatus.SPAWNING);
    });

    it("should return stopped when PID is null and process had messages", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      vi.mocked(transport!.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 5,
        lastResponseAt: Date.now(),
      });
      vi.mocked(transport!.isReady).mockReturnValue(false);
      vi.mocked(transport!.isBusy).mockReturnValue(false);
      vi.mocked(transport!.getPid).mockReturnValue(null);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe(ProcessStatus.STOPPED);
    });

    it("should return processing when busy", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value as any;
      vi.mocked(transport!.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 5,
        lastResponseAt: Date.now(),
      });
      vi.mocked(transport!.isReady).mockReturnValue(true);
      vi.mocked(transport!.isBusy).mockReturnValue(true);
      vi.mocked(transport!.getPid).mockReturnValue(12345);

      // Emit BUSY status through the observable
      transport._statusSubject.next(TransportStatus.BUSY);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe(ProcessStatus.PROCESSING);
    });

    it("should return idle when ready and not busy", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value as any;
      vi.mocked(transport!.getMetrics).mockReturnValue({
        uptime: 5000,
        messagesProcessed: 10,
        lastResponseAt: Date.now() - 1000,
      });
      vi.mocked(transport!.isReady).mockReturnValue(true);
      vi.mocked(transport!.isBusy).mockReturnValue(false);
      vi.mocked(transport!.getPid).mockReturnValue(12345);

      // Emit READY status through the observable
      transport._statusSubject.next(TransportStatus.READY);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.status).toBe(ProcessStatus.IDLE);
    });
  });

  describe("metrics integration", () => {
    it("should correctly map transport metrics to process metrics", () => {
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      const transportMetrics: TransportMetrics = {
        uptime: 12345,
        messagesProcessed: 42,
        lastResponseAt: Date.now() - 5000,
      };

      vi.mocked(transport!.getMetrics).mockReturnValue(transportMetrics);
      vi.mocked(transport!.isReady).mockReturnValue(true);
      vi.mocked(transport!.isBusy).mockReturnValue(false);
      vi.mocked(transport!.getPid).mockReturnValue(12345);

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
      const transport = vi.mocked(TransportFactory.create).mock.results[0]?.value;
      vi.mocked(transport!.getMetrics).mockReturnValue({
        uptime: 1000,
        messagesProcessed: 0,
        lastResponseAt: null,
      });
      vi.mocked(transport!.getPid).mockReturnValue(12345);

      const metrics = claudeProcess.getBasicMetrics();
      // When lastResponseAt is null, should fall back to spawnTime (which is 0 for unspawned process)
      expect(metrics.lastActivity).toBe(0);
    });
  });
});
