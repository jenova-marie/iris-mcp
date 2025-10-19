/**
 * Unit tests for MCP Config Writer
 *
 * Tests the script-based MCP config file writing system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import {
  writeMcpConfig,
  writeMcpConfigLocal,
  writeMcpConfigRemote,
  DEFAULT_LOCAL_SCRIPT,
  DEFAULT_REMOTE_SCRIPT,
} from "../../../src/utils/mcp-config-writer.js";

// Mock child_process to avoid actual script execution
let mockChildProcess: any;
let mockSpawn: any;

vi.mock("child_process", () => {
  return {
    spawn: vi.fn((...args) => {
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.stderr = new EventEmitter();
      mockChildProcess.stdin = {
        write: vi.fn(),
        end: vi.fn(),
      };

      // Store spawn args for verification
      mockSpawn.lastCall = args;

      return mockChildProcess;
    }),
  };
});

describe("MCP Config Writer", () => {
  const testMcpConfig = {
    mcpServers: {
      iris: {
        type: "http",
        url: "http://localhost:1615/mcp/session-123",
      },
    },
  };

  const testTeamPath = "/Users/test/projects/team-alpha";
  const testRemoteTeamPath = "/home/user/projects/team-beta";

  beforeEach(async () => {
    vi.clearAllMocks();
    const childProcess = await import("child_process");
    mockSpawn = childProcess.spawn;
    mockChildProcess = null;
  });

  afterEach(() => {
    mockChildProcess = null;
  });

  describe("writeMcpConfig()", () => {
    it("should execute shell script and return file path", async () => {
      const scriptPath = "/test/script.sh";
      const expectedFilePath = "/tmp/iris-mcp-session-123.json";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      // Simulate script execution
      setTimeout(() => {
        mockChildProcess.stdout.emit("data", `${expectedFilePath}\n`);
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      const filePath = await promise;

      expect(filePath).toBe(expectedFilePath);
      expect(mockSpawn).toHaveBeenCalledWith(
        scriptPath,
        ["session-123"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        }),
      );
    });

    it("should pass MCP config JSON to script stdin", async () => {
      const scriptPath = "/test/script.sh";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      setTimeout(() => {
        mockChildProcess.stdout.emit("data", "/tmp/test.json\n");
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      expect(mockChildProcess.stdin.write).toHaveBeenCalledWith(
        JSON.stringify(testMcpConfig, null, 2),
      );
      expect(mockChildProcess.stdin.end).toHaveBeenCalled();
    });

    it("should execute PowerShell for .ps1 scripts", async () => {
      const scriptPath = "/test/script.ps1";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      setTimeout(() => {
        mockChildProcess.stdout.emit("data", "C:\\temp\\test.json\n");
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "powershell",
        ["-File", scriptPath, "session-123"],
        expect.any(Object),
      );
    });

    it("should pass additional script args", async () => {
      const scriptPath = "/test/script.sh";

      const promise = writeMcpConfig(
        scriptPath,
        testMcpConfig,
        "session-123",
        "/custom/dir",
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit("data", "/custom/dir/test.json\n");
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        scriptPath,
        ["session-123", "/custom/dir"],
        expect.any(Object),
      );
    });

    it("should extract file path from last non-empty stdout line", async () => {
      const scriptPath = "/test/script.sh";
      const expectedPath = "/tmp/iris-mcp-session-123.json";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      setTimeout(() => {
        mockChildProcess.stdout.emit("data", "Creating directory...\n");
        mockChildProcess.stdout.emit("data", "Writing file...\n");
        mockChildProcess.stdout.emit("data", `${expectedPath}\n`);
        mockChildProcess.stdout.emit("data", "\n");
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      const filePath = await promise;

      expect(filePath).toBe(expectedPath);
    });

    it("should reject if script exits with non-zero code", async () => {
      const scriptPath = "/test/script.sh";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      setTimeout(() => {
        mockChildProcess.stderr.emit("data", "Permission denied\n");
        mockChildProcess.emit("exit", 1, null);
      }, 10);

      await expect(promise).rejects.toThrow(
        /MCP config script failed.*exit code 1/,
      );
    });

    it("should reject if script does not output file path", async () => {
      const scriptPath = "/test/script.sh";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      setTimeout(() => {
        mockChildProcess.stdout.emit("data", "\n");
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await expect(promise).rejects.toThrow(
        /MCP config script did not output a file path/,
      );
    });

    it("should reject if script process fails to spawn", async () => {
      const scriptPath = "/nonexistent/script.sh";

      const promise = writeMcpConfig(scriptPath, testMcpConfig, "session-123");

      setTimeout(() => {
        const error = new Error("ENOENT: no such file or directory");
        (error as any).code = "ENOENT";
        mockChildProcess.emit("error", error);
      }, 10);

      await expect(promise).rejects.toThrow(
        /Failed to execute MCP config script/,
      );
    });
  });

  describe("writeMcpConfigLocal()", () => {
    it("should use default local script", async () => {
      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        testTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testTeamPath}/.claude/iris/mcp/iris-mcp-session-123.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[0]).toBe(DEFAULT_LOCAL_SCRIPT);
      expect(lastCall[1]).toEqual(["session-123", testTeamPath]);
    });

    it("should use custom script when provided", async () => {
      const customScript = "/custom/mcp-cp.sh";

      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        testTeamPath,
        undefined, // sessionMcpPath (use default)
        customScript, // scriptPath
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testTeamPath}/.claude/iris/mcp/test.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[0]).toBe(customScript);
    });

    it("should pass team path to script", async () => {
      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        testTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testTeamPath}/.claude/iris/mcp/test.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[1]).toEqual(["session-123", testTeamPath]);
    });
  });

  describe("writeMcpConfigRemote()", () => {
    it("should use default remote script", async () => {
      const promise = writeMcpConfigRemote(
        testMcpConfig,
        "session-123",
        "user@host",
        testRemoteTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testRemoteTeamPath}/.claude/iris/mcp/iris-mcp-session-123.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[0]).toBe(DEFAULT_REMOTE_SCRIPT);
      expect(lastCall[1]).toEqual([
        "session-123",
        "user@host",
        testRemoteTeamPath,
      ]);
    });

    it("should use custom script when provided", async () => {
      const customScript = "/custom/mcp-scp.sh";

      const promise = writeMcpConfigRemote(
        testMcpConfig,
        "session-123",
        "user@host",
        testRemoteTeamPath,
        undefined, // sessionMcpPath (use default)
        customScript, // scriptPath
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testRemoteTeamPath}/.claude/iris/mcp/test.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[0]).toBe(customScript);
    });

    it("should pass remote team path to script", async () => {
      const promise = writeMcpConfigRemote(
        testMcpConfig,
        "session-123",
        "user@host",
        testRemoteTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testRemoteTeamPath}/.claude/iris/mcp/test.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[1]).toEqual([
        "session-123",
        "user@host",
        testRemoteTeamPath,
      ]);
    });

    it("should handle SSH aliases", async () => {
      const promise = writeMcpConfigRemote(
        testMcpConfig,
        "session-123",
        "inanna", // SSH config alias
        testRemoteTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testRemoteTeamPath}/.claude/iris/mcp/test.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      await promise;

      const lastCall = (mockSpawn as any).mock.calls[0];
      expect(lastCall[1]).toEqual([
        "session-123",
        "inanna",
        testRemoteTeamPath,
      ]);
    });
  });

  describe("cross-platform behavior", () => {
    it("should handle Unix line endings in stdout", async () => {
      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        testTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${testTeamPath}/.claude/iris/mcp/test.json\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      const filePath = await promise;
      expect(filePath).toBe(`${testTeamPath}/.claude/iris/mcp/test.json`);
    });

    it("should handle Windows line endings in stdout", async () => {
      const windowsTeamPath = "C:\\Users\\test\\projects\\team-alpha";
      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        windowsTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stdout.emit(
          "data",
          `${windowsTeamPath}\\.claude\\iris\\mcp\\test.json\r\n`,
        );
        mockChildProcess.emit("exit", 0, null);
      }, 10);

      const filePath = await promise;
      expect(filePath).toBe(
        `${windowsTeamPath}\\.claude\\iris\\mcp\\test.json`,
      );
    });
  });

  describe("error handling", () => {
    it("should include stderr in error message on failure", async () => {
      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        testTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.stderr.emit(
          "data",
          "Permission denied: .claude/iris/mcp\n",
        );
        mockChildProcess.stderr.emit("data", "Cannot write file\n");
        mockChildProcess.emit("exit", 13, null);
      }, 10);

      await expect(promise).rejects.toThrow(
        /Permission denied: .claude\/iris\/mcp/,
      );
      await expect(promise).rejects.toThrow(/Cannot write file/);
    });

    it("should handle script killed by signal", async () => {
      const promise = writeMcpConfigLocal(
        testMcpConfig,
        "session-123",
        testTeamPath,
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", null, "SIGKILL");
      }, 10);

      await expect(promise).rejects.toThrow(/MCP config script failed/);
    });
  });
});
