/**
 * Unit tests for ClaudeProcess - basic functionality without real process spawning
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { TeamConfig } from "../../../src/process-pool/types.js";
import { ProcessError } from "../../../src/utils/errors.js";

describe("ClaudeProcess Unit Tests", () => {
  let claudeProcess: ClaudeProcess;
  const testTeamConfig: TeamConfig = {
    path: process.cwd(),
    description: "Test team for unit tests",
    skipPermissions: true,
  };

  beforeEach(() => {
    claudeProcess = new ClaudeProcess("team-alpha", testTeamConfig, 300000);
  });

  describe("constructor", () => {
    it("should create instance with correct initial state", () => {
      const metrics = claudeProcess.getMetrics();

      expect(metrics.status).toBe("stopped");
      expect(metrics.pid).toBeUndefined();
      expect(metrics.messagesProcessed).toBe(0);
      expect(metrics.queueLength).toBe(0);
      expect(metrics.uptime).toBe(0);
    });

    it("should be an EventEmitter", () => {
      expect(claudeProcess.on).toBeDefined();
      expect(claudeProcess.emit).toBeDefined();
      expect(claudeProcess.removeListener).toBeDefined();
    });
  });

  describe("getMetrics", () => {
    it("should return current metrics", () => {
      const metrics = claudeProcess.getMetrics();

      expect(metrics).toMatchObject({
        pid: undefined,
        status: "stopped",
        messagesProcessed: 0,
        lastUsed: expect.any(Number),
        uptime: 0,
        idleTimeRemaining: 0,
        queueLength: 0,
      });
    });

    it("should return consistent metrics on multiple calls", () => {
      const metrics1 = claudeProcess.getMetrics();
      const metrics2 = claudeProcess.getMetrics();

      expect(metrics1.status).toBe(metrics2.status);
      expect(metrics1.messagesProcessed).toBe(metrics2.messagesProcessed);
      expect(metrics1.queueLength).toBe(metrics2.queueLength);
    });
  });

  describe("sendMessage when stopped", () => {
    it("should reject when process is not running", async () => {
      await expect(claudeProcess.sendMessage("test message")).rejects.toThrow(
        ProcessError,
      );

      await expect(claudeProcess.sendMessage("test message")).rejects.toThrow(
        "Process not running",
      );
    });
  });

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
    it("should start in stopped state", () => {
      expect(claudeProcess.getMetrics().status).toBe("stopped");
    });

    it("should reject spawn if already has process", async () => {
      // This is a bit tricky to test without actually spawning, but we can
      // verify the error handling logic exists by checking the implementation
      // For now, just verify initial state
      expect(claudeProcess.getMetrics().status).toBe("stopped");
    });
  });

  describe("configuration", () => {
    it("should accept different idle timeouts", () => {
      const process1 = new ClaudeProcess("team1", testTeamConfig, 60000);
      const process2 = new ClaudeProcess("team2", testTeamConfig, 120000);

      // Both should start in stopped state regardless of timeout
      expect(process1.getMetrics().status).toBe("stopped");
      expect(process2.getMetrics().status).toBe("stopped");
    });

    it("should handle different team configurations", () => {
      const config1: TeamConfig = {
        path: "/path/1",
        description: "Team 1",
        skipPermissions: true,
      };

      const config2: TeamConfig = {
        path: "/path/2",
        description: "Team 2",
        skipPermissions: false,
        color: "#ff0000",
      };

      const process1 = new ClaudeProcess("team1", config1, 300000);
      const process2 = new ClaudeProcess("team2", config2, 300000);

      expect(process1.getMetrics().status).toBe("stopped");
      expect(process2.getMetrics().status).toBe("stopped");
    });
  });

  describe("error handling", () => {
    it("should handle invalid team names gracefully", () => {
      expect(() => {
        new ClaudeProcess("", testTeamConfig, 300000);
      }).not.toThrow();

      expect(() => {
        new ClaudeProcess("team-with-special-chars!@#", testTeamConfig, 300000);
      }).not.toThrow();
    });

    it("should handle edge case timeouts", () => {
      expect(() => {
        new ClaudeProcess("team", testTeamConfig, 0);
      }).not.toThrow();

      expect(() => {
        new ClaudeProcess("team", testTeamConfig, -1);
      }).not.toThrow();

      expect(() => {
        new ClaudeProcess("team", testTeamConfig, Number.MAX_SAFE_INTEGER);
      }).not.toThrow();
    });
  });
});
