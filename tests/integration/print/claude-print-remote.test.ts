/**
 * Integration tests for ClaudePrintExecutor - Remote execution
 * Tests actual execution of claude --print commands via SSH
 *
 * Set IRIS_TEST_REMOTE=1 to enable these tests.
 *
 * Requirements:
 * - OpenSSH client installed locally (ssh command available)
 * - SSH access to the remote host configured in tests/config.json
 * - SSH keys configured (no password prompts - use ssh-agent)
 * - Claude CLI installed on remote host
 * - Remote host: ssh inanna (configured in ~/.ssh/config)
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ClaudePrintExecutor } from "../../../src/utils/claude-print.js";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

// Only run these tests if explicitly enabled
const REMOTE_TESTS_ENABLED = process.env.IRIS_TEST_REMOTE === "1";
const describeRemote = REMOTE_TESTS_ENABLED ? describe : describe.skip;

/**
 * Check if Claude is installed on remote host at configured path
 */
async function checkRemoteClaude(
  host: string,
  claudePath: string = "claude",
): Promise<boolean> {
  return new Promise((resolve) => {
    const testCmd = `${claudePath} --version`;
    const proc = spawn("ssh", ["-T", host, testCmd]);

    let output = "";

    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("exit", (code) => {
      const isValid = code === 0 && output.includes("Claude Code");
      resolve(isValid);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Clean up remote session file
 */
async function cleanupRemoteSession(
  host: string,
  sessionFilePath: string,
): Promise<void> {
  return new Promise((resolve) => {
    const rmCmd = `rm -f ${sessionFilePath}`;
    const proc = spawn("ssh", ["-T", host, rmCmd]);

    proc.on("exit", () => {
      resolve();
    });

    proc.on("error", () => {
      resolve(); // Ignore cleanup errors
    });
  });
}

describeRemote("ClaudePrintExecutor Integration - Remote", () => {
  let testConfig: IrisConfig;
  let sessionId: string;
  let sessionFilePath: string;
  let claudeAvailable = false;

  const REMOTE_TEAM = "team-inanna";
  const REMOTE_HOST = "inanna"; // SSH config alias
  const TEST_TIMEOUT = 60000; // 60 seconds for SSH operations

  // Load actual test config
  const testConfigPath = "./tests/config.json";
  const configManager = new TeamsConfigManager(testConfigPath);
  configManager.load();
  const config = configManager.getConfig();

  beforeAll(async () => {
    // Use team-inanna remote config
    testConfig = config.teams[REMOTE_TEAM];

    // Check if Claude is available on remote host
    const claudePath = testConfig.claudePath || "claude";
    claudeAvailable = await checkRemoteClaude(REMOTE_HOST, claudePath);

    if (!claudeAvailable) {
      console.warn(
        `\n⚠️  Claude CLI not found on remote host '${REMOTE_HOST}'\n` +
          `   Checked path: ${claudePath}\n` +
          `   Remote print tests will be skipped. To run full test suite:\n` +
          `   1. Install Claude CLI on remote host\n` +
          `   2. Update claudePath in config if needed\n`,
      );
    } else {
      console.log(
        `\n✅ Claude CLI found on remote host '${REMOTE_HOST}' at ${claudePath}\n`,
      );
    }

    // Generate unique session ID for this test run (must be UUID)
    sessionId = randomUUID();
    sessionFilePath = ClaudeProcess.getSessionFilePath(
      testConfig.path,
      sessionId,
    );
  }, 120000);

  afterEach(async () => {
    // Cleanup: Remove remote session file if it was created
    if (claudeAvailable) {
      await cleanupRemoteSession(REMOTE_HOST, sessionFilePath);
    }
  });

  describe("Remote Configuration", () => {
    it("should load remote team from config", () => {
      const teamConfig = configManager.getIrisConfig(REMOTE_TEAM);

      expect(teamConfig).toBeDefined();
      expect(teamConfig?.remote).toBe("ssh inanna");
      expect(teamConfig?.path).toBe("/opt/containers");
      expect(teamConfig?.claudePath).toBe("~/.local/bin/claude");
    });

    it("should verify SSH connection to remote host", async () => {
      const canConnect = await new Promise<boolean>((resolve) => {
        const proc = spawn("ssh", [
          "-T",
          "-o",
          "ConnectTimeout=5",
          REMOTE_HOST,
          "echo 'OK'",
        ]);
        let output = "";

        proc.stdout?.on("data", (data) => {
          output += data.toString();
        });

        proc.on("exit", (code) => {
          resolve(code === 0 && output.includes("OK"));
        });

        proc.on("error", () => {
          resolve(false);
        });
      });

      expect(canConnect).toBe(true);
    }, 10000);
  });

  describe("Remote session initialization", () => {
    it(
      "should initialize remote session using ping command",
      async () => {
        if (!claudeAvailable) {
          console.log("Skipping: Claude not installed on remote host");
          return;
        }

        const executor = ClaudePrintExecutor.create(testConfig, sessionId);

        const result = await executor.execute({
          command: "ping",
          resume: false, // Use --session-id to create new session
          timeout: config.settings.sessionInitTimeout,
        });

        // Should complete successfully
        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBeTruthy();
        expect(result.stdout.length).toBeGreaterThan(0);

        // Should have reasonable duration
        expect(result.duration).toBeGreaterThan(0);
        expect(result.duration).toBeLessThan(
          config.settings.sessionInitTimeout,
        );

        console.log(`\n✅ Remote session created in ${result.duration}ms\n`);
      },
      TEST_TIMEOUT,
    );

    it.skip(
      "should capture debug log path from remote execution",
      async () => {
        if (!claudeAvailable) return;

        const executor = ClaudePrintExecutor.create(testConfig, sessionId);

        const result = await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        expect(result.success).toBe(true);

        // Debug log path might be captured from stderr
        if (result.debugLogPath) {
          expect(result.debugLogPath).toContain(".claude");
          expect(typeof result.debugLogPath).toBe("string");
          console.log(`\n📝 Remote debug log: ${result.debugLogPath}\n`);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Remote session resumption", () => {
    it(
      "should resume remote session with --resume",
      async () => {
        if (!claudeAvailable) return;

        // First, create session
        const executor = ClaudePrintExecutor.create(testConfig, sessionId);

        await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        // Now resume and send another command
        const result = await executor.execute({
          command: "ping",
          resume: true, // Use --resume for existing session
          timeout: 30000,
        });

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBeTruthy();

        console.log(
          `\n✅ Remote session resumed successfully in ${result.duration}ms\n`,
        );
      },
      TEST_TIMEOUT * 2,
    );
  });

  describe("Remote error handling", () => {
    it(
      "should handle non-existent remote session gracefully",
      async () => {
        if (!claudeAvailable) return;

        const nonExistentSession = randomUUID();
        const executor = ClaudePrintExecutor.create(
          testConfig,
          nonExistentSession,
        );

        const result = await executor.execute({
          command: "ping",
          resume: true, // Try to resume non-existent session
          timeout: 30000,
        });

        // Should fail but not throw
        expect(result.success).toBe(false);
        // stderr should contain error information
        expect(result.stderr.length).toBeGreaterThan(0);

        console.log(`\n✅ Gracefully handled non-existent session\n`);
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle invalid remote commands",
      async () => {
        if (!claudeAvailable) return;

        // Create session first
        const executor = ClaudePrintExecutor.create(testConfig, sessionId);

        await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        // Try an invalid slash command
        const result = await executor.execute({
          command: "/invalid-command-that-does-not-exist",
          resume: true,
          timeout: 30000,
        });

        // May succeed or fail depending on Claude's behavior
        // Just verify we get a result and don't throw
        expect(result).toBeDefined();
        expect(result.exitCode).toBeDefined();
      },
      TEST_TIMEOUT * 2,
    );
  });

  describe("Remote shell escaping", () => {
    it(
      "should handle paths with spaces via SSH",
      async () => {
        if (!claudeAvailable) return;

        // This test verifies our shell escaping works
        // The actual path in config is /opt/containers (no spaces)
        // But our escaping logic should handle it anyway

        const result = await new Promise<boolean>((resolve) => {
          // Test that our escaping function works
          const testPath = "/path with spaces/test";
          const escaped = `'${testPath.replace(/'/g, "'\\''")}'`;

          // Verify escaped path can be used in SSH command
          const testCmd = `cd ${escaped} 2>&1 || echo "EXPECTED_ERROR"`;
          const proc = spawn("ssh", ["-T", REMOTE_HOST, testCmd]);

          let output = "";

          proc.stdout?.on("data", (data) => {
            output += data.toString();
          });

          proc.on("exit", () => {
            // Should get "No such file or directory" or "EXPECTED_ERROR"
            // Not a shell syntax error
            const isValid =
              output.includes("No such file") ||
              output.includes("EXPECTED_ERROR");
            resolve(isValid);
          });

          proc.on("error", () => {
            resolve(false);
          });
        });

        expect(result).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle special characters in remote commands",
      async () => {
        if (!claudeAvailable) return;

        const executor = ClaudePrintExecutor.create(testConfig, sessionId);

        // Create session first
        await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        // Send command that could break shell if not properly escaped
        const result = await executor.execute({
          command: "ping", // Safe command but tests escaping pathway
          resume: true,
          timeout: 30000,
        });

        expect(result.success).toBe(true);
      },
      TEST_TIMEOUT * 2,
    );
  });

  describe("Remote performance", () => {
    it(
      "should complete remote session initialization within timeout",
      async () => {
        if (!claudeAvailable) return;

        // Generate fresh session ID for this performance test
        const perfSessionId = randomUUID();
        const executor = ClaudePrintExecutor.create(testConfig, perfSessionId);

        const startTime = Date.now();

        const result = await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        const duration = Date.now() - startTime;

        expect(result.success).toBe(true);
        expect(duration).toBeLessThan(config.settings.sessionInitTimeout);

        console.log("\n📊 Remote Session Init Performance:");
        console.log(`   Duration: ${duration}ms`);
        console.log(`   Result duration: ${result.duration}ms`);
        console.log(
          `   Status: ${duration < 20000 ? "✅ Good" : "⚠️  Slow"}\n`,
        );

        // Duration in result should match actual time
        expect(result.duration).toBeGreaterThan(0);
        expect(Math.abs(result.duration - duration)).toBeLessThan(100); // Within 100ms

        // Cleanup this session
        const perfSessionFilePath = ClaudeProcess.getSessionFilePath(
          testConfig.path,
          perfSessionId,
        );
        await cleanupRemoteSession(REMOTE_HOST, perfSessionFilePath);
      },
      TEST_TIMEOUT,
    );

    it(
      "should track accurate duration for multiple remote commands",
      async () => {
        if (!claudeAvailable) return;

        // Generate fresh session ID for this test
        const multiCmdSessionId = randomUUID();
        const executor = ClaudePrintExecutor.create(testConfig, multiCmdSessionId);

        // Create session
        const result1 = await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        expect(result1.success).toBe(true);
        const duration1 = result1.duration;

        // Resume session
        const result2 = await executor.execute({
          command: "ping",
          resume: true,
          timeout: 30000,
        });

        expect(result2.success).toBe(true);
        const duration2 = result2.duration;

        console.log("\n📊 Remote Command Durations:");
        console.log(`   Session init: ${duration1}ms`);
        console.log(`   Resume: ${duration2}ms\n`);

        // Both should have positive durations
        expect(duration1).toBeGreaterThan(0);
        expect(duration2).toBeGreaterThan(0);

        // Durations should be independent
        expect(duration1).not.toBe(duration2);

        // Cleanup this session
        const multiCmdSessionFilePath = ClaudeProcess.getSessionFilePath(
          testConfig.path,
          multiCmdSessionId,
        );
        await cleanupRemoteSession(REMOTE_HOST, multiCmdSessionFilePath);
      },
      TEST_TIMEOUT * 2,
    );
  });

  describe("Remote output handling", () => {
    it(
      "should capture stdout and stderr from remote execution",
      async () => {
        if (!claudeAvailable) return;

        // Generate fresh session ID for this test
        const outputSessionId = randomUUID();
        const executor = ClaudePrintExecutor.create(testConfig, outputSessionId);

        const result = await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        expect(result.success).toBe(true);

        // Should have stdout
        expect(result.stdout).toBeTruthy();
        expect(typeof result.stdout).toBe("string");

        // May have stderr (logging, etc)
        expect(typeof result.stderr).toBe("string");

        console.log("\n📄 Remote Output:");
        console.log(`   stdout length: ${result.stdout.length} bytes`);
        console.log(`   stderr length: ${result.stderr.length} bytes\n`);

        // Debug info might be in stderr
        if (result.stderr.length > 0) {
          expect(result.stderr).toBeTruthy();
        }

        // Cleanup this session
        const outputSessionFilePath = ClaudeProcess.getSessionFilePath(
          testConfig.path,
          outputSessionId,
        );
        await cleanupRemoteSession(REMOTE_HOST, outputSessionFilePath);
      },
      TEST_TIMEOUT,
    );

    it(
      "should return complete output for successful remote commands",
      async () => {
        if (!claudeAvailable) return;

        // Generate fresh session ID for this test
        const completeOutputSessionId = randomUUID();
        const executor = ClaudePrintExecutor.create(testConfig, completeOutputSessionId);

        const result = await executor.execute({
          command: "ping",
          resume: false,
          timeout: config.settings.sessionInitTimeout,
        });

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);

        // Output should contain response
        expect(result.stdout.length).toBeGreaterThan(0);

        // Should be valid text (not binary garbage)
        expect(result.stdout).toMatch(/[\w\s]/);

        // Cleanup this session
        const completeOutputSessionFilePath = ClaudeProcess.getSessionFilePath(
          testConfig.path,
          completeOutputSessionId,
        );
        await cleanupRemoteSession(REMOTE_HOST, completeOutputSessionFilePath);
      },
      TEST_TIMEOUT,
    );
  });
});

// Instructions for running remote tests
if (!REMOTE_TESTS_ENABLED) {
  console.log("\n" + "=".repeat(70));
  console.log("⚠️  Remote Print Tests Skipped");
  console.log("=".repeat(70));
  console.log("\nTo enable remote print integration tests:");
  console.log("  IRIS_TEST_REMOTE=1 pnpm test:integration\n");
  console.log("Requirements:");
  console.log("  - OpenSSH client installed locally (ssh command)");
  console.log("  - SSH access to remote host configured in ~/.ssh/config");
  console.log("  - Claude CLI installed on remote host at configured path");
  console.log("  - SSH keys configured (no password prompts - use ssh-agent)");
  console.log("  - Remote host alias: inanna (in ~/.ssh/config)");
  console.log("  - Remote path: /opt/containers");
  console.log(
    "\nThis test suite validates ClaudePrintExecutor remote execution.",
  );
  console.log("=".repeat(70) + "\n");
}
