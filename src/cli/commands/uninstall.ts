/**
 * Uninstall Command
 * Removes Iris MCP server from Claude's configurations
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { homedir, platform } from "os";
import { getChildLogger } from "../../utils/logger.js";

const logger = getChildLogger("cli:uninstall");

export interface UninstallOptions {
  desktop?: boolean;
  cli?: boolean;
}

/**
 * Get Claude Desktop config path based on OS
 */
function getClaudeDesktopConfigPath(): string {
  const plat = platform();

  switch (plat) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "linux":
      return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
    case "win32":
      const appData = process.env.APPDATA;
      if (!appData) {
        throw new Error("APPDATA environment variable not found on Windows");
      }
      return join(appData, "Claude", "claude_desktop_config.json");
    default:
      throw new Error(`Unsupported platform: ${plat}`);
  }
}

/**
 * Uninstall Iris from a specific config file
 */
function uninstallFromConfig(configPath: string, configType: string): boolean {
  if (!existsSync(configPath)) {
    logger.info(`${configType} configuration not found: ${configPath}`);
    return false;
  }

  let config: any;
  try {
    const content = readFileSync(configPath, "utf-8");
    config = JSON.parse(content);
  } catch (error) {
    logger.error({ err: error instanceof Error ? error : new Error(String(error)) }, `Failed to read ${configType} configuration`);
    return false;
  }

  // Check if iris is installed
  if (!config.mcpServers?.iris) {
    logger.info(`Iris MCP not found in ${configType} configuration`);
    return false;
  }

  // Create backup before modifying
  try {
    const backupPath = `${configPath}.bak`;
    copyFileSync(configPath, backupPath);
    logger.info(`📦 Created backup: ${backupPath}`);
  } catch (error) {
    logger.warn(`Failed to create backup: ${error}`);
    // Continue anyway
  }

  // Remove iris entry
  delete config.mcpServers.iris;

  // Write updated config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    logger.info(`✅ Removed Iris MCP from ${configType} configuration`);
    logger.info(`   Config file: ${configPath}`);
    return true;
  } catch (error) {
    logger.error({ err: error instanceof Error ? error : new Error(String(error)) }, `Failed to write ${configType} configuration`);
    return false;
  }
}

export async function uninstall(options: UninstallOptions): Promise<void> {
  const cliConfigPath = join(homedir(), ".claude.json");
  // const desktopConfigPath = getClaudeDesktopConfigPath(); // DISABLED: Desktop support disabled

  // DISABLED: Desktop support - only uninstall from CLI config
  const uninstallCli = true; // Always uninstall from CLI
  // const uninstallDesktop = options.desktop || (!options.desktop && !options.cli); // DISABLED

  let cliRemoved = false;
  // let desktopRemoved = false; // DISABLED

  logger.info("🗑️  Uninstalling Iris MCP from Claude CLI...\n");

  if (uninstallCli) {
    logger.info("Checking Claude CLI configuration...");
    cliRemoved = uninstallFromConfig(cliConfigPath, "Claude CLI");
    console.error(""); // blank line
  }

  // DISABLED: Desktop support
  // if (uninstallDesktop) {
  //   logger.info("Checking Claude Desktop configuration...");
  //   desktopRemoved = uninstallFromConfig(desktopConfigPath, "Claude Desktop");
  //   console.error(""); // blank line
  // }

  // Summary
  if (cliRemoved) {
    logger.info("✅ Successfully removed Iris MCP from Claude CLI configuration");
    logger.info("\n💡 To reinstall:");
    logger.info("   iris install");
  } else {
    logger.info("ℹ️  Iris MCP was not installed in Claude CLI configuration");
  }
}
