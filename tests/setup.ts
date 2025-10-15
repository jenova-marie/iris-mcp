/**
 * Test setup and utilities
 * Ensures tests use isolated IRIS_HOME (tests/) with config.json and tests/data
 */

import { resolve } from "path";
import { existsSync, mkdirSync, rmSync, copyFileSync } from "fs";
import { beforeAll, afterAll } from "vitest";

// Test environment paths
export const TEST_IRIS_HOME = resolve(__dirname);
export const TEST_CONFIG_PATH = resolve(TEST_IRIS_HOME, "config.json");
export const TEST_DATA_DIR = resolve(TEST_IRIS_HOME, "data");
export const TEST_DB_PATH = resolve(TEST_DATA_DIR, "team-sessions.db");

/**
 * Ensure test data directory exists
 */
export function ensureTestDataDir(): void {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
}

/**
 * Clean test data directory (remove all files but keep directory)
 */
export function cleanTestDataDir(): void {
  if (existsSync(TEST_DATA_DIR)) {
    // Remove and recreate to clean
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
}

/**
 * Verify test environment is correctly configured
 */
export function verifyTestEnvironment(): void {
  // Verify IRIS_HOME points to tests directory
  if (process.env.IRIS_HOME !== TEST_IRIS_HOME) {
    throw new Error(
      `Test environment error: IRIS_HOME should be ${TEST_IRIS_HOME} but is ${process.env.IRIS_HOME}`,
    );
  }

  // Verify config.json exists
  if (!existsSync(TEST_CONFIG_PATH)) {
    throw new Error(
      `Test environment error: config.json not found at ${TEST_CONFIG_PATH}`,
    );
  }

  // Ensure data directory exists
  ensureTestDataDir();
}

/**
 * Global test setup
 * Run once before all tests
 */
beforeAll(() => {
  verifyTestEnvironment();
});

/**
 * Get test team configuration
 */
export function getTestIrisConfig() {
  return {
    settings: {
      idleTimeout: 300000,
      maxProcesses: 10,
      healthCheckInterval: 30000,
      sessionInitTimeout: 60000,
      httpPort: 1616,
      defaultTransport: "stdio" as const,
    },
    teams: {
      "team-alpha": {
        path: resolve(TEST_IRIS_HOME, "../teams/team-alpha"),
        description: "Iris MCP Team Alpha - testing team",
        skipPermissions: true,
        color: "#4CAF50",
      },
      "team-beta": {
        path: resolve(TEST_IRIS_HOME, "../teams/team-beta"),
        description: "Iris MCP Team Beta - testing team",
        skipPermissions: true,
        color: "#4CAAF0",
      },
    },
  };
}
