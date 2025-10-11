import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisOrchestrator } from "../../src/iris.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { ClaudeProcessPool } from "../../src/process-pool/pool-manager.js";
import { AsyncQueue } from "../../src/async/queue.js";

// Mock dependencies
vi.mock("../../src/session/session-manager.js");
vi.mock("../../src/process-pool/pool-manager.js");
vi.mock("../../src/async/queue.js");
vi.mock("../../src/utils/logger.js", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe("IrisOrchestrator", () => {
  let iris: IrisOrchestrator;
  let mockSessionManager: any;
  let mockProcessPool: any;
  let mockProcess: any;
  let mockAsyncQueue: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock process
    mockProcess = {
      sendMessage: vi.fn().mockResolvedValue("Mock response"),
      getMetrics: vi.fn().mockReturnValue({
        status: "idle",
        messagesSent: 5,
        messagesReceived: 5,
        uptime: 10000,
      }),
      spawn: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock session manager
    mockSessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({
        sessionId: "session-123",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        createdAt: Date.now(),
        lastUsed: Date.now(),
      }),
      getSession: vi.fn().mockReturnValue({
        sessionId: "session-123",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        createdAt: Date.now(),
        lastUsed: Date.now(),
      }),
      getSessionById: vi.fn().mockReturnValue({
        sessionId: "session-123",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        createdAt: Date.now(),
        lastUsed: Date.now(),
      }),
      listSessions: vi.fn().mockReturnValue([]),
      recordUsage: vi.fn(),
      incrementMessageCount: vi.fn(),
      getStats: vi.fn().mockReturnValue({
        total: 5,
        active: 3,
      }),
      close: vi.fn(),
    };

    // Create mock process pool
    mockProcessPool = {
      getOrCreateProcess: vi.fn().mockResolvedValue(mockProcess),
      getProcessBySessionId: vi.fn().mockReturnValue(mockProcess),
      sendCommandToSession: vi.fn().mockResolvedValue("Command sent"),
      clearOutputCache: vi.fn(),
      getOutputCache: vi.fn().mockReturnValue({
        stdout: "stdout output",
        stderr: "stderr output",
      }),
      getStatus: vi.fn().mockReturnValue({
        totalProcesses: 3,
        maxProcesses: 10,
        activeSessions: 3,
      }),
      terminateAll: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock async queue
    mockAsyncQueue = {
      shutdown: vi.fn(),
    };

    // Mock constructors
    vi.mocked(SessionManager).mockImplementation(() => mockSessionManager);
    vi.mocked(ClaudeProcessPool).mockImplementation(() => mockProcessPool);
    vi.mocked(AsyncQueue).mockImplementation(() => mockAsyncQueue);

    // Create orchestrator
    iris = new IrisOrchestrator(mockSessionManager, mockProcessPool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with SessionManager and ProcessPool", () => {
      expect(iris).toBeDefined();
      expect(AsyncQueue).toHaveBeenCalledWith(iris);
    });
  });

  describe("sendMessage", () => {
    it("should send message and return response", async () => {
      const response = await iris.sendMessage(
        "team-alpha",
        "team-beta",
        "Test message"
      );

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        "team-alpha",
        "team-beta"
      );
      expect(mockProcessPool.getOrCreateProcess).toHaveBeenCalledWith(
        "team-beta",
        "session-123",
        "team-alpha"
      );
      expect(mockProcess.sendMessage).toHaveBeenCalledWith("Test message", 30000);
      expect(mockSessionManager.recordUsage).toHaveBeenCalledWith("session-123");
      expect(mockSessionManager.incrementMessageCount).toHaveBeenCalledWith(
        "session-123"
      );
      expect(response).toBe("Mock response");
    });

    it("should handle null fromTeam (external)", async () => {
      const response = await iris.sendMessage(null, "team-beta", "Test message");

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        null,
        "team-beta"
      );
      expect(response).toBe("Mock response");
    });

    it("should use custom timeout", async () => {
      await iris.sendMessage("team-alpha", "team-beta", "Test message", {
        timeout: 60000,
      });

      expect(mockProcess.sendMessage).toHaveBeenCalledWith("Test message", 60000);
    });

    it("should return early if process is spawning", async () => {
      mockProcess.getMetrics.mockReturnValue({
        status: "spawning",
        messagesSent: 0,
        messagesReceived: 0,
        uptime: 0,
      });

      const response = await iris.sendMessage(
        "team-alpha",
        "team-beta",
        "Test message"
      );

      expect(response).toBe(
        "Session starting... Please retry your request in a moment."
      );
      expect(mockProcess.sendMessage).not.toHaveBeenCalled();
    });

    it("should handle fire-and-forget mode (waitForResponse=false)", async () => {
      const response = await iris.sendMessage(
        "team-alpha",
        "team-beta",
        "Test message",
        { waitForResponse: false }
      );

      expect(response).toBe("Message sent (fire-and-forget mode)");
      expect(mockSessionManager.recordUsage).toHaveBeenCalledWith("session-123");
      expect(mockSessionManager.incrementMessageCount).toHaveBeenCalledWith(
        "session-123"
      );
    });

    it("should handle sendMessage errors", async () => {
      const error = new Error("Send failed");
      mockProcess.sendMessage.mockRejectedValue(error);

      await expect(
        iris.sendMessage("team-alpha", "team-beta", "Test message")
      ).rejects.toThrow("Send failed");
    });
  });

  describe("ask", () => {
    it("should be a convenience wrapper for sendMessage", async () => {
      const response = await iris.ask(
        "team-alpha",
        "team-beta",
        "Test question",
        60000
      );

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        "team-alpha",
        "team-beta"
      );
      expect(mockProcess.sendMessage).toHaveBeenCalledWith(
        "Test question",
        60000
      );
      expect(response).toBe("Mock response");
    });

    it("should default to waitForResponse=true", async () => {
      await iris.ask("team-alpha", "team-beta", "Test question");

      expect(mockProcess.sendMessage).toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("should return combined status from sessions and processes", () => {
      const status = iris.getStatus();

      expect(status).toEqual({
        sessions: {
          total: 5,
          active: 3,
        },
        processes: {
          total: 3,
          maxProcesses: 10,
        },
      });
      expect(mockSessionManager.getStats).toHaveBeenCalled();
      expect(mockProcessPool.getStatus).toHaveBeenCalled();
    });
  });

  describe("getProcessPoolStatus", () => {
    it("should return process pool status", () => {
      const status = iris.getProcessPoolStatus();

      expect(status).toEqual({
        totalProcesses: 3,
        maxProcesses: 10,
        activeSessions: 3,
      });
      expect(mockProcessPool.getStatus).toHaveBeenCalled();
    });
  });

  describe("getSession", () => {
    it("should get session by ID", () => {
      const session = iris.getSession("session-123");

      expect(mockSessionManager.getSessionById).toHaveBeenCalledWith(
        "session-123"
      );
      expect(session?.sessionId).toBe("session-123");
    });
  });

  describe("listSessions", () => {
    it("should list sessions with filters", () => {
      const filters = { fromTeam: "team-alpha" };
      const sessions = iris.listSessions(filters);

      expect(mockSessionManager.listSessions).toHaveBeenCalledWith(filters);
      expect(sessions).toEqual([]);
    });

    it("should list sessions without filters", () => {
      iris.listSessions();

      expect(mockSessionManager.listSessions).toHaveBeenCalledWith(undefined);
    });
  });

  describe("sendCommandToSession", () => {
    it("should send command to session", async () => {
      const result = await iris.sendCommandToSession("session-123", "/compact");

      expect(mockProcessPool.sendCommandToSession).toHaveBeenCalledWith(
        "session-123",
        "/compact"
      );
      expect(result).toBe("Command sent");
    });
  });

  describe("clearOutputCache", () => {
    it("should clear output cache for team", async () => {
      await iris.clearOutputCache("team-alpha");

      expect(mockProcessPool.clearOutputCache).toHaveBeenCalledWith("team-alpha");
    });
  });

  describe("getOutputCache", () => {
    it("should get output cache for team", () => {
      const cache = iris.getOutputCache("team-alpha");

      expect(mockProcessPool.getOutputCache).toHaveBeenCalledWith("team-alpha");
      expect(cache).toEqual({
        stdout: "stdout output",
        stderr: "stderr output",
      });
    });
  });

  describe("getAsyncQueue", () => {
    it("should return async queue instance", () => {
      const queue = iris.getAsyncQueue();

      expect(queue).toBe(mockAsyncQueue);
    });
  });

  describe("isAwake", () => {
    it("should return true if team has ready process", () => {
      const result = iris.isAwake("team-alpha", "team-beta");

      expect(mockSessionManager.getSession).toHaveBeenCalledWith(
        "team-alpha",
        "team-beta"
      );
      expect(mockProcessPool.getProcessBySessionId).toHaveBeenCalledWith(
        "session-123"
      );
      expect(result).toBe(true);
    });

    it("should return false if no session exists", () => {
      mockSessionManager.getSession.mockReturnValue(null);

      const result = iris.isAwake("team-alpha", "team-beta");

      expect(result).toBe(false);
    });

    it("should return false if no process exists", () => {
      mockProcessPool.getProcessBySessionId.mockReturnValue(null);

      const result = iris.isAwake("team-alpha", "team-beta");

      expect(result).toBe(false);
    });

    it("should return false if process is spawning", () => {
      mockProcess.getMetrics.mockReturnValue({
        status: "spawning",
        messagesSent: 0,
        messagesReceived: 0,
        uptime: 0,
      });

      const result = iris.isAwake("team-alpha", "team-beta");

      expect(result).toBe(false);
    });

    it("should return false if process is stopped", () => {
      mockProcess.getMetrics.mockReturnValue({
        status: "stopped",
        messagesSent: 5,
        messagesReceived: 5,
        uptime: 10000,
      });

      const result = iris.isAwake("team-alpha", "team-beta");

      expect(result).toBe(false);
    });

    it("should handle null fromTeam", () => {
      const result = iris.isAwake(null, "team-beta");

      expect(mockSessionManager.getSession).toHaveBeenCalledWith(null, "team-beta");
      expect(result).toBe(true);
    });
  });

  describe("shutdown", () => {
    it("should shutdown all components", async () => {
      await iris.shutdown();

      expect(mockAsyncQueue.shutdown).toHaveBeenCalled();
      expect(mockProcessPool.terminateAll).toHaveBeenCalled();
      expect(mockSessionManager.close).toHaveBeenCalled();
    });
  });
});
