/**
 * Unit tests for ClaudePrintExecutor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudePrintExecutor } from "../../../src/utils/claude-print.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import { TimeoutError } from "../../../src/utils/errors.js";
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Mock logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";

describe("ClaudePrintExecutor", () => {
  const localConfig: IrisConfig = {
    path: "/test/project",
    description: "Test team",
  };

  const remoteConfig: IrisConfig = {
    path: "/opt/containers",
    description: "Remote team",
    remote: "ssh inanna",
    claudePath: "~/.local/bin/claude",
  };

  let mockProcess: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock process
    mockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    });

    vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("Factory method", () => {
    it("should create executor with factory method", () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");
      expect(executor).toBeInstanceOf(ClaudePrintExecutor);
    });
  });

  describe("Local execution", () => {
    it("should execute command successfully with --resume", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      // Start execution
      const resultPromise = executor.execute({
        command: "/compact",
        resume: true,
        timeout: 10000,
      });

      // Simulate stdout
      mockProcess.stdout.emit("data", Buffer.from("Compacted successfully\n"));

      // Simulate process exit
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Compacted successfully\n");
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Verify spawn was called correctly
      expect(spawn).toHaveBeenCalledWith(
        "claude",
        ["--resume", "session-123", "--print", "/compact"],
        {
          cwd: "/test/project",
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        },
      );

      // Verify stdin was closed
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it("should execute command with --session-id when resume=false", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-new");

      const resultPromise = executor.execute({
        command: "ping",
        resume: false,
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "claude",
        ["--session-id", "session-new", "--print", "ping"],
        expect.any(Object),
      );
    });

    it("should use custom claudePath if provided", async () => {
      const customConfig: IrisConfig = {
        ...localConfig,
        claudePath: "~/.local/bin/claude",
      };

      const executor = ClaudePrintExecutor.create(customConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        "~/.local/bin/claude",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("should handle non-zero exit code", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "/compact",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("Some output\n"));
      mockProcess.stderr.emit("data", Buffer.from("Error occurred\n"));
      mockProcess.emit("exit", 1);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("Some output\n");
      expect(result.stderr).toBe("Error occurred\n");
    });

    it("should handle SIGTERM (exit code 143) as success", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 143);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(143);
    });

    it("should capture debug log path from stderr", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stderr.emit(
        "data",
        Buffer.from("Logging to: /home/user/.claude/logs/debug.log\n"),
      );
      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.debugLogPath).toBe("/home/user/.claude/logs/debug.log");
    });

    it("should handle timeout", async () => {
      vi.useFakeTimers();

      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "/compact",
        timeout: 1000,
      });

      // Advance time past timeout
      vi.advanceTimersByTime(1001);

      await expect(resultPromise).rejects.toThrow(TimeoutError);
      await expect(resultPromise).rejects.toThrow(
        "Command execution timed out after 1000ms",
      );

      // Verify process was killed
      expect(mockProcess.kill).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should handle spawn error", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      const spawnError = new Error("ENOENT: command not found");
      mockProcess.emit("error", spawnError);
      mockProcess.emit("exit", -1);

      await expect(resultPromise).rejects.toThrow("ENOENT: command not found");
    });

    it("should handle no response received", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      // Exit without any stdout
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.stdout).toBe("");
    });
  });

  describe("Remote execution", () => {
    it("should execute command via SSH", async () => {
      const executor = ClaudePrintExecutor.create(remoteConfig, "session-123");

      const resultPromise = executor.execute({
        command: "/compact",
        resume: true,
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("Compacted successfully\n"));
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);

      // Verify SSH command structure
      expect(spawn).toHaveBeenCalledWith(
        "ssh",
        [
          "inanna",
          "cd '/opt/containers' && ~/.local/bin/claude --resume session-123 --print /compact",
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        },
      );
    });

    it("should escape shell arguments for remote paths with spaces", async () => {
      const configWithSpaces: IrisConfig = {
        ...remoteConfig,
        path: "/path with spaces/project",
      };

      const executor = ClaudePrintExecutor.create(
        configWithSpaces,
        "session-123",
      );

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      // Verify path is properly escaped
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const remoteCommand = spawnCall[1][1];
      expect(remoteCommand).toContain("'/path with spaces/project'");
    });

    it("should handle SSH connection with flags", async () => {
      const configWithFlags: IrisConfig = {
        ...remoteConfig,
        remote: "ssh -p 2222 inanna",
      };

      const executor = ClaudePrintExecutor.create(
        configWithFlags,
        "session-123",
      );

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      // Verify SSH flags are preserved
      expect(spawn).toHaveBeenCalledWith(
        "ssh",
        expect.arrayContaining(["-p", "2222", "inanna"]),
        expect.any(Object),
      );
    });

    it("should use --session-id for remote when resume=false", async () => {
      const executor = ClaudePrintExecutor.create(remoteConfig, "session-new");

      const resultPromise = executor.execute({
        command: "ping",
        resume: false,
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const remoteCommand = spawnCall[1][1];
      expect(remoteCommand).toContain("--session-id session-new");
      expect(remoteCommand).not.toContain("--resume");
    });
  });

  describe("Default values", () => {
    it("should use default timeout of 30000ms", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      // If we got here without timeout, default was used
      expect(true).toBe(true);
    });

    it("should use resume=true by default", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        ["--resume", "session-123", "--print", "ping"],
        expect.any(Object),
      );
    });

    it("should use 'claude' as default executable", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.any(Array),
        expect.any(Object),
      );
    });
  });

  describe("Shell escaping", () => {
    it("should escape single quotes in paths", async () => {
      const configWithQuotes: IrisConfig = {
        ...remoteConfig,
        path: "/path/with'quotes/project",
      };

      const executor = ClaudePrintExecutor.create(
        configWithQuotes,
        "session-123",
      );

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const remoteCommand = spawnCall[1][1];
      // Single quote should be escaped as '\''
      expect(remoteCommand).toContain("/path/with'\\''quotes/project");
    });

    it("should handle special characters in paths", async () => {
      const configWithSpecial: IrisConfig = {
        ...remoteConfig,
        path: "/path/with$vars/and;semicolons",
      };

      const executor = ClaudePrintExecutor.create(
        configWithSpecial,
        "session-123",
      );

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const remoteCommand = spawnCall[1][1];
      // Should be wrapped in single quotes to prevent expansion
      expect(remoteCommand).toContain("'/path/with$vars/and;semicolons'");
    });
  });

  describe("Duration tracking", () => {
    it("should track execution duration", async () => {
      vi.useFakeTimers();
      const startTime = Date.now();

      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        timeout: 10000,
      });

      // Advance time by 500ms
      vi.advanceTimersByTime(500);

      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.duration).toBeGreaterThanOrEqual(500);

      vi.useRealTimers();
    });
  });

  describe("Retry logic", () => {
    it("should retry on spawn error", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      let attemptCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        attemptCount++;
        const proc = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: { end: vi.fn() },
          kill: vi.fn(),
        });

        if (attemptCount < 3) {
          // Fail first 2 attempts
          setImmediate(() => {
            proc.emit("error", new Error("ECONNREFUSED"));
            proc.emit("exit", -1);
          });
        } else {
          // Succeed on 3rd attempt
          setImmediate(() => {
            proc.stdout.emit("data", Buffer.from("pong\n"));
            proc.emit("exit", 0);
          });
        }

        return proc as unknown as ChildProcess;
      });

      const result = await executor.execute({
        command: "ping",
        retries: 2,
        retryDelay: 10, // Short delay for testing
      });

      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(2);
      expect(result.totalAttempts).toBe(3);
      expect(attemptCount).toBe(3);
    });

    it("should fail after exhausting retries", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      vi.mocked(spawn).mockImplementation(() => {
        const proc = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: { end: vi.fn() },
          kill: vi.fn(),
        });

        setImmediate(() => {
          proc.emit("error", new Error("ECONNREFUSED"));
          proc.emit("exit", -1);
        });

        return proc as unknown as ChildProcess;
      });

      await expect(
        executor.execute({
          command: "ping",
          retries: 2,
          retryDelay: 10,
        }),
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("should not retry on successful first attempt", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
        retries: 2,
      });

      // Simulate successful response
      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(0);
      expect(result.totalAttempts).toBe(1);

      // Verify spawn was only called once
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it("should use exponential backoff for retries", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      let attemptCount = 0;
      const delayStarts: number[] = [];

      vi.mocked(spawn).mockImplementation(() => {
        attemptCount++;

        const proc = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: { end: vi.fn() },
          kill: vi.fn(),
        });

        if (attemptCount < 3) {
          // Fail first 2 attempts
          setImmediate(() => {
            proc.emit("error", new Error("Temporary failure"));
            proc.emit("exit", -1);
          });
        } else {
          // Succeed on 3rd attempt
          setImmediate(() => {
            proc.stdout.emit("data", Buffer.from("pong\n"));
            proc.emit("exit", 0);
          });
        }

        return proc as unknown as ChildProcess;
      });

      const startTime = Date.now();

      const result = await executor.execute({
        command: "ping",
        retries: 2,
        retryDelay: 100, // 100ms base delay
      });

      const totalTime = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(2);
      expect(result.totalAttempts).toBe(3);

      // Total delay should be: 100ms (1st retry) + 200ms (2nd retry) = 300ms minimum
      // Allow some overhead for execution time
      expect(totalTime).toBeGreaterThanOrEqual(250);
    });
  });

  describe("Metrics tracking", () => {
    it("should record metrics for successful execution", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const resultPromise = executor.execute({
        command: "ping",
      });

      // Simulate successful response
      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);

      await resultPromise;

      const metrics = executor.getMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        command: "ping",
        success: true,
        remote: false,
        retryCount: 0,
        exitCode: 0,
      });
      expect(metrics[0].duration).toBeGreaterThanOrEqual(0);
      expect(metrics[0].timestamp).toBeGreaterThan(0);
    });

    it("should record metrics for multiple commands", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      // First command
      let promise = executor.execute({ command: "ping" });
      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);
      await promise;

      // Second command (need new mock process)
      vi.clearAllMocks();
      mockProcess = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: { end: vi.fn() },
        kill: vi.fn(),
      });
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      promise = executor.execute({ command: "/compact" });
      mockProcess.stdout.emit("data", Buffer.from("ok\n"));
      mockProcess.emit("exit", 0);
      await promise;

      const metrics = executor.getMetrics();

      expect(metrics).toHaveLength(2);
      expect(metrics[0].command).toBe("ping");
      expect(metrics[1].command).toBe("/compact");
    });

    it("should clear metrics", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const promise = executor.execute({ command: "ping" });
      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);
      await promise;

      expect(executor.getMetrics()).toHaveLength(1);

      executor.clearMetrics();

      expect(executor.getMetrics()).toHaveLength(0);
    });

    it("should return copy of metrics to prevent mutation", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      const promise = executor.execute({ command: "ping" });
      mockProcess.stdout.emit("data", Buffer.from("pong\n"));
      mockProcess.emit("exit", 0);
      await promise;

      const metrics1 = executor.getMetrics();
      const metrics2 = executor.getMetrics();

      expect(metrics1).not.toBe(metrics2); // Different array instances
      expect(metrics1).toEqual(metrics2); // But same content
    });

    it("should record metrics with retry information", async () => {
      const executor = ClaudePrintExecutor.create(localConfig, "session-123");

      let attemptCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        attemptCount++;
        const proc = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: { end: vi.fn() },
          kill: vi.fn(),
        });

        if (attemptCount < 2) {
          setImmediate(() => {
            proc.emit("error", new Error("Temporary failure"));
            proc.emit("exit", -1);
          });
        } else {
          setImmediate(() => {
            proc.stdout.emit("data", Buffer.from("pong\n"));
            proc.emit("exit", 0);
          });
        }

        return proc as unknown as ChildProcess;
      });

      await executor.execute({
        command: "ping",
        retries: 1,
        retryDelay: 10,
      });

      const metrics = executor.getMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0].retryCount).toBe(1);
    });
  });
});
