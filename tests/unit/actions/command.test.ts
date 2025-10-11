/**
 * Unit tests for the command action
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { command, type CommandInput } from "../../../src/actions/command.js";
import type { IrisOrchestrator } from "../../../src/iris.js";

describe("command action", () => {
  let mockIris: IrisOrchestrator;

  beforeEach(() => {
    // Create mock IrisOrchestrator
    mockIris = {
      sendMessage: vi.fn(),
      clearOutputCache: vi.fn(),
      isAwake: vi.fn().mockReturnValue(true),
      getAsyncQueue: vi.fn().mockReturnValue({
        enqueue: vi.fn().mockReturnValue("task-id-123"),
      }),
    } as unknown as IrisOrchestrator;

    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("should validate team name", async () => {
      const input: CommandInput = {
        team: "",
        command: "help",
      };

      await expect(command(input, mockIris)).rejects.toThrow(
        "Team name is required and must be a string"
      );
    });

    it("should validate command is non-empty", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "",
      };

      await expect(command(input, mockIris)).rejects.toThrow(
        "Command must be a non-empty string"
      );
    });

  });

  describe("command validation", () => {
    it("should accept compact command", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Success");

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/compact",
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it("should reject unsupported commands with not implemented message", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "help",
      };

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.response).toContain("not implemented");
      expect(result.response).toContain("Only /compact is currently supported");
    });

    it("should not duplicate slash prefix for compact", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "/compact",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Success");

      await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/compact",
        expect.any(Object)
      );
    });
  });

  describe("synchronous mode (waitForResponse=true)", () => {
    it("should send command and wait for response", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
        waitForResponse: true,
        timeout: 5000,
      };

      const mockResponse = "Compaction completed";
      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce(mockResponse);

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/compact",
        {
          timeout: 5000,
          waitForResponse: true,
        }
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/compact",
        response: mockResponse,
        success: true,
        async: false,
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should include fromTeam if provided", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
        fromTeam: "team-beta",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Compacted");

      await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "/compact",
        expect.any(Object)
      );
    });
  });

  describe("asynchronous mode (waitForResponse=false)", () => {
    it("should send compact command without waiting", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
        waitForResponse: false,
      };

      const result = await command(input, mockIris);

      // In async mode, command is enqueued to AsyncQueue, not sent via sendMessage
      expect(mockIris.isAwake).toHaveBeenCalledWith(null, "team-alpha");

      const mockQueue = vi.mocked(mockIris.getAsyncQueue());
      expect(mockQueue.enqueue).toHaveBeenCalledWith({
        type: "command",
        fromTeam: null,
        toTeam: "team-alpha",
        content: "compact",
        args: undefined,
        timeout: 30000,
      });

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/compact",
        success: true,
        async: true,
        taskId: "task-id-123",
      });

      expect(result.response).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should return not implemented for unsupported async commands", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "clear",
        waitForResponse: false,
      };

      const result = await command(input, mockIris);

      // Should not enqueue unsupported commands
      expect(mockIris.isAwake).not.toHaveBeenCalled();
      expect(mockIris.getAsyncQueue).not.toHaveBeenCalled();

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/clear",
        success: false,
        async: false, // Returns immediately without queuing
      });

      expect(result.response).toContain("not implemented");
    });
  });

  describe("error handling", () => {
    it("should return failure result on sendMessage error", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
      };

      const error = new Error("Process not running");
      vi.mocked(mockIris.sendMessage).mockRejectedValueOnce(error);

      const result = await command(input, mockIris);

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/compact",
        response: "Process not running",
        success: false,
        async: false,
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should handle AsyncQueue enqueue errors", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
        waitForResponse: false,
      };

      // Make AsyncQueue.enqueue throw
      const mockQueue = vi.mocked(mockIris.getAsyncQueue());
      mockQueue.enqueue = vi.fn().mockImplementation(() => {
        throw new Error("Queue full");
      });

      const result = await command(input, mockIris);

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/compact",
        response: "Queue full",
        success: false,
        async: true,
      });
    });
  });

  describe("supported vs unsupported commands", () => {
    it("should accept compact command", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("OK");

      const result = await command(input, mockIris);

      expect(result.command).toBe("/compact");
      expect(result.success).toBe(true);
    });

    it.each([
      ["clear"],
      ["help"],
      ["status"],
      ["custom"],
    ])("should reject %s command as not implemented", async (cmd) => {
      const input: CommandInput = {
        team: "team-alpha",
        command: cmd,
      };

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).not.toHaveBeenCalled();
      expect(result.command).toBe(`/${cmd}`);
      expect(result.success).toBe(false);
      expect(result.response).toContain("not implemented");
      expect(result.response).toContain("Only /compact is currently supported");
    });
  });
});