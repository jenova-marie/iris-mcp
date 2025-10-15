/**
 * Integration tests for Remote SSH Execution (OpenSSH Client)
 *
 * These tests verify the SSHTransport implementation which uses
 * the local `ssh` command (OpenSSH) to execute Claude on a remote host.
 *
 * Set IRIS_TEST_REMOTE=1 to enable these tests.
 *
 * Requirements:
 * - OpenSSH client installed locally (ssh command available)
 * - SSH access to the remote host configured in tests/config.json
 * - SSH keys configured (no password prompts - use ssh-agent)
 * - Claude CLI installed on remote host at /opt/containers
 * - Remote host: ssh inanna (configured in ~/.ssh/config)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { SessionManager } from "../../../src/session/session-manager.js";
import { getChildLogger } from "../../../src/utils/logger.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only run these tests if explicitly enabled
const REMOTE_TESTS_ENABLED = process.env.IRIS_TEST_REMOTE === "1";

const describeRemote = REMOTE_TESTS_ENABLED ? describe : describe.skip;

/**
 * Check if Claude is installed on remote host at configured path
 * Verifies by running: ssh <host> "<claudePath> --version"
 * Expects output to contain "Claude Code"
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
      // Check if exit code is 0 AND output contains "Claude Code"
      const isValid = code === 0 && output.includes("Claude Code");
      resolve(isValid);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

describeRemote("Remote SSH Execution (OpenSSH Client)", () => {
  let configManager: TeamsConfigManager;
  let poolManager: ClaudeProcessPool;
  let sessionManager: SessionManager;
  let claudeAvailable = false;
  let testSession: Awaited<ReturnType<typeof sessionManager.getOrCreateSession>> | null = null;

  const REMOTE_TEAM = "team-inanna";
  const REMOTE_HOST = "inanna"; // SSH config alias
  const FROM_TEAM = "team-iris";
  const TEST_TIMEOUT = 60000; // 60 seconds for SSH operations

  beforeAll(async () => {
    // Use test config (go up to tests/ directory)
    const configPath = path.join(__dirname, "../../config.json");
    configManager = new TeamsConfigManager(configPath);
    configManager.load();
    const teamsConfig = configManager.getConfig();

    // Get claudePath from config
    const teamConfig = configManager.getIrisConfig(REMOTE_TEAM);
    const claudePath = teamConfig?.claudePath || "claude";

    // Check if Claude is available on remote host at configured path
    claudeAvailable = await checkRemoteClaude(REMOTE_HOST, claudePath);

    if (!claudeAvailable) {
      console.warn(
        `\n⚠️  Claude CLI not found on remote host '${REMOTE_HOST}'\n` +
          `   Checked path: ${claudePath}\n` +
          `   Some tests will be skipped. To run full test suite:\n` +
          `   1. Install Claude CLI on remote host\n` +
          `   2. Update claudePath in config if needed\n`,
      );
    } else {
      console.log(
        `\n✅ Claude CLI found on remote host '${REMOTE_HOST}' at ${claudePath}\n`,
      );
    }

    // Create session manager with in-memory database
    sessionManager = new SessionManager(teamsConfig, {
      path: ":memory:",
      inMemory: true,
    });

    // Initialize session manager
    await sessionManager.initialize();

    // Create pool manager
    poolManager = new ClaudeProcessPool(configManager, teamsConfig.settings);
  }, 120000);

  afterAll(async () => {
    // Clean up - terminate all processes
    if (poolManager) {
      await poolManager.terminateAll();
    }
    if (sessionManager) {
      sessionManager.close();
    }
  });

  describe("Remote Team Configuration", () => {
    it("should load remote team from config", () => {
      const teamConfig = configManager.getIrisConfig(REMOTE_TEAM);

      expect(teamConfig).toBeDefined();
      expect(teamConfig?.remote).toBe("ssh inanna");
      expect(teamConfig?.path).toBe("/opt/containers");
      expect(teamConfig?.description).toContain("cloud dev team");
    });

    it("should detect team as remote (not using ssh2)", () => {
      const teamConfig = configManager.getIrisConfig(REMOTE_TEAM);
      expect(teamConfig?.remote).toBeDefined();
      expect(teamConfig?.ssh2).toBeUndefined(); // Default to OpenSSH client
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

  describe("Remote Process Spawn (OpenSSH)", () => {
    it(
      "should spawn Claude process on remote host via OpenSSH",
      async () => {
        if (!claudeAvailable) {
          console.log("Skipping: Claude not installed on remote host");
          return;
        }

        const logger = getChildLogger("test:remote-spawn");

        logger.info("Starting remote spawn test (OpenSSH client)", {
          remoteTeam: REMOTE_TEAM,
          fromTeam: FROM_TEAM,
          transport: "SSHTransport",
        });

        // Wake the remote team (spawns SSH connection via OpenSSH client)
        // Get or create session for this team pair
        testSession = await sessionManager.getOrCreateSession(
          FROM_TEAM,
          REMOTE_TEAM,
        );

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          testSession.sessionId,
          FROM_TEAM,
        );

        expect(process).toBeDefined();
        expect(process.teamName).toBe(REMOTE_TEAM);

        // Check process is ready
        expect(process.getBasicMetrics().isReady).toBe(true);
        expect(process.getBasicMetrics().isBusy).toBe(false);

        logger.info("Remote spawn successful via OpenSSH", {
          teamName: process.teamName,
          isReady: process.getBasicMetrics().isReady,
        });

        // Get metrics
        const metrics = process.getBasicMetrics();
        expect(metrics.status).toBe("idle");
        expect(metrics.uptime).toBeGreaterThan(0);

        logger.info("Remote process metrics", { metrics });
      },
      TEST_TIMEOUT,
    );

    it(
      "should create session record for remote team",
      async () => {
        if (!claudeAvailable) return;

        const session = sessionManager.getSession(FROM_TEAM, REMOTE_TEAM);

        expect(session).toBeDefined();
        expect(session?.fromTeam).toBe(FROM_TEAM);
        expect(session?.toTeam).toBe(REMOTE_TEAM);
        expect(session?.status).toBe("active");

        console.log("Session created for OpenSSH transport:", {
          fromTeam: session?.fromTeam,
          toTeam: session?.toTeam,
          sessionId: session?.sessionId,
          createdAt: session?.createdAt.toISOString(),
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe("Remote Message Execution (OpenSSH)", () => {
    it(
      "should execute simple tell command via OpenSSH",
      async () => {
        if (!claudeAvailable) return;

        const logger = getChildLogger("test:remote-tell");

        if (!testSession) throw new Error("Test session not initialized");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          testSession.sessionId,
          FROM_TEAM,
        );

        expect(process.getBasicMetrics().isReady).toBe(true);

        logger.info("Executing remote tell command", {
          message: "What is 2+2?",
        });

        // Execute a simple math question
        const tellPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Tell operation timeout"));
          }, 45000);

          // Listen for completion
          poolManager.once("message-response", (data) => {
            clearTimeout(timeout);
            logger.info("Received remote response", {
              teamName: data.teamName,
              success: data.success,
            });
            resolve();
          });

          // Send message
          process.tell("What is 2+2? Just give me the number.");
        });

        await tellPromise;

        logger.info("Remote tell completed successfully");

        // Check metrics updated
        const metrics = process.getBasicMetrics();
        expect(metrics.messagesProcessed).toBe(1);
        expect(metrics.lastActivity).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle multiple sequential tell commands via OpenSSH",
      async () => {
        if (!claudeAvailable) return;

        const logger = getChildLogger("test:remote-sequential");

        if (!testSession) throw new Error("Test session not initialized");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          testSession.sessionId,
          FROM_TEAM,
        );

        const messages = ["What is 1+1?", "What is 3+3?", "What is 5+5?"];

        for (const message of messages) {
          logger.info("Sending message", { message });

          const tellPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Timeout for: ${message}`));
            }, 45000);

            poolManager.once("message-response", () => {
              clearTimeout(timeout);
              resolve();
            });

            process.tell(message);
          });

          await tellPromise;
          logger.info("Message completed", { message });
        }

        const metrics = process.getBasicMetrics();
        expect(metrics.messagesProcessed).toBeGreaterThanOrEqual(3);

        logger.info("All sequential messages completed", {
          totalMessages: metrics.messagesProcessed,
        });
      },
      TEST_TIMEOUT * 3,
    );
  });

  describe("Remote Process State (OpenSSH)", () => {
    it("should report correct process state", async () => {
      if (!claudeAvailable) return;

      if (!testSession) throw new Error("Test session not initialized");

      const process = await poolManager.getOrCreateProcess(
        REMOTE_TEAM,
        testSession.sessionId,
        FROM_TEAM,
      );

      const metrics = process.getBasicMetrics();

      expect(metrics.teamName).toBe(REMOTE_TEAM);
      expect(metrics.status).toMatch(/^(idle|processing)$/);
      expect(metrics.isReady).toBe(true);
      expect(metrics.uptime).toBeGreaterThan(0);

      console.log("Remote process state:", {
        status: metrics.status,
        uptime: `${(metrics.uptime / 1000).toFixed(1)}s`,
        messagesProcessed: metrics.messagesProcessed,
        isReady: metrics.isReady,
        isBusy: metrics.isBusy,
      });
    });

    it("should track session metrics", () => {
      if (!claudeAvailable) return;

      const session = sessionManager.getSession(FROM_TEAM, REMOTE_TEAM);

      expect(session).toBeDefined();
      expect(session?.messageCount).toBeGreaterThan(0);

      console.log("Session metrics:", {
        messageCount: session?.messageCount,
        lastUsed: session?.lastUsedAt.toISOString(),
        uptime: `${((Date.now() - session?.createdAt.getTime()) / 1000).toFixed(1)}s`,
      });
    });
  });

  describe("Remote Process Cleanup (OpenSSH)", () => {
    it(
      "should terminate remote SSH connection gracefully",
      async () => {
        if (!claudeAvailable) return;

        const logger = getChildLogger("test:remote-terminate");

        if (!testSession) throw new Error("Test session not initialized");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          testSession.sessionId,
          FROM_TEAM,
        );

        expect(process.getBasicMetrics().isReady).toBe(true);

        logger.info("Terminating remote process", {
          teamName: REMOTE_TEAM,
        });

        // Terminate
        await process.terminate();

        logger.info("Remote process terminated");

        // Check state
        expect(process.getBasicMetrics().isReady).toBe(false);
        expect(process.getBasicMetrics().isBusy).toBe(false);

        const metrics = process.getBasicMetrics();
        expect(metrics.status).toBe("stopped");
        expect(metrics.uptime).toBe(0);
      },
      TEST_TIMEOUT,
    );
  });

  describe("Performance Metrics (OpenSSH)", () => {
    it(
      "should measure remote spawn time via OpenSSH",
      async () => {
        if (!claudeAvailable) return;

        const logger = getChildLogger("test:remote-performance");

        // Terminate existing process first
        const existingProcess = poolManager.getProcess(REMOTE_TEAM, FROM_TEAM);
        if (existingProcess) {
          await existingProcess.terminate();
        }

        // Remove from pool to force fresh spawn
        poolManager["processes"].delete(`${FROM_TEAM}->${REMOTE_TEAM}`);

        // Create new session for fresh spawn
        const perfSession = await sessionManager.getOrCreateSession(
          FROM_TEAM,
          REMOTE_TEAM,
        );

        // Measure spawn time
        const startTime = Date.now();
        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          perfSession.sessionId,
          FROM_TEAM,
        );
        const spawnTime = Date.now() - startTime;

        expect(process.getBasicMetrics().isReady).toBe(true);

        logger.info("Remote spawn performance", {
          spawnTime: `${spawnTime}ms`,
          baseline: "7000-15000ms expected for SSH",
        });

        console.log("\n📊 Remote Spawn Performance:");
        console.log(`   Spawn Time: ${spawnTime}ms`);
        console.log(`   Status: ${spawnTime < 20000 ? "✅ Good" : "⚠️  Slow"}`);
        console.log(`   Baseline: 7-15s expected for remote spawn via SSH\n`);

        // Spawn time should be reasonable (< 20s)
        expect(spawnTime).toBeLessThan(20000);
      },
      TEST_TIMEOUT,
    );

    it(
      "should measure remote tell latency via OpenSSH",
      async () => {
        if (!claudeAvailable) return;

        const logger = getChildLogger("test:remote-latency");

        if (!testSession) throw new Error("Test session not initialized");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          testSession.sessionId,
          FROM_TEAM,
        );

        expect(process.getBasicMetrics().isReady).toBe(true);

        // Warm up (first message is slower)
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Warmup timeout")),
            45000,
          );
          poolManager.once("message-response", () => {
            clearTimeout(timeout);
            resolve();
          });
          process.tell("Warm up message. Reply with OK.");
        });

        // Measure actual latency
        const startTime = Date.now();

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Tell timeout")),
            45000,
          );
          poolManager.once("message-response", () => {
            clearTimeout(timeout);
            resolve();
          });
          process.tell("What is 7+8? Just the number please.");
        });

        const latency = Date.now() - startTime;

        logger.info("Remote tell performance", {
          latency: `${latency}ms`,
          baseline: "2000-5000ms expected",
        });

        console.log("\n📊 Remote Tell Latency:");
        console.log(`   Latency: ${latency}ms`);
        console.log(`   Status: ${latency < 10000 ? "✅ Good" : "⚠️  Slow"}`);
        console.log(`   Baseline: 2-5s expected for remote execution\n`);

        // Latency should be reasonable (< 10s)
        expect(latency).toBeLessThan(10000);
      },
      TEST_TIMEOUT * 2,
    );
  });
});

// Instructions for running remote tests
if (!REMOTE_TESTS_ENABLED) {
  console.log("\n" + "=".repeat(70));
  console.log("⚠️  Remote SSH Tests Skipped (OpenSSH Client)");
  console.log("=".repeat(70));
  console.log("\nTo enable remote SSH integration tests:");
  console.log("  IRIS_TEST_REMOTE=1 pnpm test:integration\n");
  console.log("Requirements:");
  console.log("  - OpenSSH client installed locally (ssh command)");
  console.log("  - SSH access to remote host configured in ~/.ssh/config");
  console.log("  - Claude CLI installed on remote host at /opt/containers");
  console.log("  - SSH keys configured (no password prompts - use ssh-agent)");
  console.log("  - Remote host alias: inanna (in ~/.ssh/config)");
  console.log("  - Remote path: /opt/containers");
  console.log("\nThis test suite validates SSHTransport (default).");
  console.log("For ssh2 library tests, set ssh2: true in team config.");
  console.log("=".repeat(70) + "\n");
}
