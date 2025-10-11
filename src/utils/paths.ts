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
 * Get the path to config.json configuration file
 * Located at $IRIS_HOME/config.json or ~/.iris/config.json
 */
export function getConfigPath(): string {
  return resolve(getIrisHome(), "config.json");
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
