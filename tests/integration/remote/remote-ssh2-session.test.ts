/**
 * Integration tests for Remote SSH Execution
 *
 * These tests require a real SSH connection to a remote host.
 * Set IRIS_TEST_REMOTE=1 to enable these tests.
 *
 * Requirements:
 * - SSH access to the remote host configured in tests/config.yaml
 * - Claude CLI installed on remote host
 * - SSH keys configured (no password prompts)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { SessionManager } from "../../../src/session/session-manager.js";
import { getChildLogger } from "../../../src/utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only run these tests if explicitly enabled
const REMOTE_TESTS_ENABLED = process.env.IRIS_TEST_REMOTE === "1";

const describeRemote = REMOTE_TESTS_ENABLED ? describe : describe.skip;

describeRemote.skip("Remote SSH Execution (Integration)", () => {
  let configManager: TeamsConfigManager;
  let poolManager: ClaudeProcessPool;
  let sessionManager: SessionManager;

  const REMOTE_TEAM = "team-inanna";
  const FROM_TEAM = "team-iris";
  const TEST_TIMEOUT = 60000; // 60 seconds for SSH operations

  beforeAll(async () => {
    // Use test config (go up to tests/ directory)
    const configPath = path.join(__dirname, "../../config.yaml");
    configManager = new TeamsConfigManager(configPath);
    configManager.load();
    const teamsConfig = configManager.getConfig();

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

    it("should detect team as remote", () => {
      const teamConfig = configManager.getIrisConfig(REMOTE_TEAM);
      expect(teamConfig?.remote).toBeDefined();
    });
  });

  describe("Remote Process Spawn", () => {
    it(
      "should spawn Claude process on remote host via SSH",
      async () => {
        const logger = getChildLogger("test:remote-spawn");

        logger.info("Starting remote spawn test", {
          remoteTeam: REMOTE_TEAM,
          fromTeam: FROM_TEAM,
        });

        // Wake the remote team (spawns SSH connection)
        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          FROM_TEAM,
        );

        expect(process).toBeDefined();
        expect(process.teamName).toBe(REMOTE_TEAM);

        // Check process is ready
        expect(process.isReady()).toBe(true);
        expect(process.isBusy()).toBe(false);

        logger.info("Remote spawn successful", {
          teamName: process.teamName,
          isReady: process.isReady(),
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
        const session = sessionManager.getSession(FROM_TEAM, REMOTE_TEAM);

        expect(session).toBeDefined();
        expect(session?.fromTeam).toBe(FROM_TEAM);
        expect(session?.toTeam).toBe(REMOTE_TEAM);
        expect(session?.status).toBe("active");

        console.log("Session created:", {
          fromTeam: session?.fromTeam,
          toTeam: session?.toTeam,
          sessionId: session?.sessionId,
          createdAt: session?.createdAt.toISOString(),
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe("Remote Message Execution", () => {
    it(
      "should execute simple tell command via SSH",
      async () => {
        const logger = getChildLogger("test:remote-tell");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          FROM_TEAM,
        );

        expect(process.isReady()).toBe(true);

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
      "should handle multiple sequential tell commands",
      async () => {
        const logger = getChildLogger("test:remote-sequential");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
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

  describe("Remote Process State", () => {
    it("should report correct process state", async () => {
      const process = await poolManager.getOrCreateProcess(
        REMOTE_TEAM,
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

  describe("Remote Process Cleanup", () => {
    it(
      "should terminate remote SSH connection gracefully",
      async () => {
        const logger = getChildLogger("test:remote-terminate");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          FROM_TEAM,
        );

        expect(process.isReady()).toBe(true);

        logger.info("Terminating remote process", {
          teamName: REMOTE_TEAM,
        });

        // Terminate
        await process.terminate();

        logger.info("Remote process terminated");

        // Check state
        expect(process.isReady()).toBe(false);
        expect(process.isBusy()).toBe(false);

        const metrics = process.getBasicMetrics();
        expect(metrics.status).toBe("stopped");
        expect(metrics.uptime).toBe(0);
      },
      TEST_TIMEOUT,
    );
  });

  describe("Performance Metrics", () => {
    it(
      "should measure remote spawn time",
      async () => {
        const logger = getChildLogger("test:remote-performance");

        // Terminate existing process first
        const existingProcess = poolManager.getProcess(REMOTE_TEAM, FROM_TEAM);
        if (existingProcess) {
          await existingProcess.terminate();
        }

        // Remove from pool to force fresh spawn
        poolManager["processes"].delete(`${FROM_TEAM}->${REMOTE_TEAM}`);

        // Measure spawn time
        const startTime = Date.now();
        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          FROM_TEAM,
        );
        const spawnTime = Date.now() - startTime;

        expect(process.isReady()).toBe(true);

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
      "should measure remote tell latency",
      async () => {
        const logger = getChildLogger("test:remote-latency");

        const process = await poolManager.getOrCreateProcess(
          REMOTE_TEAM,
          FROM_TEAM,
        );

        expect(process.isReady()).toBe(true);

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
  console.log("⚠️  Remote SSH Tests Skipped");
  console.log("=".repeat(70));
  console.log("\nTo enable remote SSH integration tests:");
  console.log("  IRIS_TEST_REMOTE=1 pnpm test:integration\n");
  console.log("Requirements:");
  console.log("  - SSH access to remote host configured in tests/config.yaml");
  console.log("  - Claude CLI installed on remote host");
  console.log("  - SSH keys configured (no password prompts)");
  console.log("  - Remote host: ssh inanna");
  console.log("  - Remote path: /opt/containers");
  console.log("=".repeat(70) + "\n");
}
