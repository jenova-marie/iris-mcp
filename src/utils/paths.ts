/**
 * Path Utilities - IRIS_HOME resolution and path management
 */

import { resolve } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";

/**
 * Get the IRIS_HOME directory path
 * Uses $IRIS_HOME environment variable or defaults to ~/.iris
 */
export function getIrisHome(): string {
  const irisHome = process.env.IRIS_HOME || resolve(homedir(), ".iris");
  return resolve(irisHome);
}

/**
 * Get the path to config.yaml configuration file
 * Located at $IRIS_HOME/config.yaml or ~/.iris/config.yaml
 * Also supports .yml extension
 */
export function getConfigPath(): string {
  const irisHome = getIrisHome();

  // Try .yaml first (preferred), then .yml
  const yamlPath = resolve(irisHome, "config.yaml");
  const ymlPath = resolve(irisHome, "config.yml");

  // If .yaml exists, use it
  if (existsSync(yamlPath)) {
    return yamlPath;
  }

  // If .yml exists, use it
  if (existsSync(ymlPath)) {
    return ymlPath;
  }

  // Default to .yaml (will be created on install)
  return yamlPath;
}

/**
 * Get the data directory path
 * Located at $IRIS_HOME/data or ~/.iris/data
 */
export function getDataDir(): string {
  return resolve(getIrisHome(), "data");
}

/**
 * Get the path to the session database
 * Located at $IRIS_HOME/data/team-sessions.db
 */
export function getSessionDbPath(): string {
  return resolve(getDataDir(), "team-sessions.db");
}

/**
 * Ensure IRIS_HOME directory structure exists
 * Creates ~/.iris and ~/.iris/data if they don't exist
 */
export function ensureIrisHome(): void {
  const irisHome = getIrisHome();
  const dataDir = getDataDir();

  if (!existsSync(irisHome)) {
    mkdirSync(irisHome, { recursive: true });
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}
