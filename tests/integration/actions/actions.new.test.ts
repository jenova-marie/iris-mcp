/**
 * Integration tests for all actions in src/actions/
 * Tests core functionality with real processes - KISS approach
 *
 * NOTE: Tests are interdependent for performance reasons.
 * They build on each other's state to avoid repeatedly spawning processes.
 *
 * NEW ARCHITECTURE CHANGES:
 * - All actions require fromTeam parameter
 * - isAwake needs fromTeam to identify sessions
 * - wake/tell/wakeAll all need fromTeam parameter
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { IrisOrchestrator } from "../../../src/iris.js";

// Import all actions
import { isAwake } from "../../../src/actions/isAwake.js";
import { report } from "../../../src/actions/report.js";
import { sleep } from "../../../src/actions/sleep.js";
import { tell } from "../../../src/actions/tell.js";
import { wake } from "../../../src/actions/wake.js";
import { wakeAll } from "../../../src/actions/wake-all.js";
import { command } from "../../../src/actions/command.js";

describe("Actions Integration Tests (New Architecture)", () => {
  let sessionManager: SessionManager;
  let configManager: TeamsConfigManager;
  let processPool: ClaudeProcessPool;
  let iris: IrisOrchestrator;

  const testConfigPath = "./tests/config.json";
  const testDbPath = "./tests/data/test-integration-actions.db";

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout || 60000;

  // Check for REUSE_DB env var to skip database cleanup (faster iteration during development)
  // Usage: REUSE_DB=1 pnpm test:run tests/integration/actions/actions.test.ts
  const reuseDb =
    process.env.REUSE_DB === "1" || process.env.REUSE_DB === "true";

  // Helper to clean database files
  const cleanDatabase = () => {
    if (reuseDb) {
      console.log("⚡ Reusing existing database (REUSE_DB=1)");
      return;
    }
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  // Single initialization for ALL tests
  beforeAll(async () => {
    cleanDatabase(); // Start with clean DB (or reuse existing)

    // Setup config manager
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();
    const teamsConfig = configManager.getConfig();

    // Setup session manager
    sessionManager = new SessionManager(teamsConfig, testDbPath);

    // Setup process pool
    processPool = new ClaudeProcessPool(configManager, teamsConfig.settings);

    // Setup Iris orchestrator
    iris = new IrisOrchestrator(sessionManager, processPool, teamsConfig);

    // Initialize session manager
    try {
      await sessionManager.initialize();
    } catch (error) {
      console.error("Partial initialization failure:", error);
    }
  }, 120000); // 2 minute timeout

  afterAll(async () => {
    // Cleanup
    if (processPool) {
      await processPool.terminateAll();
    }
    if (sessionManager) {
      sessionManager.close();
    }
    cleanDatabase();
  });

  // IMPORTANT: These tests are interdependent!
  // They build on previous test state to avoid re-spawning processes

  describe("1. Initial status check", () => {
    it("should show all teams as asleep initially", async () => {
      const result = await isAwake(
        { fromTeam: "team-iris" },
        iris,
        processPool,
        configManager,
        sessionManager,
      );

      expect(result).toBeDefined();
      expect(result.teams).toBeDefined();

      // All teams should be asleep initially
      result.teams.forEach((team) => {
        expect(team.status).toBe("asleep");
      });

      expect(result.pool.activeProcesses).toBe(0);
    });
  });

  describe("2. Wake team-alpha", () => {
    it(
      "should wake up team-alpha",
      async () => {
        const result = await wake(
          { team: "team-alpha", fromTeam: "team-iris" },
          iris,
          processPool,
          sessionManager,
        );

        expect(result).toBeDefined();
        expect(result.team).toBe("team-alpha");
        expect(result.status).toMatch(/awake|waking/);
        expect(result.sessionId).toBeTruthy();
      },
      sessionInitTimeout,
    );
  });

  describe("3. Verify team-alpha is awake", () => {
    it("should confirm team-alpha is now awake", async () => {
      // Poll until process is truly idle (not just spawned)
      // The wake operation sends an initial ping, so we need to wait for it to complete
      const maxWaitTime = 30000; // 30 seconds max
      const pollInterval = 500; // Check every 500ms
      const startTime = Date.now();

      let isIdle = false;
      while (Date.now() - startTime < maxWaitTime) {
        const process = processPool.getProcess("team-alpha");
        if (process) {
          const metrics = process.getBasicMetrics();
          if (metrics.status === "idle") {
            isIdle = true;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      expect(isIdle).toBe(true); // Process should be idle by now

      const result = await isAwake(
        { fromTeam: "team-iris", team: "team-alpha" },
        iris,
        processPool,
        configManager,
        sessionManager,
      );

      expect(result.teams[0].name).toBe("team-alpha");
      expect(result.teams[0].status).toBe("awake");
      expect(result.teams[0].pid).toBeTruthy();
      expect(result.pool.activeProcesses).toBeGreaterThan(0);
    });
  });

  describe("4. Send message to awake team", () => {
    it(
      "should send message to team-alpha and get response",
      async () => {
        const result = await tell(
          {
            fromTeam: "team-iris",
            toTeam: "team-alpha",
            message: "Hello from integration test",
            waitForResponse: true,
          },
          iris,
        );

        expect(result).toBeDefined();
        expect(result.to).toBe("team-alpha");
        expect(result.message).toBe("Hello from integration test");
        expect(result.async).toBe(false);
        expect(result.response).toBeTruthy(); // Should get actual Claude response
        expect(result.duration).toBeGreaterThan(0);
      },
      sessionInitTimeout,
    );
  });

  describe.skip("5. Report at team output - DEPRECATED: caching disabled in new architecture", () => {
    it("should see output from previous message", async () => {
      // NOTE: The report action is now a stub that returns empty data
      // because output caching has been disabled in the new "dumb pipe" architecture.
      // All responses are streamed directly, not cached.
      const result = await report(
        { fromTeam: "team-iris", team: "team-alpha" },
        processPool,
      );

      expect(result).toBeDefined();
      expect(result.team).toBe("team-alpha");
      // Caching disabled - these will be empty/false
      expect(result.hasProcess).toBe(false);
      expect(result.totalBytes).toBe(0);
    });
  });

  describe("6. Wake all teams", () => {
    it(
      "should wake all configured teams",
      async () => {
        const result = await wakeAll(
          { fromTeam: "team-iris", parallel: false }, // Sequential for reliability
          iris,
          processPool,
          sessionManager,
        );

        expect(result).toBeDefined();
        expect(result.summary.total).toBeGreaterThan(0);

        // team-alpha should already be awake
        const alphaTeam = result.teams.find((t) => t.team === "team-alpha");
        expect(alphaTeam?.status).toBe("awake");

        // Other teams should be waking
        const wakingTeams = result.teams.filter((t) => t.status === "waking");
        expect(wakingTeams.length).toBeGreaterThan(0);
      },
      sessionInitTimeout * 2,
    );
  });

  describe("7. All teams should be awake", () => {
    it("should show multiple teams awake", async () => {
      const result = await isAwake(
        { fromTeam: "team-iris" },
        iris,
        processPool,
        configManager,
        sessionManager,
      );

      const awakeTeams = result.teams.filter((t) => t.status === "awake");
      expect(awakeTeams.length).toBeGreaterThan(1); // At least 2 teams awake
      expect(result.pool.activeProcesses).toBeGreaterThan(1);
    });
  });

  describe("8. Send async message", () => {
    it("should send async message to team-beta", async () => {
      const result = await tell(
        {
          fromTeam: "team-iris",
          toTeam: "team-beta",
          message: "Async test message",
          waitForResponse: false,
        },
        iris,
      );

      expect(result).toBeDefined();
      expect(result.to).toBe("team-beta");
      expect(result.async).toBe(true);
      expect(result.response).toBeUndefined(); // No response in async mode
    });
  });

  describe.skip("9. Test command action - compact (sync)", () => {
    it(
      "should send /compact command synchronously",
      async () => {
        const result = await command(
          {
            team: "team-alpha",
            command: "compact",
            waitForResponse: true,
            timeout: 15000,
          },
          iris,
        );

        expect(result).toBeDefined();
        expect(result.team).toBe("team-alpha");
        expect(result.command).toBe("/compact");
        expect(result.success).toBe(true);
        expect(result.response).toBeTruthy();
      },
      sessionInitTimeout,
    );
  });

  describe.skip("10. Test command action - compact (async)", () => {
    it("should send /compact command asynchronously", async () => {
      const result = await command(
        {
          team: "team-beta",
          command: "compact",
          waitForResponse: false,
        },
        iris,
      );

      expect(result).toBeDefined();
      expect(result.team).toBe("team-beta");
      expect(result.command).toBe("/compact");
      expect(result.success).toBe(true);
      expect(result.async).toBe(true);
      expect(result.response).toBeUndefined();
    });

    // Wait a bit for async compact to process
    it("should wait for async compact to process", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check that team-beta is still running after compact
      const status = await isAwake(
        { fromTeam: "team-iris", team: "team-beta" },
        iris,
        processPool,
        configManager,
        sessionManager,
      );

      expect(status.teams[0].status).toBe("awake");
    });
  });

  describe.skip("11. Test command action - unsupported command", () => {
    it("should return 'not implemented' for unsupported commands", async () => {
      const result = await command(
        {
          team: "team-alpha",
          command: "help",
          waitForResponse: true,
        },
        iris,
      );

      expect(result).toBeDefined();
      expect(result.team).toBe("team-alpha");
      expect(result.command).toBe("/help");
      expect(result.success).toBe(false);
      expect(result.response).toContain("not implemented");
      expect(result.response).toContain("Only /compact is currently supported");
    });
  });

  describe("12. Put team-alpha to sleep", () => {
    it("should put team-alpha to sleep", async () => {
      const result = await sleep(
        { fromTeam: "team-iris", team: "team-alpha" },
        processPool,
      );

      expect(result).toBeDefined();
      expect(result.team).toBe("team-alpha");
      expect(result.status).toBe("sleeping");
      expect(result.pid).toBeTruthy(); // Should have the PID that was terminated
    });
  });

  describe("13. Verify team-alpha is asleep", () => {
    it("should confirm team-alpha is now asleep", async () => {
      const result = await isAwake(
        { fromTeam: "team-iris", team: "team-alpha" },
        iris,
        processPool,
        configManager,
        sessionManager,
      );

      expect(result.teams[0].name).toBe("team-alpha");
      expect(result.teams[0].status).toBe("asleep");
      expect(result.teams[0].pid).toBeUndefined();
    });
  });

  describe("14. Re-wake team-alpha", () => {
    it(
      "should wake team-alpha again",
      async () => {
        const result = await wake(
          { team: "team-alpha", fromTeam: "team-iris" },
          iris,
          processPool,
          sessionManager,
        );

        expect(result.team).toBe("team-alpha");
        expect(result.status).toMatch(/awake|waking/);
        expect(result.sessionId).toBeTruthy();
      },
      sessionInitTimeout,
    );
  });

  describe("15. Final status check", () => {
    it("should show final state of all teams", async () => {
      const result = await isAwake(
        { fromTeam: "team-iris" },
        iris,
        processPool,
        configManager,
        sessionManager,
      );

      console.log("Final state summary:");
      console.log(`  Active processes: ${result.pool.activeProcesses}`);
      console.log(`  Total messages: ${result.pool.totalMessages}`);

      result.teams.forEach((team) => {
        console.log(
          `  ${team.name}: ${team.status} ${team.pid ? `(PID: ${team.pid})` : ""}`,
        );
      });

      expect(result.pool.activeProcesses).toBeGreaterThan(0);
    });
  });
});
