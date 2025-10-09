/**
 * Test utilities for MCP tools integration tests
 * Provides common setup, teardown, and configuration
 */

import { ClaudeProcessPool } from '../../../../src/process-pool/pool-manager.js';
import { TeamsConfigManager } from '../../../../src/config/teams-config.js';
import { NotificationQueue } from '../../../../src/notifications/queue.js';
import { SessionManager } from '../../../../src/session/session-manager.js';
import type { ProcessPoolConfig } from '../../../../src/process-pool/types.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

/**
 * Test fixture containing all dependencies for MCP tools
 */
export interface TestFixture {
  pool: ClaudeProcessPool;
  configManager: TeamsConfigManager;
  sessionManager: SessionManager;
  notificationQueue: NotificationQueue;
  configPath: string;
  dbPath: string;
  sessionDbPath: string;
}

/**
 * Default test configuration with multiple teams
 */
export const DEFAULT_TEST_CONFIG = {
  settings: {
    idleTimeout: 300000,
    maxProcesses: 5,
    healthCheckInterval: 30000,
  },
  teams: {
    'frontend': {
      path: process.cwd(),
      description: 'Frontend team',
      skipPermissions: true,
    },
    'backend': {
      path: process.cwd(),
      description: 'Backend team',
      skipPermissions: true,
    },
    'mobile': {
      path: process.cwd(),
      description: 'Mobile team',
      skipPermissions: true,
    },
  },
};

/**
 * Create test fixture with all dependencies
 */
export async function createTestFixture(testName: string): Promise<TestFixture> {
  const configPath = `./test-${testName}-teams.json`;
  const dbPath = `./test-${testName}-notifications.db`;
  const sessionDbPath = `./test-${testName}-sessions.db`;

  // Write test config
  writeFileSync(configPath, JSON.stringify(DEFAULT_TEST_CONFIG, null, 2));

  // Create config manager
  const configManager = new TeamsConfigManager(configPath);
  configManager.load();

  // Create session manager (with skipSessionFileInit = true for tests)
  const teamsConfig = configManager.getConfig();
  const sessionManager = new SessionManager(teamsConfig, sessionDbPath, true);

  // Initialize session manager before using it
  await sessionManager.initialize();

  // Create process pool
  const poolConfig: ProcessPoolConfig = {
    idleTimeout: 300000,
    maxProcesses: 5,
    healthCheckInterval: 30000,
  };
  const pool = new ClaudeProcessPool(configManager, poolConfig, sessionManager);

  // Create notification queue
  const notificationQueue = new NotificationQueue(dbPath);

  return {
    pool,
    configManager,
    sessionManager,
    notificationQueue,
    configPath,
    dbPath,
    sessionDbPath,
  };
}

/**
 * Clean up test fixture
 */
export async function cleanupTestFixture(fixture: TestFixture): Promise<void> {
  // Clean up pool
  if (fixture.pool) {
    await fixture.pool.terminateAll();
  }

  // Clean up session manager
  if (fixture.sessionManager) {
    fixture.sessionManager.close();
  }

  // Clean up notification queue
  if (fixture.notificationQueue) {
    fixture.notificationQueue.close();
  }

  // Small delay to ensure connections are fully closed
  await new Promise(resolve => setTimeout(resolve, 100));

  // Clean up files (including SQLite WAL files)
  const filesToClean = [
    fixture.configPath,
    fixture.dbPath,
    `${fixture.dbPath}-shm`,
    `${fixture.dbPath}-wal`,
    fixture.sessionDbPath,
    `${fixture.sessionDbPath}-shm`,
    `${fixture.sessionDbPath}-wal`,
  ];

  for (const file of filesToClean) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch (err) {
        // Ignore errors - file might be locked or already deleted
      }
    }
  }
}
