/**
 * Integration test for createSession()
 * Tests a single valid session creation in a clean environment
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/teams-config.js";

describe("createSession Integration", () => {
  let manager: SessionManager;
  let configManager: TeamsConfigManager;
  const testConfigPath = "./teams.test.json"; // Test config excludes iris-mcp
  const testDbPath = "./test-integration-createSession.db";

  // Clean database and session files
  const cleanDatabase = () => {
    [testDbPath, `${testDbPath}-shm`, `${testDbPath}-wal`].forEach((file) => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    });
  };

  beforeEach(async () => {
    cleanDatabase(); // Virgin clean environment
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();

    const teamsConfig = configManager.getConfig();
    manager = new SessionManager(teamsConfig, testDbPath);

    // If initialize fails, the test precondition is invalid - fail fast
    await manager.initialize();
  }, 60000);

  afterEach(() => {
    if (manager) {
      manager.close();
    }
    cleanDatabase();
  });

  it("should create a valid session", async () => {
    const session = await manager.createSession("team-alpha", "team-beta");

    expect(session).toBeDefined();
    expect(session.fromTeam).toBe("team-alpha");
    expect(session.toTeam).toBe("team-beta");
    expect(session.sessionId).toBeTruthy();
    expect(session.status).toBe("active");
    expect(session.messageCount).toBe(0);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.lastUsedAt).toBeInstanceOf(Date);
  }, 30000);
});
