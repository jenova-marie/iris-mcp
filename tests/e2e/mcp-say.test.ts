/**
 * End-to-End Test: MCP say() function
 * Tests full communication flow with real Claude processes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { SessionManager } from "../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../src/config/teams-config.js";
import { ClaudeProcessPool } from "../../src/process-pool/pool-manager.js";
import { IrisOrchestrator } from "../../src/iris.js";
import { say } from "../../src/mcp/say.js";

describe("E2E: MCP say() communication", () => {
  let sessionManager: SessionManager;
  let configManager: TeamsConfigManager;
  let processPool: ClaudeProcessPool;
  let iris: IrisOrchestrator;

  const testConfigPath = "./test-e2e-mcp-say-teams.json";
  const testDbPath = "./test-e2e-mcp-say-sessions.db";

  // Minimal config with only 2 teams from real teams.json
  const testConfig = {
    settings: {
      idleTimeout: 300000,
      maxProcesses: 5,
      healthCheckInterval: 30000,
      sessionInitTimeout: 30000,
    },
    teams: {
      "team-alpha": {
        path: "/Users/jenova/projects/jenova-marie/iris-mcp/teams/team-alpha",
        description: "Iris MCP Team Alpha - points to a testing team",
        skipPermissions: true,
        color: "#4CAF50",
      },
      "team-beta": {
        path: "/Users/jenova/projects/jenova-marie/iris-mcp/teams/team-beta",
        description: "Iris MCP Team Beta - points to a testing team",
        skipPermissions: true,
        color: "#4CAAF0",
      },
    },
  };

  // Helper to clean database and session files
  const cleanDatabase = () => {
    [
      testDbPath,
      `${testDbPath}-shm`,
      `${testDbPath}-wal`,
      testConfigPath,
    ].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  beforeAll(async () => {
    cleanDatabase();

    // Write minimal test config (only 2 teams for speed)
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    // Initialize configuration
    configManager = new TeamsConfigManager(testConfigPath);
    const config = configManager.load();

    // Initialize session manager
    sessionManager = new SessionManager(config, testDbPath);
    await sessionManager.initialize();

    // Initialize process pool
    processPool = new ClaudeProcessPool(configManager, config.settings);

    // Initialize Iris orchestrator (BLL)
    iris = new IrisOrchestrator(sessionManager, processPool);
  }, 120000); // 2 minute timeout for initialization

  afterAll(async () => {
    if (processPool) {
      await processPool.terminateAll();
    }
    if (sessionManager) {
      sessionManager.close();
    }
    cleanDatabase();
  });

  it("should complete full conversation flow from team-alpha to team-beta", async () => {
    // Step 1: team-alpha sends initial greeting to team-beta
    console.log("\n[E2E Test] Step 1: team-alpha sending 'hi' to team-beta");
    const greeting = await say(
      {
        toTeam: "team-beta",
        message: "hi",
        fromTeam: "team-alpha",
        waitForResponse: true,
        timeout: 30000,
      },
      iris,
    );

    expect(greeting).toBeDefined();
    expect(greeting.response).toBeDefined();
    expect(greeting.async).toBe(false);
    console.log(`[E2E Test] Greeting response: ${greeting.response?.substring(0, 100)}...`);

    // Step 2: Wait 30 seconds
    console.log("\n[E2E Test] Step 2: Waiting 30 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 30000));
    console.log("[E2E Test] Wait complete");

    // Step 3: team-alpha asks team-beta for their name
    console.log("\n[E2E Test] Step 3: team-alpha asking 'what is your team name?'");
    const teamNameQuery = await say(
      {
        toTeam: "team-beta",
        message: "what is your team name?",
        fromTeam: "team-alpha",
        waitForResponse: true,
        timeout: 30000,
      },
      iris,
    );

    expect(teamNameQuery).toBeDefined();
    expect(teamNameQuery.response).toBeDefined();
    expect(teamNameQuery.response).toContain("team-beta");
    expect(teamNameQuery.async).toBe(false);
    console.log(`[E2E Test] Team name response: ${teamNameQuery.response}`);

    // Step 4: team-alpha sends goodbye to team-beta
    console.log("\n[E2E Test] Step 4: team-alpha saying goodbye");
    const goodbye = await say(
      {
        toTeam: "team-beta",
        message: "goodbye",
        fromTeam: "team-alpha",
        waitForResponse: true,
        timeout: 30000,
      },
      iris,
    );

    expect(goodbye).toBeDefined();
    expect(goodbye.response).toBeDefined();
    expect(goodbye.async).toBe(false);
    console.log(`[E2E Test] Goodbye response: ${goodbye.response}`);

    // Verify all messages were delivered successfully
    expect(greeting.duration).toBeGreaterThan(0);
    expect(teamNameQuery.duration).toBeGreaterThan(0);
    expect(goodbye.duration).toBeGreaterThan(0);

    console.log("\n[E2E Test] ✅ All conversation steps completed successfully");
  }, 180000); // 3 minute timeout for entire test
});
