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
 * - SSH access to the remote host configured in tests/config.yaml
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
  let testSession: Awaited<
    ReturnType<typeof sessionManager.getOrCreateSession>
  > | null = null;

  const REMOTE_TEAM = "team-inanna";
  const REMOTE_HOST = "inanna"; // SSH config alias
  const FROM_TEAM = "team-iris";
  const TEST_TIMEOUT = 60000; // 60 seconds for SSH operations

  beforeAll(async () => {
    // Use test config (go up to tests/ directory)
    const configPath = path.join(__dirname, "../../config.yaml");
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

    it("should detect team as remote (using OpenSSH client)", () => {
      const teamConfig = configManager.getIrisConfig(REMOTE_TEAM);
      expect(teamConfig?.remote).toBeDefined();
      expect(teamConfig?.path).toBe("/opt/containers");
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

        logger.info(
          {
            remoteTeam: REMOTE_TEAM,
            fromTeam: FROM_TEAM,
            transport: "SSHTransport",
          },
          "Starting remote spawn test (OpenSSH client)",
        );

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

        logger.info(
          {
            teamName: process.teamName,
            isReady: process.getBasicMetrics().isReady,
          },
          "Remote spawn successful via OpenSSH",
        );

        // Get metrics
        const metrics = process.getBasicMetrics();
        expect(metrics.status).toBe("idle");
        expect(metrics.uptime).toBeGreaterThan(0);

        logger.info({ metrics }, "Remote process metrics");
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

        logger.info(, {
          message: "What is 2+2?",
        }, "Executing remote tell command");

        // Create CacheEntry for the tell operation
        const { CacheEntryImpl } = await import(
          "../../../src/cache/cache-entry.js"
        );
        const { CacheEntryType } = await import("../../../src/cache/types.js");
        const { firstValueFrom, filter, timeout } = await import("rxjs");

        const tellEntry = new CacheEntryImpl(
          CacheEntryType.TELL,
          "What is 2+2? Just give me the number.",
        );

        // Execute tell (non-blocking)
        process.executeTell(tellEntry);

        // Wait for result message via RxJS observable
        await firstValueFrom(
          tellEntry.messages$.pipe(
            filter((msg) => msg.type === "result"),
            timeout(45000),
          ),
        );

        logger.info("Remote tell completed successfully");

        // Check metrics updated
        const metrics = process.getBasicMetrics();
        expect(metrics.messagesProcessed).toBe(2); // spawn ping + tell
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

        // Import required types
        const { CacheEntryImpl } = await import(
          "../../../src/cache/cache-entry.js"
        );
        const { CacheEntryType } = await import("../../../src/cache/types.js");
        const { firstValueFrom, filter, timeout } = await import("rxjs");

        for (const message of messages) {
          logger.info({ message }, "Executing remote tell command");

          // Create CacheEntry for the tell operation
          const tellEntry = new CacheEntryImpl(CacheEntryType.TELL, message);

          // Execute tell (non-blocking)
          process.executeTell(tellEntry);

          // Wait for result message via RxJS observable
          await firstValueFrom(
            tellEntry.messages$.pipe(
              filter((msg) => msg.type === "result"),
              timeout(45000),
            ),
          );

          logger.info({ message }, "Message completed");
        }

        const metrics = process.getBasicMetrics();
        expect(metrics.messagesProcessed).toBeGreaterThanOrEqual(5); // spawn ping + 3 tells + previous test tell

        logger.info({
          totalMessages: metrics.messagesProcessed,
        }, "All sequential messages completed");
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
      expect(session?.sessionId).toBeDefined();
      expect(session?.fromTeam).toBe(FROM_TEAM);
      expect(session?.toTeam).toBe(REMOTE_TEAM);

      console.log("Session metrics:", {
        sessionId: session?.sessionId,
        fromTeam: session?.fromTeam,
        toTeam: session?.toTeam,
        createdAt: session?.createdAt.toISOString(),
        uptime: session?.createdAt
          ? `${((Date.now() - session.createdAt.getTime()) / 1000).toFixed(1)}s`
          : "unknown",
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

        logger.info({
          teamName: REMOTE_TEAM,
        }, "Starting remote process");

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

        // Terminate existing process first (if testSession exists)
        if (testSession) {
          const existingProcess = poolManager.getProcessBySessionId(
            testSession.sessionId,
          );
          if (existingProcess) {
            await existingProcess.terminate();
          }

          // Remove from pool to force fresh spawn
          poolManager["processes"].delete(`${FROM_TEAM}->${REMOTE_TEAM}`);
        }

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

        logger.info({
          spawnTime: `${spawnTime}ms`,
          baseline: "7000-15000ms expected for SSH",
        }, "Remote spawn performance");

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

        // Import required types
        const { CacheEntryImpl } = await import(
          "../../../src/cache/cache-entry.js"
        );
        const { CacheEntryType } = await import("../../../src/cache/types.js");
        const { firstValueFrom, filter, timeout } = await import("rxjs");

        // Warm up (first message is slower)
        const warmupEntry = new CacheEntryImpl(
          CacheEntryType.TELL,
          "Warm up message. Reply with OK.",
        );
        process.executeTell(warmupEntry);
        await firstValueFrom(
          warmupEntry.messages$.pipe(
            filter((msg) => msg.type === "result"),
            timeout(45000),
          ),
        );

        // Measure actual latency
        const startTime = Date.now();

        const tellEntry = new CacheEntryImpl(
          CacheEntryType.TELL,
          "What is 7+8? Just the number please.",
        );
        process.executeTell(tellEntry);
        await firstValueFrom(
          tellEntry.messages$.pipe(
            filter((msg) => msg.type === "result"),
            timeout(45000),
          ),
        );

        const latency = Date.now() - startTime;

        logger.info({
          latency: `${latency}ms`,
          baseline: "2000-5000ms expected",
        }, "Remote tell performance");

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
  console.log("\nThis test suite validates SSHTransport (OpenSSH client).");
  console.log("=".repeat(70) + "\n");
}
