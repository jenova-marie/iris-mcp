/**
 * Install Command
 * Installs Iris MCP server to Claude's global configuration
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { homedir, platform } from "os";
import { fileURLToPath } from "url";
import { getChildLogger } from "../../utils/logger.js";
import { getConfigPath, ensureIrisHome } from "../../utils/paths.js";

const logger = getChildLogger("cli:install");

export interface InstallOptions {
  url?: string;
  port?: number;
  force?: boolean;
  desktop?: boolean;
}

/**
 * Get Claude Desktop config path based on OS
 */
function getClaudeDesktopConfigPath(): string {
  const plat = platform();

  switch (plat) {
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
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
 * Create default Iris MCP config from default.config.json
 */
function createDefaultIrisConfig(configPath: string): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const defaultConfigPath = resolve(__dirname, "../../default.config.json");

  if (!existsSync(defaultConfigPath)) {
    throw new Error(
      `Default configuration template not found: ${defaultConfigPath}`,
    );
  }

  // Ensure IRIS_HOME directory exists
  const configDir = dirname(configPath);
  if (!existsSync(configDir)) {
    logger.info(`Creating directory: ${configDir}`);
    mkdirSync(configDir, { recursive: true });
  }

  copyFileSync(defaultConfigPath, configPath);
  logger.info(`📄 Created default Iris config: ${configPath}`);
}

export async function install(options: InstallOptions): Promise<void> {
  // Step 1: Ensure Iris MCP config exists
  ensureIrisHome();
  const irisConfigPath = getConfigPath();

  let configCreated = false;
  if (!existsSync(irisConfigPath)) {
    logger.info("Iris MCP configuration not found, creating default config...");
    createDefaultIrisConfig(irisConfigPath);
    configCreated = true;
  } else {
    logger.info(`✓ Iris MCP configuration found: ${irisConfigPath}`);
  }

  // Check if teams are configured
  let hasTeams = false;
  try {
    const irisConfig = JSON.parse(readFileSync(irisConfigPath, "utf-8"));
    hasTeams = irisConfig.teams && Object.keys(irisConfig.teams).length > 0;
  } catch (error) {
    // Ignore errors, we'll just assume no teams
  }

  // Step 2: Install to Claude CLI config
  // DISABLED: Desktop support - only install to CLI config
  // const claudeConfigPath = options.desktop
  //   ? getClaudeDesktopConfigPath()
  //   : join(homedir(), ".claude.json");
  const claudeConfigPath = join(homedir(), ".claude.json");

  const defaultUrl =
    options.url || `http://localhost:${options.port || 1615}/mcp`;

  const configType = "Claude CLI"; // DISABLED: options.desktop ? "Claude Desktop" : "Claude CLI";
  logger.info(
    `\nInstalling Iris MCP to ${configType} configuration: ${claudeConfigPath}`,
  );

  let config: any = {};

  // Read existing config if it exists
  if (existsSync(claudeConfigPath)) {
    try {
      const content = readFileSync(claudeConfigPath, "utf-8");
      config = JSON.parse(content);
      logger.info(`Loaded existing ${configType} configuration`);
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        `Failed to read ${configType} configuration`,
      );
      process.exit(1);
    }
  } else {
    logger.info(`${configType} configuration not found, creating new file`);

    // Ensure directory exists (especially important for Desktop config)
    const configDir = dirname(claudeConfigPath);
    if (!existsSync(configDir)) {
      logger.info(`Creating directory: ${configDir}`);
      mkdirSync(configDir, { recursive: true });
    }

    config = {};
  }

  // Ensure mcpServers object exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Check if iris is already installed
  if (config.mcpServers.iris && !options.force) {
    logger.warn("⚠️  Iris MCP is already installed in Claude configuration");
    logger.info(
      `   Current config: ${JSON.stringify(config.mcpServers.iris, null, 2)}`,
    );
    logger.info(`   Use --force to overwrite`);
    process.exit(1);
  }

  // Add or update iris MCP server configuration
  // DISABLED: Desktop support - always use CLI format (HTTP)
  // Claude Desktop uses command/args (stdio), Claude CLI uses type/url (HTTP)
  // if (options.desktop) {
  //   // Desktop format: stdio with command and args
  //   config.mcpServers.iris = {
  //     command: "iris",
  //     args: ["start", "--transport", "stdio"],
  //   };
  // } else {
  // CLI format: HTTP with type and url
  config.mcpServers.iris = {
    type: "http",
    url: defaultUrl,
  };
  // }

  // Create backup before writing
  try {
    if (existsSync(claudeConfigPath)) {
      const backupPath = `${claudeConfigPath}.bak`;
      copyFileSync(claudeConfigPath, backupPath);
      logger.info(`📦 Created backup: ${backupPath}`);
    }
  } catch (error) {
    logger.warn(`Failed to create backup: ${error}`);
    // Continue anyway - backup failure shouldn't block installation
  }

  // Write updated config
  try {
    writeFileSync(
      claudeConfigPath,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8",
    );
    logger.info(
      `✅ Successfully installed Iris MCP to ${configType} configuration`,
    );
    logger.info(`   Config file: ${claudeConfigPath}`);
    logger.info(`   MCP URL: ${defaultUrl}`);

    // Show next steps
    if (!hasTeams) {
      logger.info(`\n📝 Important: No teams configured yet!`);
      logger.info(`\n💡 Next steps:`);
      logger.info(`   1. Add teams to your configuration:`);
      logger.info(`      iris add-team <name> [path]`);
      logger.info(`\n   2. Start the Iris MCP server:`);
      logger.info(`      iris start`);
      logger.info(`\n   3. Restart Claude CLI (if running)`);
      logger.info(`\n   4. Verify the connection:`);
      logger.info(`      claude mcp list`);
    } else {
      logger.info(`\n💡 Next steps:`);
      logger.info(`   1. Start the Iris MCP server: iris start`);
      logger.info(`   2. Restart Claude CLI (if running)`);
      logger.info(`   3. Verify the connection with: claude mcp list`);
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)) },
      `Failed to write ${configType} configuration`,
    );
    process.exit(1);
  }
}
