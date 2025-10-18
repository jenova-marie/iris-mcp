/**
 * Add Team Command
 * Adds a new team to the Iris MCP configuration
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { parseDocument } from "yaml";
import { getChildLogger } from "../../utils/logger.js";
import { getConfigPath } from "../../utils/paths.js";

const logger = getChildLogger("cli:add-team");

export interface AddTeamOptions {
  description?: string;
  idleTimeout?: number;
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

  let doc: any;
  try {
    const configContent = readFileSync(configPath, "utf-8");
    // Parse as YAML Document to preserve comments
    doc = parseDocument(configContent);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)) },
      "Failed to read config file",
    );
    process.exit(1);
  }

  // Get the teams node (or create if doesn't exist)
  const teams = doc.get("teams");

  // Check if team already exists
  if (teams && teams.has(name)) {
    logger.error(`Team "${name}" already exists in configuration.`);
    const existingTeam = teams.get(name);
    logger.info(`Existing team path: ${existingTeam.get("path")}`);
    process.exit(1);
  }

  // Ensure teams node exists
  if (!teams) {
    doc.set("teams", doc.createNode({}));
  }

  // Build team configuration object
  const irisConfig: any = {
    path: teamPath,
    description: options.description || `Team ${name}`,
  };

  // Add optional fields if provided
  if (options.idleTimeout !== undefined) {
    irisConfig.idleTimeout = options.idleTimeout;
  }

  if (options.color) {
    irisConfig.color = options.color;
  }

  // Add team to config (this preserves existing comments!)
  const teamsNode = doc.get("teams");
  teamsNode.set(name, doc.createNode(irisConfig));

  // Write updated config (preserves comments and formatting)
  try {
    writeFileSync(configPath, doc.toString(), "utf-8");
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
