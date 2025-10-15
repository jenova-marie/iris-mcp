/**
 * Unit tests for ClaudeProcess - basic functionality without real process spawning
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger BEFORE imports using hoisting
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import { ProcessError } from "../../../src/utils/errors.js";

describe("ClaudeProcess Unit Tests", () => {
  let claudeProcess: ClaudeProcess;
  const testIrisConfig: IrisConfig = {
    path: process.cwd(),
    description: "Test team for unit tests",
    skipPermissions: true,
  };

  beforeEach(() => {
    claudeProcess = new ClaudeProcess("team-alpha", testIrisConfig, null);
  });

  describe("constructor", () => {
    it("should create instance with correct initial state", () => {
      const metrics = claudeProcess.getBasicMetrics();

      expect(metrics.teamName).toBe("team-alpha");
      expect(metrics.pid).toBeNull();
      expect(metrics.uptime).toBe(0);
      expect(metrics.isReady).toBe(false);
      expect(metrics.isSpawning).toBe(false);
      expect(metrics.isBusy).toBe(false);
    });

    it("should be an EventEmitter", () => {
      expect(claudeProcess.on).toBeDefined();
      expect(claudeProcess.emit).toBeDefined();
      expect(claudeProcess.removeListener).toBeDefined();
    });
  });

  describe("getBasicMetrics", () => {
    it("should return current metrics", () => {
      const metrics = claudeProcess.getBasicMetrics();

      expect(metrics).toMatchObject({
        teamName: "team-alpha",
        pid: null,
        uptime: 0,
        isReady: false,
        isSpawning: false,
        isBusy: false,
      });
    });

    it("should return consistent metrics on multiple calls", () => {
      const metrics1 = claudeProcess.getBasicMetrics();
      const metrics2 = claudeProcess.getBasicMetrics();

      expect(metrics1.teamName).toBe(metrics2.teamName);
      expect(metrics1.isReady).toBe(metrics2.isReady);
      expect(metrics1.isBusy).toBe(metrics2.isBusy);
    });
  });

  // sendMessage removed - ClaudeProcess is now a dumb pipe
  // Use executeTell(cacheEntry) instead, but that requires Iris orchestration

  describe("terminate when stopped", () => {
    it("should resolve immediately when no process exists", async () => {
      await expect(claudeProcess.terminate()).resolves.toBeUndefined();
    });
  });

  describe("event emission", () => {
    it("should be able to add and remove listeners", () => {
      const listener = vi.fn();

      claudeProcess.on("test-event", listener);
      claudeProcess.emit("test-event", { test: "data" });

      expect(listener).toHaveBeenCalledWith({ test: "data" });

      claudeProcess.removeListener("test-event", listener);
      claudeProcess.emit("test-event", { test: "data2" });

      // Should still only have been called once (from before removal)
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("state transitions", () => {
    it("should start in stopped state (not ready, not spawning, not busy)", () => {
      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.isReady).toBe(false);
      expect(metrics.isSpawning).toBe(false);
      expect(metrics.isBusy).toBe(false);
    });

    it("should verify initial state flags are consistent", () => {
      const metrics = claudeProcess.getBasicMetrics();
      // Not ready and not spawning means stopped
      expect(metrics.isReady).toBe(false);
      expect(metrics.isSpawning).toBe(false);
    });
  });

  describe("configuration", () => {
    it("should accept different session IDs", () => {
      const process1 = new ClaudeProcess("team1", testIrisConfig, "session-1");
      const process2 = new ClaudeProcess("team2", testIrisConfig, "session-2");

      // Both should start in stopped state regardless of session
      expect(process1.getBasicMetrics().isReady).toBe(false);
      expect(process2.getBasicMetrics().isReady).toBe(false);
    });

    it("should handle different team configurations", () => {
      const config1: IrisConfig = {
        path: "/path/1",
        description: "Team 1",
        skipPermissions: true,
      };

      const config2: IrisConfig = {
        path: "/path/2",
        description: "Team 2",
        skipPermissions: false,
        color: "#ff0000",
      };

      const process1 = new ClaudeProcess("team1", config1, null);
      const process2 = new ClaudeProcess("team2", config2, "session-2");

      expect(process1.getBasicMetrics().isReady).toBe(false);
      expect(process2.getBasicMetrics().isReady).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle invalid team names gracefully", () => {
      expect(() => {
        new ClaudeProcess("", testIrisConfig, null);
      }).not.toThrow();

      expect(() => {
        new ClaudeProcess(
          "team-with-special-chars!@#",
          testIrisConfig,
          "session-1",
        );
      }).not.toThrow();
    });

    it("should handle edge case session IDs", () => {
      expect(() => {
        new ClaudeProcess("team", testIrisConfig, null);
      }).not.toThrow();

      expect(() => {
        new ClaudeProcess("team", testIrisConfig, "");
      }).not.toThrow();

      expect(() => {
        new ClaudeProcess(
          "team",
          testIrisConfig,
          "very-long-session-id-".repeat(10),
        );
      }).not.toThrow();
    });
  });
});
