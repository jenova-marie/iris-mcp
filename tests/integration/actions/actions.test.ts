/**
 * Integration tests for all actions in src/actions/
 * Tests core functionality with real processes - KISS approach
 *
 * NOTE: Tests are interdependent for performance reasons.
 * They build on each other's state to avoid repeatedly spawning processes.
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

describe("Actions Integration Tests", () => {
  let sessionManager: SessionManager;
  let configManager: TeamsConfigManager;
  let processPool: ClaudeProcessPool;
  let iris: IrisOrchestrator;

  const testConfigPath = "./tests/teams.test.json";
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
    iris = new IrisOrchestrator(sessionManager, processPool);

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
      const result = await isAwake({}, iris, processPool, configManager);

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
          { team: "team-alpha" },
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
      const result = await isAwake(
        { team: "team-alpha" },
        iris,
        processPool,
        configManager,
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

  describe("5. Report at team output", () => {
    it("should see output from previous message", async () => {
      const result = await report({ team: "team-alpha" }, processPool);

      expect(result).toBeDefined();
      expect(result.team).toBe("team-alpha");
      expect(result.hasProcess).toBe(true);
      // Should have some output from the previous tell
      expect(result.totalBytes).toBeGreaterThan(0);
    });
  });

  describe("6. Wake all teams", () => {
    it(
      "should wake all configured teams",
      async () => {
        const result = await wakeAll(
          { parallel: false }, // Sequential for reliability
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
      const result = await isAwake({}, iris, processPool, configManager);

      const awakeTeams = result.teams.filter((t) => t.status === "awake");
      expect(awakeTeams.length).toBeGreaterThan(1); // At least 2 teams awake
      expect(result.pool.activeProcesses).toBeGreaterThan(1);
    });
  });

  describe("8. Send async message", () => {
    it("should send async message to team-beta", async () => {
      const result = await tell(
        {
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

  describe("9. Put team-alpha to sleep", () => {
    it("should put team-alpha to sleep", async () => {
      const result = await sleep({ team: "team-alpha" }, processPool);

      expect(result).toBeDefined();
      expect(result.team).toBe("team-alpha");
      expect(result.status).toBe("sleeping");
      expect(result.pid).toBeTruthy(); // Should have the PID that was terminated
    });
  });

  describe("10. Verify team-alpha is asleep", () => {
    it("should confirm team-alpha is now asleep", async () => {
      const result = await isAwake(
        { team: "team-alpha" },
        iris,
        processPool,
        configManager,
      );

      expect(result.teams[0].name).toBe("team-alpha");
      expect(result.teams[0].status).toBe("asleep");
      expect(result.teams[0].pid).toBeUndefined();
    });
  });

  describe("11. Re-wake team-alpha", () => {
    it(
      "should wake team-alpha again",
      async () => {
        const result = await wake(
          { team: "team-alpha", clearCache: false }, // Keep any previous cache
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

  describe("12. Final status check", () => {
    it("should show final state of all teams", async () => {
      const result = await isAwake({}, iris, processPool, configManager);

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
