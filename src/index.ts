#!/usr/bin/env node

/**
 * Iris MCP CLI
 * Command-line interface for Iris MCP server
 */

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getConfigManager } from "./config/teams-config.js";
import { IrisMcpServer } from "./mcp_server.js";
import { IrisWebServer } from "./web_server.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { getChildLogger } from "./utils/logger.js";
import { getIrisHome, getConfigPath, getDataDir } from "./utils/paths.js";
import { addTeam, install, uninstall } from "./cli/index.js";

const logger = getChildLogger("iris:cli");

// Load package.json to get version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program
  .name("iris")
  .description("🌈 Iris MCP - Bridge your AI agents across codebases")
  .version(packageJson.version);

// Start command - runs the MCP server and optionally the web server
program
  .command("start")
  .description("Start the Iris MCP server")
  .option("-t, --transport <type>", "Transport type (stdio or http)", "http")
  .option("-p, --port <number>", "HTTP server port (default: 1615)", "1615")
  .action(async (options) => {
    // Load config inside the start command
    const configManager = getConfigManager();
    const config = configManager.load();

    // Use config defaults if options not provided
    const transport = (options.transport ||
      config.settings.defaultTransport ||
      "http") as "stdio" | "http";
    const port = parseInt(
      options.port || String(config.settings.httpPort || 1615),
      10,
    );

    // Validate transport type
    if (transport !== "stdio" && transport !== "http") {
      logger.error(
        `Invalid transport type: ${transport}. Must be 'stdio' or 'http'`,
      );
      process.exit(1);
    }

    // Validate port number
    if (transport === "http" && (isNaN(port) || port < 1 || port > 65535)) {
      logger.error(
        `Invalid port number: ${options.port}. Must be between 1 and 65535`,
      );
      process.exit(1);
    }

    try {
      // Initialize shared components
      logger.info({
        irisHome: getIrisHome(),
        configPath: getConfigPath(),
        dataDir: getDataDir(),
        teams: Object.keys(config.teams),
        maxProcesses: config.settings.maxProcesses,
      }, "Initializing Iris MCP...");

      const sessionManager = new SessionManager(config);
      const processPool = new ClaudeProcessPool(configManager, config.settings);

      // Initialize session manager
      logger.info("Initializing session manager...");
      await sessionManager.initialize();
      logger.info("Session manager initialized");

      // Create MCP server with shared components
      const mcpServer = new IrisMcpServer(
        sessionManager,
        processPool,
        configManager,
      );

      // Start web server if enabled
      if (config.dashboard?.enabled) {
        try {
          logger.info("Starting web dashboard...");
          const webServer = new IrisWebServer(
            processPool,
            sessionManager,
            configManager,
          );
          await webServer.start(config.dashboard);
        } catch (error) {
          logger.error({
            err: error instanceof Error ? error : new Error(String(error))
          }, "Failed to start web dashboard");
          logger.warn("Continuing without dashboard");
        }
      }

      // Start MCP server
      await mcpServer.run(transport, port);
    } catch (error) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, "Fatal error");
      process.exit(1);
    }
  });

// Add Team command - adds a new team to the configuration
program
  .command("add-team <name> [path]")
  .description("Add a new team to the Iris MCP configuration")
  .option("-d, --description <text>", "Team description")
  .option("-t, --idle-timeout <ms>", "Idle timeout in milliseconds", (value) =>
    parseInt(value, 10),
  )
  .option(
    "-s, --skip-permissions",
    "Auto-approve Claude actions (dangerously-skip-permissions)",
  )
  .option("-c, --color <hex>", "Team color for UI (hex format)")
  .action(async (name, path, options) => {
    try {
      await addTeam(name, path, {
        description: options.description,
        idleTimeout: options.idleTimeout,
        skipPermissions: options.skipPermissions,
        color: options.color,
      });
    } catch (error) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, "Failed to add team");
      process.exit(1);
    }
  });

// Install command - installs Iris MCP to Claude's global configuration
program
  .command("install")
  .description(
    "Install Iris MCP server to Claude CLI configuration (~/.claude.json)",
  )
  .option(
    "-u, --url <url>",
    "MCP server URL (default: http://localhost:1615/mcp)",
  )
  .option("-p, --port <number>", "HTTP server port (default: 1615)", (value) =>
    parseInt(value, 10),
  )
  .option("-f, --force", "Force overwrite if Iris is already installed")
  // .option("-d, --desktop", "Install to Claude Desktop config instead of CLI config") // DISABLED: stdio server not working with Desktop
  .action(async (options) => {
    try {
      await install({
        url: options.url,
        port: options.port,
        force: options.force,
        // desktop: options.desktop, // DISABLED
      });
    } catch (error) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, "Failed to install Iris MCP");
      process.exit(1);
    }
  });

// Uninstall command - removes Iris MCP from Claude's configurations
program
  .command("uninstall")
  .description(
    "Remove Iris MCP server from Claude CLI configuration (~/.claude.json)",
  )
  // .option("--cli", "Only remove from CLI config (~/.claude.json)") // DISABLED: Desktop support disabled
  // .option("--desktop", "Only remove from Desktop config") // DISABLED: stdio server not working with Desktop
  .action(async (options) => {
    try {
      await uninstall({
        // cli: options.cli, // DISABLED
        // desktop: options.desktop, // DISABLED
      });
    } catch (error) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, "Failed to uninstall Iris MCP");
      process.exit(1);
    }
  });

// Default action when no command is provided - run start command
program.action(() => {
  // If no command specified, show help
  program.help();
});

// Parse command line arguments
program.parse(process.argv);

// If no arguments provided, run start command by default
if (process.argv.length === 2) {
  // No arguments provided, run start with defaults
  (async () => {
    try {
      // Load config to get defaults
      const configManager = getConfigManager();
      const config = configManager.load();

      // Initialize shared components
      logger.info({
        irisHome: getIrisHome(),
        configPath: getConfigPath(),
        dataDir: getDataDir(),
        teams: Object.keys(config.teams),
        maxProcesses: config.settings.maxProcesses,
      }, "Initializing Iris MCP...");

      const sessionManager = new SessionManager(config);
      const processPool = new ClaudeProcessPool(configManager, config.settings);

      // Initialize session manager
      logger.info("Initializing session manager...");
      await sessionManager.initialize();
      logger.info("Session manager initialized");

      // Create MCP server with shared components
      const mcpServer = new IrisMcpServer(
        sessionManager,
        processPool,
        configManager,
      );

      // Start web server if enabled
      if (config.dashboard?.enabled) {
        try {
          logger.info("Starting web dashboard...");
          const webServer = new IrisWebServer(
            processPool,
            sessionManager,
            configManager,
          );
          await webServer.start(config.dashboard);
        } catch (error) {
          logger.error({
            err: error instanceof Error ? error : new Error(String(error))
          }, "Failed to start web dashboard");
          logger.warn("Continuing without dashboard");
        }
      }

      // Start MCP server with defaults
      await mcpServer.run(
        (config.settings.defaultTransport as "stdio" | "http") || "http",
        config.settings.httpPort || 1615,
      );
    } catch (error) {
      logger.error({
        err: error instanceof Error ? error : new Error(String(error))
      }, "Fatal error");
      process.exit(1);
    }
  })();
}
