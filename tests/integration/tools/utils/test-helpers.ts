/**
 * Test utilities for MCP tools integration tests
 * Provides common setup, teardown, and configuration
 */

import { ClaudeProcessPool } from '../../../../src/process-pool/pool-manager.js';
import { TeamsConfigManager } from '../../../../src/config/teams-config.js';
import { NotificationQueue } from '../../../../src/notifications/queue.js';
import type { ProcessPoolConfig } from '../../../../src/process-pool/types.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

/**
 * Test fixture containing all dependencies for MCP tools
 */
export interface TestFixture {
  pool: ClaudeProcessPool;
  configManager: TeamsConfigManager;
  notificationQueue: NotificationQueue;
  configPath: string;
  dbPath: string;
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
export function createTestFixture(testName: string): TestFixture {
  const configPath = `./test-${testName}-teams.json`;
  const dbPath = `./test-${testName}-notifications.db`;

  // Write test config
  writeFileSync(configPath, JSON.stringify(DEFAULT_TEST_CONFIG, null, 2));

  // Create config manager
  const configManager = new TeamsConfigManager(configPath);
  configManager.load();

  // Create process pool
  const poolConfig: ProcessPoolConfig = {
    idleTimeout: 300000,
    maxProcesses: 5,
    healthCheckInterval: 30000,
  };
  const pool = new ClaudeProcessPool(configManager, poolConfig);

  // Create notification queue
  const notificationQueue = new NotificationQueue(dbPath);

  return {
    pool,
    configManager,
    notificationQueue,
    configPath,
    dbPath,
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

  // Clean up notification queue
  if (fixture.notificationQueue) {
    fixture.notificationQueue.close();
  }

  // Clean up files
  if (existsSync(fixture.configPath)) {
    unlinkSync(fixture.configPath);
  }
  if (existsSync(fixture.dbPath)) {
    unlinkSync(fixture.dbPath);
  }
}
