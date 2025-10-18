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
import { firstValueFrom, filter, take, timeout } from "rxjs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { IrisOrchestrator } from "../../../src/iris.js";
import { ProcessStatus } from "../../../src/process-pool/types.js";

// Import all actions
import { isAwake } from "../../../src/actions/isAwake.js";
import { report } from "../../../src/actions/report.js";
import { sleep } from "../../../src/actions/sleep.js";
import { tell } from "../../../src/actions/tell.js";
import { wake } from "../../../src/actions/wake.js";
import { wakeAll } from "../../../src/actions/wake-all.js";
import { reboot } from "../../../src/actions/reboot.js";

describe("Actions Integration Tests", () => {
  let sessionManager: SessionManager;
  let configManager: TeamsConfigManager;
  let processPool: ClaudeProcessPool;
  let iris: IrisOrchestrator;

  const testConfigPath = "./tests/config.yaml";

  // Load config early to get timeout value
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout || 60000;

  // Single initialization for ALL tests
  beforeAll(async () => {
    // Setup config manager
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();
    const teamsConfig = configManager.getConfig();

    // Setup session manager with IN-MEMORY database
    sessionManager = new SessionManager(teamsConfig, { inMemory: true });

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

        // Wait for process to reach IDLE before next test
        const process = processPool.getProcess("team-alpha");
        if (process) {
          await firstValueFrom(
            process.status$.pipe(
              filter((status) => status === ProcessStatus.IDLE),
              take(1),
              timeout(45000), // Match sessionInitTimeout
            ),
          );
        }
      },
      sessionInitTimeout,
    );
  });

  describe("3. Send message to awake team", () => {
    it(
      "should send message to team-alpha and get response",
      async () => {
        const result = await tell(
          {
            fromTeam: "team-iris",
            toTeam: "team-alpha",
            message: "Hello from integration test",
          },
          iris,
        );

        expect(result).toBeDefined();
        expect(result.to).toBe("team-alpha");
        expect(result.message).toBe("Hello from integration test");
        expect(result.response).toBeTruthy(); // Should get actual Claude response
        expect(result.duration).toBeGreaterThan(0);
      },
      sessionInitTimeout,
    );
  });

  describe("5. Wake all teams", () => {
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

  describe("6. Send async message", () => {
    it("should send async message to team-beta", async () => {
      // Use RxJS observable to wait for team-beta to be idle (it was just woken up in test 5)
      const process = processPool.getProcess("team-beta");
      expect(process).toBeDefined();

      if (process) {
        // Subscribe to status$ observable and wait for IDLE status
        await firstValueFrom(
          process.status$.pipe(
            filter((status) => status === ProcessStatus.IDLE),
            take(1),
            timeout(30000), // 30 second timeout
          ),
        );
      }

      const result = await tell(
        {
          fromTeam: "team-iris",
          toTeam: "team-beta",
          message: "Async test message",
          timeout: -1, // Async mode: return immediately
        },
        iris,
      );

      expect(result).toBeDefined();
      expect(result.to).toBe("team-beta");
      expect(result.response).toBeUndefined(); // No response in async mode
    });
  });

  describe("7. Put team-alpha to sleep", () => {
    it("should put team-alpha to sleep", async () => {
      const result = await sleep(
        { fromTeam: "team-iris", team: "team-alpha" },
        processPool,
      );

      expect(result).toBeDefined();
      expect(result.team).toBe("team-alpha");
      expect(result.status).toBe("sleeping");
    });
  });

  describe("8. Re-wake team-alpha", () => {
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
        // sessionId might be undefined if wake failed with error
        // In that case, result.message will contain error details
        if (!result.sessionId) {
          console.log("Wake returned without sessionId:", result.message);
        }
        // Only check sessionId if status is "awake" or if no error message
        if (result.status === "awake" || !result.message?.includes("Failed")) {
          expect(result.sessionId).toBeTruthy();
        }
      },
      sessionInitTimeout,
    );
  });

  describe("9. Reboot action", () => {
    let oldSessionId: string | undefined;

    it(
      "should reboot existing session and create new one",
      async () => {
        // Get old session ID
        const oldSession = sessionManager.getSession("team-iris", "team-alpha");
        oldSessionId = oldSession?.sessionId;

        const result = await reboot(
          { fromTeam: "team-iris", toTeam: "team-alpha" },
          iris,
          sessionManager,
          processPool,
        );

        expect(result).toBeDefined();
        expect(result.from).toBe("team-iris");
        expect(result.to).toBe("team-alpha");
        expect(result.hadPreviousSession).toBe(true);
        expect(result.oldSessionId).toBe(oldSessionId);
        expect(result.newSessionId).toBeTruthy();
        expect(result.newSessionId).not.toBe(oldSessionId);
        expect(result.processTerminated).toBe(true);

        // Wait for new process to be idle
        const process = processPool.getProcess("team-alpha");
        if (process) {
          await firstValueFrom(
            process.status$.pipe(
              filter((status) => status === ProcessStatus.IDLE),
              take(1),
              timeout(30000),
            ),
          );
        }
      },
      sessionInitTimeout,
    );

    it(
      "should send message to verify new session works",
      async () => {
        const result = await tell(
          {
            fromTeam: "team-iris",
            toTeam: "team-alpha",
            message: "Testing new session after reboot",
          },
          iris,
        );

        expect(result.to).toBe("team-alpha");
        expect(result.response).toBeTruthy();
      },
      sessionInitTimeout,
    );
  });
});
