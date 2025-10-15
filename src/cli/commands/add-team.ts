/**
 * Add Team Command
 * Adds a new team to the Iris MCP configuration
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { getChildLogger } from "../../utils/logger.js";
import { getConfigPath } from "../../utils/paths.js";

const logger = getChildLogger("cli:add-team");

export interface AddTeamOptions {
  description?: string;
  idleTimeout?: number;
  skipPermissions?: boolean;
  color?: string;
}

export async function addTeam(
  name: string,
  path: string | undefined,
  options: AddTeamOptions,
): Promise<void> {
  // Use current working directory if path not provided
  const teamPath = path ? resolve(path) : process.cwd();

  logger.info(`Adding team "${name}" with path: ${teamPath}`);

  // Validate team path exists
  if (!existsSync(teamPath)) {
    logger.error(`Path does not exist: ${teamPath}`);
    process.exit(1);
  }

  // Check for CLAUDE.md file
  const claudeMdPath = join(teamPath, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    logger.warn(
      `⚠️  Warning: CLAUDE.md not found at ${claudeMdPath}. ` +
        `It's recommended to create a CLAUDE.md file with team-specific instructions.`,
    );
  }

  // Load existing config
  const configPath = getConfigPath();
  logger.info(`Loading config from: ${configPath}`);

  let config: any;
  try {
    const configContent = readFileSync(configPath, "utf-8");
    config = JSON.parse(configContent);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)) },
      "Failed to read config file",
    );
    process.exit(1);
  }

  // Check if team already exists
  if (config.teams && config.teams[name]) {
    logger.error(`Team "${name}" already exists in configuration.`);
    logger.info(`Existing team path: ${config.teams[name].path}`);
    process.exit(1);
  }

  // Ensure teams object exists
  if (!config.teams) {
    config.teams = {};
  }

  // Build team configuration
  const irisConfig: any = {
    path: teamPath,
    description: options.description || `Team ${name}`,
  };

  // Add optional fields if provided
  if (options.idleTimeout !== undefined) {
    irisConfig.idleTimeout = options.idleTimeout;
  }

  if (options.skipPermissions !== undefined) {
    irisConfig.skipPermissions = options.skipPermissions;
  }

  if (options.color) {
    irisConfig.color = options.color;
  }

  // Add team to config
  config.teams[name] = irisConfig;

  // Write updated config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    logger.info(`✅ Successfully added team "${name}" to configuration`);
    logger.info(`   Path: ${teamPath}`);
    logger.info(`   Config: ${configPath}`);

    if (!existsSync(claudeMdPath)) {
      logger.info(
        `\n💡 Next steps:\n` +
          `   1. Create ${claudeMdPath}\n` +
          `   2. Add team-specific instructions for Claude\n` +
          `   3. Run 'iris-mcp team list' to verify`,
      );
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)) },
      "Failed to write config file",
    );
    process.exit(1);
  }
}
