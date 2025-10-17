/**
 * Iris Web Server
 * Standalone web dashboard server for monitoring and managing Iris MCP
 * Runs independently from the MCP server, sharing process pool and session manager
 */

import type { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { TeamsConfigManager } from "./config/iris-config.js";
import type { IrisOrchestrator } from "./iris.js";
import type { PendingPermissionsManager } from "./permissions/pending-manager.js";
import type { DashboardConfig } from "./process-pool/types.js";
import { DashboardStateBridge } from "./dashboard/server/state-bridge.js";
import { startDashboardServer } from "./dashboard/server/index.js";
import { getChildLogger } from "./utils/logger.js";

const logger = getChildLogger("iris:web");

export class IrisWebServer {
  private bridge: DashboardStateBridge;

  constructor(
    private processPool: ClaudeProcessPool,
    private sessionManager: SessionManager,
    private configManager: TeamsConfigManager,
    iris?: IrisOrchestrator,
    pendingPermissions?: PendingPermissionsManager,
  ) {
    // Create the bridge between MCP components and dashboard
    // Pass iris instance to share the same CacheManager
    // Pass pendingPermissions to enable permission approval UI
    this.bridge = new DashboardStateBridge(
      this.processPool,
      this.sessionManager,
      this.configManager,
      iris,
      pendingPermissions,
    );

    logger.info("Iris Web Server initialized");
  }

  /**
   * Start the web server
   */
  async start(config: DashboardConfig): Promise<void> {
    try {
      const urls: string[] = [];
      if (config.http > 0) {
        urls.push(`http://${config.host}:${config.http}`);
      }
      if (config.https > 0) {
        urls.push(`https://${config.host}:${config.https}`);
      }

      logger.info(
        {
          host: config.host,
          http: config.http || 'disabled',
          https: config.https || 'disabled',
          selfsigned: config.selfsigned,
        },
        "Starting web server...",
      );

      await startDashboardServer(this.bridge, config);

      logger.info(
        {
          urls,
        },
        "Web server started successfully",
      );
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to start web server",
      );
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
