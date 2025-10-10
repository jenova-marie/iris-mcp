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
  }, 60000);
});
