import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { command } from "../../../src/actions/command.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import { ConfigurationError } from "../../../src/utils/errors.js";

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
  validateTimeout: vi.fn(),
}));

describe("command", () => {
  let mockIris: IrisOrchestrator;

  beforeEach(() => {
    mockIris = {
      sendCommandToSession: vi.fn().mockResolvedValue("Command executed successfully"),
    } as unknown as IrisOrchestrator;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("compact command", () => {
    it("should send compact command to team", async () => {
      const result = await command(
        {
          team: "team-alpha",
          command: "compact",
          fromTeam: "external",
        },
        mockIris
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        command: "compact",
        response: expect.any(String),
        success: true,
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockIris.sendCommandToSession).toHaveBeenCalledWith(
        "external",
        "team-alpha",
        "/compact",
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it("should handle custom timeout", async () => {
      await command(
        {
          team: "team-alpha",
          command: "compact",
          fromTeam: "external",
          timeout: 60000,
        },
        mockIris
      );

      expect(mockIris.sendCommandToSession).toHaveBeenCalledWith(
        "external",
        "team-alpha",
        "/compact",
        expect.objectContaining({ timeout: 60000 })
      );
    });

    it("should reject unsupported commands", async () => {
      await expect(
        command(
          {
            team: "team-alpha",
            command: "help",  // Not supported
            fromTeam: "external",
          },
          mockIris
        )
      ).rejects.toThrow("Unsupported command");
    });
  });

  describe("error handling", () => {
    it("should handle command execution errors", async () => {
      vi.mocked(mockIris.sendCommandToSession).mockRejectedValue(
        new Error("Command failed")
      );

      await expect(
        command(
          {
            team: "team-alpha",
            command: "compact",
            fromTeam: "external",
          },
          mockIris
        )
      ).rejects.toThrow("Command failed");
    });
  });

  describe("validation", () => {
    it("should validate team names", async () => {
      const { validateTeamName } = await import("../../../src/utils/validation.js");

      await command(
        {
          team: "team-alpha",
          command: "compact",
          fromTeam: "team-beta",
        },
        mockIris
      );

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-beta");
    });

    it("should validate timeout", async () => {
      const { validateTimeout } = await import("../../../src/utils/validation.js");

      await command(
        {
          team: "team-alpha",
          command: "compact",
          fromTeam: "external",
          timeout: 45000,
        },
        mockIris
      );

      expect(vi.mocked(validateTimeout)).toHaveBeenCalledWith(45000);
    });
  });
});
