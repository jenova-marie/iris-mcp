import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tell } from "../../../src/actions/tell.js";
import type { IrisOrchestrator } from "../../../src/iris.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock the validation
vi.mock("../../../src/utils/validation.js", () => ({
  validateTeamName: vi.fn(),
  validateMessage: vi.fn(),
  validateTimeout: vi.fn(),
}));

describe("tell", () => {
  let mockIris: IrisOrchestrator;

  beforeEach(() => {
    // Setup mock Iris orchestrator
    mockIris = {
      sendMessage: vi.fn(),
      clearOutputCache: vi.fn(),
      isAwake: vi.fn().mockReturnValue(true),
      getAsyncQueue: vi.fn().mockReturnValue({
        enqueue: vi.fn().mockReturnValue("task-id-123"),
      }),
    } as unknown as IrisOrchestrator;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("synchronous mode (waitForResponse=true)", () => {
    it("should send message and wait for response", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response from team");

      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Hello team",
          waitForResponse: true,
        },
        mockIris
      );

      expect(result).toMatchObject({
        to: "team-alpha",
        message: "Hello team",
        response: "Response from team",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
        async: false,
      });

      // Cache clearing disabled in bare-bones mode
      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();
      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "Hello team",
        { timeout: 30000, waitForResponse: true }
      );
    });

    it("should use custom timeout", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          toTeam: "team-alpha",
          message: "Hello",
          waitForResponse: true,
          timeout: 60000,
        },
        mockIris
      );

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "Hello",
        { timeout: 60000, waitForResponse: true }
      );
    });

    it("should include fromTeam when provided", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Inter-team message",
          waitForResponse: true,
        },
        mockIris
      );

      expect(result.from).toBe("team-beta");
      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "Inter-team message",
        { timeout: 30000, waitForResponse: true }
      );
    });
  });

  describe("asynchronous mode (waitForResponse=false)", () => {
    it("should send message without waiting", async () => {
      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Async message",
          waitForResponse: false,
        },
        mockIris
      );

      // In async mode, message is enqueued to AsyncQueue, not sent via sendMessage
      expect(mockIris.isAwake).toHaveBeenCalledWith(null, "team-alpha");
      // Cache clearing disabled in bare-bones mode
      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();

      const mockQueue = vi.mocked(mockIris.getAsyncQueue());
      expect(mockQueue.enqueue).toHaveBeenCalledWith({
        type: "tell",
        fromTeam: null,
        toTeam: "team-alpha",
        content: "Async message",
        timeout: 30000,
      });

      expect(result).toMatchObject({
        to: "team-alpha",
        message: "Async message",
        timestamp: expect.any(Number),
        async: true,
        taskId: "task-id-123",
      });
      expect(result.response).toBeUndefined();
      expect(result.duration).toBeUndefined();
    });

    it("should ignore timeout in async mode", async () => {
      await tell(
        {
          toTeam: "team-alpha",
          message: "Async",
          waitForResponse: false,
          timeout: 60000, // Should still be passed through to AsyncQueue
        },
        mockIris
      );

      const mockQueue = vi.mocked(mockIris.getAsyncQueue());
      expect(mockQueue.enqueue).toHaveBeenCalledWith({
        type: "tell",
        fromTeam: null,
        toTeam: "team-alpha",
        content: "Async",
        timeout: 60000,
      });
    });
  });

  describe("cache clearing", () => {
    it("should not clear cache in bare-bones mode (disabled)", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris
      );

      // Cache clearing is disabled in bare-bones mode
      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();
    });

    it("should not clear cache even when clearCache=true (disabled)", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
          clearCache: true,
        },
        mockIris
      );

      // Cache clearing is disabled in bare-bones mode regardless of parameter
      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();
    });

    it("should not clear cache when clearCache=false", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
          clearCache: false,
        },
        mockIris
      );

      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("should validate all inputs", async () => {
      const { validateTeamName, validateMessage, validateTimeout } =
        await import("../../../src/utils/validation.js");

      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Test message",
          waitForResponse: true,
          timeout: 45000,
        },
        mockIris
      );

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-beta");
      expect(vi.mocked(validateMessage)).toHaveBeenCalledWith("Test message");
      expect(vi.mocked(validateTimeout)).toHaveBeenCalledWith(45000);
    });

    it("should not validate timeout when waitForResponse=false", async () => {
      const { validateTimeout } = await import("../../../src/utils/validation.js");

      vi.mocked(mockIris.sendMessage).mockResolvedValue(undefined);

      await tell(
        {
          toTeam: "team-alpha",
          message: "Async message",
          waitForResponse: false,
          timeout: 45000,
        },
        mockIris
      );

      expect(vi.mocked(validateTimeout)).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should propagate sendMessage errors", async () => {
      vi.mocked(mockIris.sendMessage).mockRejectedValue(
        new Error("Send failed")
      );

      await expect(
        tell(
          {
            toTeam: "team-alpha",
            message: "Message",
          },
          mockIris
        )
      ).rejects.toThrow("Send failed");
    });

    it("should not call clearOutputCache in bare-bones mode (no errors to propagate)", async () => {
      vi.mocked(mockIris.clearOutputCache).mockRejectedValue(
        new Error("Cache clear failed")
      );
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      // Should not throw because clearOutputCache is never called
      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris
      );

      expect(result.response).toBe("Response");
      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();
    });

    it("should handle timeout errors", async () => {
      vi.mocked(mockIris.sendMessage).mockRejectedValue(
        new Error("Operation timed out")
      );

      await expect(
        tell(
          {
            toTeam: "team-alpha",
            message: "Message",
            timeout: 1000,
          },
          mockIris
        )
      ).rejects.toThrow("Operation timed out");
    });
  });

  describe("duration tracking", () => {
    it("should track duration for synchronous requests", async () => {
      vi.mocked(mockIris.sendMessage).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve("Response"), 15))
      );

      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
          waitForResponse: true,
        },
        mockIris
      );

      expect(result.duration).toBeGreaterThanOrEqual(10);
    });

    it("should not track duration for async requests", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue(undefined);

      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
          waitForResponse: false,
        },
        mockIris
      );

      expect(result.duration).toBeUndefined();
    });
  });

  describe("default values", () => {
    it("should use default waitForResponse=true", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris
      );

      expect(result.async).toBe(false);
      expect(result.response).toBe("Response");
    });

    it("should use default timeout=30000", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris
      );

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "Message",
        { timeout: 30000, waitForResponse: true }
      );
    });

    it("should not clear cache even with default clearCache=true (disabled in bare-bones)", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris
      );

      // Cache clearing disabled in bare-bones mode
      expect(mockIris.clearOutputCache).not.toHaveBeenCalled();
    });
  });

  describe("persist mode (commented out)", () => {
    it("should not support persist mode currently", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      // persist parameter is ignored since notification queue is disabled
      const result = await tell(
        {
          toTeam: "team-alpha",
          message: "Message",
          persist: true,
          ttlDays: 7,
        },
        mockIris
      );

      // Should fall back to regular synchronous mode
      expect(result.notificationId).toBeUndefined();
      expect(result.expiresAt).toBeUndefined();
      expect(mockIris.sendMessage).toHaveBeenCalled();
    });
  });
});