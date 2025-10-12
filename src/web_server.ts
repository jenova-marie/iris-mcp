/**
 * Iris Web Server
 * Standalone web dashboard server for monitoring and managing Iris MCP
 * Runs independently from the MCP server, sharing process pool and notification queue
 */

import type { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import type { NotificationQueue } from "./notifications/queue.js";
import type { TeamsConfigManager } from "./config/teams-config.js";
import type { DashboardConfig } from "./process-pool/types.js";
import { DashboardStateBridge } from "./dashboard/server/state-bridge.js";
import { startDashboardServer } from "./dashboard/server/index.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("web-server");

export class IrisWebServer {
  private bridge: DashboardStateBridge;

  constructor(
    private processPool: ClaudeProcessPool,
    private notificationQueue: NotificationQueue,
    private configManager: TeamsConfigManager,
  ) {
    // Create the bridge between MCP components and dashboard
    this.bridge = new DashboardStateBridge(
      this.processPool,
      this.notificationQueue,
      this.configManager,
    );

    logger.info("Iris Web Server initialized");
  }

  /**
   * Start the web server
   */
  async start(config: DashboardConfig): Promise<void> {
    try {
      logger.info("Starting web server...", {
        host: config.host,
        port: config.port,
      });

      await startDashboardServer(this.bridge, config);

      logger.info("Web server started successfully", {
        url: `http://${config.host}:${config.port}`,
      });
    } catch (error) {
      logger.error("Failed to start web server", error);
      throw error;
    }
  }

  /**
   * Get the state bridge (for testing or advanced usage)
   */
  getBridge(): DashboardStateBridge {
    return this.bridge;
  }
}
