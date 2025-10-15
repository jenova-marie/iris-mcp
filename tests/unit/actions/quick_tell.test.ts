import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { quickTell } from "../../../src/actions/quick_tell.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import * as tellModule from "../../../src/actions/tell.js";

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

describe("quick_tell", () => {
  let mockIris: IrisOrchestrator;
  let tellSpy: any;

  beforeEach(() => {
    mockIris = {} as unknown as IrisOrchestrator;

    // Spy on the tell function
    tellSpy = vi.spyOn(tellModule, "tell").mockResolvedValue({
      from: "team-alpha",
      to: "team-beta",
      message: "test message",
      timestamp: Date.now(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("core functionality", () => {
    it("should call tell with timeout=-1", async () => {
      await quickTell(
        {
          toTeam: "team-beta",
          message: "test message",
          fromTeam: "team-alpha",
        },
        mockIris,
      );

      expect(tellSpy).toHaveBeenCalledWith(
        {
          toTeam: "team-beta",
          message: "test message",
          fromTeam: "team-alpha",
          timeout: -1,
        },
        mockIris,
      );
    });

    it("should return the result from tell", async () => {
      const expectedResult = {
        from: "team-alpha",
        to: "team-beta",
        message: "test message",
        timestamp: Date.now(),
      };

      tellSpy.mockResolvedValue(expectedResult);

      const result = await quickTell(
        {
          toTeam: "team-beta",
          message: "test message",
          fromTeam: "team-alpha",
        },
        mockIris,
      );

      expect(result).toEqual(expectedResult);
    });
  });

  describe("parameter passing", () => {
    it("should pass all parameters correctly", async () => {
      await quickTell(
        {
          toTeam: "team-gamma",
          message: "another test message",
          fromTeam: "team-delta",
        },
        mockIris,
      );

      expect(tellSpy).toHaveBeenCalledWith(
        {
          toTeam: "team-gamma",
          message: "another test message",
          fromTeam: "team-delta",
          timeout: -1,
        },
        mockIris,
      );
    });

    it("should always use timeout=-1 regardless of input", async () => {
      // Even if someone tries to pass timeout in the input, it should be ignored
      const input: any = {
        toTeam: "team-beta",
        message: "test",
        fromTeam: "team-alpha",
        timeout: 30000, // This should be ignored
      };

      await quickTell(input, mockIris);

      expect(tellSpy).toHaveBeenCalledWith(
        {
          toTeam: "team-beta",
          message: "test",
          fromTeam: "team-alpha",
          timeout: -1, // Always -1
        },
        mockIris,
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from tell", async () => {
      const error = new Error("Tell failed");
      tellSpy.mockRejectedValue(error);

      await expect(
        quickTell(
          {
            toTeam: "team-beta",
            message: "test",
            fromTeam: "team-alpha",
          },
          mockIris,
        ),
      ).rejects.toThrow("Tell failed");
    });
  });
});
