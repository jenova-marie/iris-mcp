import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tell } from "../../../src/actions/tell.js";
import type { IrisOrchestrator } from "../../../src/iris.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
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
    } as unknown as IrisOrchestrator;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("synchronous mode", () => {
    it("should send message and wait for response", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response from team");

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Hello team",
        },
        mockIris,
      );

      expect(result).toMatchObject({
        from: "team-beta",
        to: "team-alpha",
        message: "Hello team",
        response: "Response from team",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "Hello team",
        { timeout: 30000 },
      );
    });

    it("should use custom timeout", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Hello",
          timeout: 60000,
        },
        mockIris,
      );

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "Hello",
        { timeout: 60000 },
      );
    });
  });

  describe("asynchronous mode", () => {
    it("should send message without waiting (timeout=-1)", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue({
        status: "async",
        sessionId: "session-123",
      });

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Async message",
        },
        mockIris,
      );

      // Should use timeout=-1 for async mode
      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "Async message",
        { timeout: -1 },
      );

      expect(result).toMatchObject({
        from: "team-beta",
        to: "team-alpha",
        message: "Async message",
        timestamp: expect.any(Number),
      });
      expect(result.response).toBeUndefined();
      expect(result.duration).toBeUndefined();
    });

    it("should ignore custom timeout in async mode", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue({
        status: "async",
        sessionId: "session-123",
      });

      await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Async",
          timeout: 60000, // Should be ignored, use -1 instead
        },
        mockIris,
      );

      // Should still use -1 for async mode
      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "Async",
        { timeout: -1 },
      );
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
          timeout: 45000,
        },
        mockIris,
      );

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-beta");
      expect(vi.mocked(validateMessage)).toHaveBeenCalledWith("Test message");
      expect(vi.mocked(validateTimeout)).toHaveBeenCalledWith(45000);
    });

    it("should not validate timeout ???", async () => {
      const { validateTimeout } = await import(
        "../../../src/utils/validation.js"
      );

      vi.mocked(mockIris.sendMessage).mockResolvedValue({
        status: "async",
        sessionId: "session-123",
      });

      await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Async message",
          timeout: 45000,
        },
        mockIris,
      );

      expect(vi.mocked(validateTimeout)).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should propagate sendMessage errors", async () => {
      vi.mocked(mockIris.sendMessage).mockRejectedValue(
        new Error("Send failed"),
      );

      await expect(
        tell(
          {
            fromTeam: "team-beta",
            toTeam: "team-alpha",
            message: "Message",
          },
          mockIris,
        ),
      ).rejects.toThrow("Send failed");
    });

    it("should handle timeout errors", async () => {
      vi.mocked(mockIris.sendMessage).mockRejectedValue(
        new Error("Operation timed out"),
      );

      await expect(
        tell(
          {
            fromTeam: "team-beta",
            toTeam: "team-alpha",
            message: "Message",
            timeout: 1000,
          },
          mockIris,
        ),
      ).rejects.toThrow("Operation timed out");
    });
  });

  describe("duration tracking", () => {
    it("should track duration for synchronous requests", async () => {
      vi.mocked(mockIris.sendMessage).mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("Response"), 15)),
      );

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris,
      );

      expect(result.duration).toBeGreaterThanOrEqual(10);
    });

    it("should not track duration for async requests", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue({
        status: "async",
        sessionId: "session-123",
      });

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris,
      );

      expect(result.duration).toBeUndefined();
    });
  });

  describe("default values", () => {
    it("should use default", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris,
      );

      expect(result.response).toBe("Response");
    });

    it("should use default timeout=30000", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("Response");

      await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris,
      );

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "Message",
        { timeout: 30000 },
      );
    });
  });

  describe("response handling", () => {
    it("should handle empty string responses", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue("");

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris,
      );

      expect(result.response).toBe("");
    });

    it("should handle object responses with status field", async () => {
      vi.mocked(mockIris.sendMessage).mockResolvedValue({
        status: "busy",
        message: "Team is processing another request",
      });

      const result = await tell(
        {
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          message: "Message",
        },
        mockIris,
      );

      expect(result.response).toBe("Team is processing another request");
    });
  });
});
