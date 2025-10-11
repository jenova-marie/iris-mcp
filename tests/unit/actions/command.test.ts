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

  describe("command formatting", () => {
    it("should add slash prefix if not present", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "compact",
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

    it("should not duplicate slash if already present", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "/clear",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Success");

      await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/clear",
        expect.any(Object)
      );
    });

    it("should append arguments if provided", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "custom",
        args: "arg1 arg2",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Success");

      await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/custom arg1 arg2",
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
        command: "help",
        fromTeam: "team-beta",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Help text");

      await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
        "/help",
        expect.any(Object)
      );
    });
  });

  describe("asynchronous mode (waitForResponse=false)", () => {
    it("should send command without waiting", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "clear",
        waitForResponse: false,
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce(undefined);

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/clear",
        {
          timeout: 30000,
          waitForResponse: false,
        }
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/clear",
        success: true,
        async: true,
      });

      expect(result.response).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should return failure result on error", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "test",
      };

      const error = new Error("Process not running");
      vi.mocked(mockIris.sendMessage).mockRejectedValueOnce(error);

      const result = await command(input, mockIris);

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/test",
        response: "Process not running",
        success: false,
        async: false,
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should handle non-Error exceptions", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "test",
        waitForResponse: false,
      };

      vi.mocked(mockIris.sendMessage).mockRejectedValueOnce(
        "String error"
      );

      const result = await command(input, mockIris);

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "/test",
        response: "String error",
        success: false,
        async: true,
      });
    });
  });

  describe("common commands", () => {
    it.each([
      ["compact", "/compact"],
      ["clear", "/clear"],
      ["help", "/help"],
      ["status", "/status"],
    ])("should handle %s command", async (cmd, expected) => {
      const input: CommandInput = {
        team: "team-alpha",
        command: cmd,
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("OK");

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        expected,
        expect.any(Object)
      );

      expect(result.command).toBe(expected);
      expect(result.success).toBe(true);
    });
  });

  describe("custom commands with arguments", () => {
    it("should handle custom commands with multiple arguments", async () => {
      const input: CommandInput = {
        team: "team-alpha",
        command: "custom-action",
        args: "param1 param2 --flag value",
      };

      vi.mocked(mockIris.sendMessage).mockResolvedValueOnce("Custom result");

      const result = await command(input, mockIris);

      expect(mockIris.sendMessage).toHaveBeenCalledWith(
        null,
        "team-alpha",
        "/custom-action param1 param2 --flag value",
        expect.any(Object)
      );

      expect(result).toMatchObject({
        command: "/custom-action param1 param2 --flag value",
        success: true,
        response: "Custom result",
      });
    });
  });
});