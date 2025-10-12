/**
 * Iris MCP Server
 * Model Context Protocol server for cross-project Claude Code coordination
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { getConfigManager } from "./config/teams-config.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { IrisOrchestrator } from "./iris.js";
import { Logger } from "./utils/logger.js";
import { getIrisHome, getConfigPath, getDataDir } from "./utils/paths.js";
import { tell } from "./actions/tell.js";
import { isAwake } from "./actions/isAwake.js";
import { wake } from "./actions/wake.js";
import { sleep } from "./actions/sleep.js";
import { wakeAll } from "./actions/wake-all.js";
import { report } from "./actions/report.js";
import { cacheRead, cacheClear } from "./actions/cache.js";
import { getTeamName } from "./actions/getTeamName.js";
import { teams } from "./actions/teams.js";

const logger = new Logger("server");

// MCP Tool Definitions
const TOOLS: Tool[] = [
  {
    name: "team_tell",
    description:
      "Tell a message to a specific team. Supports three modes: " +
      "1) Synchronous (waitForResponse=true): Tell team and wait for response. " +
      "2) Asynchronous (waitForResponse=false): Tell team without waiting. " +
      "3) Persistent notification (persist=true): Fire-and-forget to persistent queue.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description:
            'Name of the team to send message to (e.g., "frontend", "backend", "mobile")',
        },
        message: {
          type: "string",
          description: "The message content to send",
        },
        fromTeam: {
          type: "string",
          description: "Optional: Name of the team sending the message",
        },
        waitForResponse: {
          type: "boolean",
          description:
            "Wait for response (default: true). Ignored if persist=true.",
        },
        timeout: {
          type: "number",
          description:
            "Optional timeout in milliseconds (default: 30000). Only used when waitForResponse=true.",
        },
        persist: {
          type: "boolean",
          description:
            "Use persistent queue for fire-and-forget (default: false). When true, message is queued in SQLite.",
        },
        ttlDays: {
          type: "number",
          description:
            "Optional: TTL in days for persistent notifications (default: 30). Only used when persist=true.",
        },
      },
      required: ["toTeam", "message"],
    },
  },
  {
    name: "team_isAwake",
    description:
      "Check if teams are awake (active) or asleep (inactive) and get their current status. Returns process details for active teams.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Optional: Check status for a specific team only",
        },
        includeNotifications: {
          type: "boolean",
          description: "Include notification queue statistics (default: true)",
        },
      },
    },
  },
  {
    name: "team_wake",
    description:
      "Wake up a team by ensuring its process is active in the pool. " +
      "Returns immediately if team is already awake, otherwise starts the wake process. " +
      "Use 'fromTeam' to create a session-specific process for conversation isolation (e.g., fromTeam='iris' creates 'iris->alpha' instead of 'external->alpha').",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description:
            'Name of the team to wake up (e.g., "frontend", "backend", "mobile")',
        },
        fromTeam: {
          type: "string",
          description:
            "Optional: Identify the calling team for session-specific process. " +
            "When provided, creates a dedicated process for this team pair to maintain conversation isolation.",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "team_sleep",
    description:
      "Put a team to sleep by removing its process from the pool. Terminates the team process and frees resources.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Name of the team to put to sleep",
        },
        fromTeam: {
          type: "string",
          description: "Optional: Name of the team requesting the sleep",
        },
        force: {
          type: "boolean",
          description:
            "Force termination even if process is busy (default: false)",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "team_wake_all",
    description:
      "Wake up all configured teams. Sounds the air-raid siren and brings all teams online.",
    inputSchema: {
      type: "object",
      properties: {
        fromTeam: {
          type: "string",
          description: "Optional: Name of the team requesting the wake-all",
        },
        parallel: {
          type: "boolean",
          description:
            "Wake teams in parallel for faster startup (default: false)",
        },
      },
    },
  },
  {
    name: "team_report",
    description:
      "View the output cache (stdout and stderr) for a team without clearing it. Returns all output since the last cache clear.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Name of the team whose output cache to view",
        },
        fromTeam: {
          type: "string",
          description: "Optional: Name of the team requesting the report",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "team_cache_read",
    description:
      "Read the cache for a team's Claude process. Returns cache statistics, recent messages, and protocol data. Use this to inspect conversation history and performance metrics.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Name of the team whose cache to read",
        },
        fromTeam: {
          type: "string",
          description: "Optional: Name of the team requesting the cache read",
        },
        includeMessages: {
          type: "boolean",
          description: "Include recent messages in response (default: true)",
        },
        messageCount: {
          type: "number",
          description:
            "Number of recent messages to include (default: 10, max: 100)",
        },
        format: {
          type: "string",
          description:
            'Export format for messages: "json" or "text" (default: "json")',
          enum: ["json", "text"],
        },
        includeProtocolMessages: {
          type: "boolean",
          description:
            "Include raw protocol messages from Claude - contains all JSON including tool_use blocks (default: false)",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "team_cache_clear",
    description:
      "Clear the cache for a team's Claude process. Removes all cached messages and protocol data. Returns statistics about what was cleared.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Name of the team whose cache to clear",
        },
        fromTeam: {
          type: "string",
          description: "Optional: Name of the team requesting the cache clear",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "team_getTeamName",
    description:
      "Identify the team name from a current working directory (pwd). " +
      "Returns the team name if the path matches a configured team. " +
      "Note: Only works with absolute paths in config.json. Relative paths in config cannot be identified.",
    inputSchema: {
      type: "object",
      properties: {
        pwd: {
          type: "string",
          description: "Your current working directory to look up (use pwd)",
        },
      },
      required: ["pwd"],
    },
  },
  {
    name: "team_teams",
    description:
      "Get all currently configured teams and their status. " +
      "Returns a list of all teams with their configuration and current state (awake/asleep). " +
      "Optionally include process details for active teams.",
    inputSchema: {
      type: "object",
      properties: {
        includeProcessDetails: {
          type: "boolean",
          description: "Include process details for active teams (default: false)",
        },
      },
    },
  },
];

export class IrisMcpServer {
  private server: Server;
  private configManager: ReturnType<typeof getConfigManager>;
  private sessionManager: SessionManager;
  private processPool: ClaudeProcessPool;
  private iris: IrisOrchestrator;

  constructor(
    sessionManager: SessionManager,
    processPool: ClaudeProcessPool,
    configManager: ReturnType<typeof getConfigManager>,
  ) {
    this.server = new Server(
      {
        name: "@iris-mcp/server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Store shared components
    this.sessionManager = sessionManager;
    this.processPool = processPool;
    this.configManager = configManager;

    // Initialize Iris orchestrator (BLL)
    this.iris = new IrisOrchestrator(this.sessionManager, this.processPool);

    // Set up MCP handlers
    this.setupHandlers();

    // Set up process pool event listeners
    this.setupEventListeners();

    logger.info("Iris MCP Server initialized");
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Log pool state BEFORE tool execution (when DEBUG env is set)
      if (process.env.DEBUG) {
        this.processPool.logPoolState(`before:${name}`);
      }

      let result;
      try {
        switch (name) {
          case "team_tell":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await tell(args as any, this.iris),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_isAwake":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await isAwake(
                      args as any,
                      this.iris,
                      this.processPool,
                      this.configManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_wake":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await wake(
                      args as any,
                      this.iris,
                      this.processPool,
                      this.sessionManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_sleep":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await sleep(args as any, this.processPool),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_wake_all":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await wakeAll(
                      args as any,
                      this.iris,
                      this.processPool,
                      this.sessionManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_report":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await report(args as any, this.processPool),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_cache_read":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await cacheRead(args as any, this.processPool),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_cache_clear":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await cacheClear(args as any, this.processPool),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_getTeamName":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await getTeamName(args as any, this.configManager),
                    null,
                    2,
                  ),
                },
              ],
            };

          case "team_teams":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await teams(
                      args as any,
                      this.processPool,
                      this.configManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        logger.error(`Tool ${name} failed`, error);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : String(error),
                  tool: name,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupEventListeners(): void {
    // Log important pool events
    this.processPool.on("process-spawned", (data) => {
      logger.info("Process spawned", data);
    });

    this.processPool.on("process-terminated", (data) => {
      logger.info("Process terminated", data);
    });

    this.processPool.on("process-error", (data) => {
      logger.error("Process error", data.error);
    });
  }

  async run(
    transport: "stdio" | "http" = "stdio",
    port: number = 1615,
  ): Promise<void> {
    // Initialize session manager
    logger.info("Initializing session manager...");
    await this.sessionManager.initialize();
    logger.info("Session manager initialized");

    if (transport === "http") {
      // HTTP transport mode using StreamableHTTPServerTransport
      const app = express();
      app.use(express.json());

      // Store transports for stateless mode (one per request)
      const transports = new Map<string, StreamableHTTPServerTransport>();

      // Handle MCP requests with proper SDK transport (POST for JSON-RPC, GET for SSE)
      app.all("/mcp", async (req, res) => {
        logger.debug("Received HTTP request", {
          method: req.method,
          body: req.body,
          headers: req.headers,
        });

        try {
          // Create a new transport for each request (stateless mode)
          const requestId = Math.random().toString(36).substring(7);
          const httpTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // Stateless mode
            enableJsonResponse: true,
          });

          transports.set(requestId, httpTransport);

          // Clean up when connection closes
          res.on("close", () => {
            transports.delete(requestId);
            httpTransport.close();
          });

          // Connect the transport to our server
          await this.server.connect(httpTransport);

          // Handle the request (works for both POST and GET)
          await httpTransport.handleRequest(req, res, req.body);
        } catch (error) {
          logger.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: "Internal server error",
              },
              id: req.body?.id || null,
            });
          }
        }
      });

      // Health check endpoint
      app.get("/health", (req, res) => {
        res.json({
          status: "ok",
          transport: "http",
          server: "@iris-mcp/server",
          version: "1.0.0",
        });
      });

      app
        .listen(port, () => {
          logger.info(`Iris MCP Server running on HTTP port ${port}`);
          logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
          logger.info(`Health check: http://localhost:${port}/health`);
        })
        .on("error", (error) => {
          logger.error("HTTP server error:", error);
          process.exit(1);
        });
    } else {
      // Stdio transport mode (default)
      const stdioTransport = new StdioServerTransport();
      await this.server.connect(stdioTransport);
      logger.info("Iris MCP Server running on stdio");
    }

    // Graceful shutdown
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  private async shutdown(): Promise<void> {
    logger.info("Shutting down Iris MCP Server...");

    try {
      await this.processPool.terminateAll();
      this.sessionManager.close();

      logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown", error);
      process.exit(1);
    }
  }
}

export default IrisMcpServer;
