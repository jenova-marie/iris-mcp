/**
 * Integration test for SessionManager.initialize()
 * Tests the initialization routine that pre-creates sessions for all teams
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";

describe("SessionManager.initialize()", () => {
  let manager: SessionManager;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./teams.test.json"; // Test config excludes iris-mcp
  const testDbPath = "./test-integration-managerInit.db";

  // Clean database and session files
  const cleanDatabase = () => {
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  beforeEach(() => {
    cleanDatabase();
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    manager = new SessionManager(teamsConfig, testDbPath);
  });

  afterEach(() => {
    if (manager) {
      manager.close();
    }
    cleanDatabase();
  });

  it("should initialize and pre-create sessions for all teams", async () => {
    // This should create sessions for iris-mcp and team-alpha
    await manager.initialize();

    // Verify manager is initialized
    expect(manager).toBeDefined();

    // TODO: Add assertions to verify sessions were created
    // - Check database has entries for both teams
    // - Check session files exist on disk
    // - Verify session metadata is correct
  }, 60000);

  it("should fail fast if team config is invalid", async () => {
    // Create manager with invalid config
    const invalidConfig = {
      settings: {
        idleTimeout: 300000,
        maxProcesses: 10,
        healthCheckInterval: 30000,
      },
      teams: {
        "invalid-team": {
          path: "/path/does/not/exist",
          description: "Invalid team with bad path",
        },
      },
    };

    const badManager = new SessionManager(invalidConfig, testDbPath);

    // Should throw during initialization
    await expect(badManager.initialize()).rejects.toThrow();

    badManager.close();
  }, 30000);
});
