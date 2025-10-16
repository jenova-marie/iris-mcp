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

import { getConfigManager } from "./config/iris-config.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { PoolEvent } from "./process-pool/types.js";
import { SessionManager } from "./session/session-manager.js";
import { IrisOrchestrator } from "./iris.js";
import { getChildLogger } from "./utils/logger.js";
import { getIrisHome, getConfigPath, getDataDir } from "./utils/paths.js";
import { tell } from "./actions/tell.js";
import { quickTell } from "./actions/quick_tell.js";
import { cancel } from "./actions/cancel.js";
import { clear } from "./actions/clear.js";
import { deleteSession } from "./actions/delete.js";
import { compact } from "./actions/compact.js";
import { isAwake } from "./actions/isAwake.js";
import { wake } from "./actions/wake.js";
import { sleep } from "./actions/sleep.js";
import { wakeAll } from "./actions/wake-all.js";
import { report } from "./actions/report.js";
import { teams } from "./actions/teams.js";
import { debug } from "./actions/debug.js";

const logger = getChildLogger("iris:mcp");

// MCP Tool Definitions
const TOOLS: Tool[] = [
  {
    name: "team_tell",
    description: "Tell a message to a specific team",
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
          description: "Name of the team sending the message",
        },
        timeout: {
          type: "number",
          description:
            "Optional timeout in milliseconds (default: 30000). 0 wait indefinately -1 **quickly** (async) return immediately",
        },
        persist: {
          type: "boolean",
          description:
            "Use persistent queue for  (default: false). When true, message is queued in SQLite.",
        },
        ttlDays: {
          type: "number",
          description:
            "Optional: TTL in days for persistent notifications (default: 30). Only used when persist=true.",
        },
      },
      required: ["toTeam", "message", "fromTeam"],
    },
  },
  {
    name: "team_quick_tell",
    description:
      "Quickly send a message to a team with timeout=-1 (async). " +
      "Returns immediately after queuing the message. " +
      "Convenience wrapper for team_tell with hardcoded timeout=-1 to execute quicly",
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
          description: "Name of the team sending the message",
        },
      },
      required: ["toTeam", "message", "fromTeam"],
    },
  },
  {
    name: "team_cancel",
    description:
      "EXPERIMENTAL: Attempt to cancel a running operation by sending ESC to stdin. " +
      "This may or may not work depending on whether Claude's headless mode supports ESC interrupt handling. " +
      "Use this when you want to try interrupting a long-running Claude operation.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Name of the team whose operation to cancel",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the cancel",
        },
      },
      required: ["team", "fromTeam"],
    },
  },
  {
    name: "team_clear",
    description:
      "Create a fresh new session for a team pair. Use this to start over with a clean slate, " +
      "restart the conversation, or reset when you want a fresh beginning without prior message history. " +
      "Terminates existing process, deletes old session (including file cleanup), and creates a brand new " +
      "session with a new UUID. Perfect for starting fresh, clearing history, getting a new start, or resetting " +
      "after context has become too large or confused.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description: "Name of the team to create fresh session for",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the clear/reset",
        },
      },
      required: ["toTeam", "fromTeam"],
    },
  },
  {
    name: "team_delete",
    description:
      "Delete a team session permanently. Terminates the process and removes the session data completely. " +
      "Unlike clear which creates a new session, delete just removes the session without replacement. " +
      "Use this when you want to completely remove a session and don't need a fresh one.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description: "Name of the team to delete session for",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the delete",
        },
      },
      required: ["toTeam", "fromTeam"],
    },
  },
  {
    name: "team_compact",
    description:
      "Compact a team's session to reduce context size. Uses claude --print /compact to compress " +
      "the session history while preserving important context. This is useful when a session has grown " +
      "large and needs optimization without completely clearing the history. The session remains active " +
      "after compacting.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description: "Name of the team whose session to compact",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the compact",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds (default: 30000)",
        },
        retries: {
          type: "number",
          description: "Optional number of retry attempts (default: 2)",
        },
      },
      required: ["toTeam", "fromTeam"],
    },
  },
  {
    name: "team_isAwake",
    description:
      "Check if teams are awake (active) or asleep (inactive) and get their current status. Returns process details for active teams.",
    inputSchema: {
      type: "object",
      properties: {
        fromTeam: {
          type: "string",
          description:
            "Name of the calling team (required to identify sessions)",
        },
        team: {
          type: "string",
          description: "Optional: Check status for a specific team only",
        },
        includeNotifications: {
          type: "boolean",
          description: "Include notification queue statistics (default: true)",
        },
      },
      required: ["fromTeam"],
    },
  },
  {
    name: "team_wake",
    description:
      "Wake up a team by ensuring its process is active in the pool. " +
      "Returns immediately if team is already awake, otherwise starts the wake process. " +
      "Use 'fromTeam' to create a session-specific process for conversation isolation (e.g., fromTeam='iris' creates 'iris->alpha').",
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
            "Identify the calling team for session-specific process. " +
            "Creates a dedicated process for this team pair to maintain conversation isolation.",
        },
      },
      required: ["team", "fromTeam"],
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
          description: "Name of the team requesting the sleep",
        },
        force: {
          type: "boolean",
          description:
            "Force termination even if process is busy (default: false)",
        },
      },
      required: ["team", "fromTeam"],
    },
  },
  {
    name: "team_wake_all",
    description:
      "Wake up all configured teams sequentially. Sounds the air-raid siren and brings all teams online. " +
      "Note: Parallel mode is NOT RECOMMENDED - spawning multiple Claude instances simultaneously is unstable and causes timeouts.",
    inputSchema: {
      type: "object",
      properties: {
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the wake-all",
        },
        parallel: {
          type: "boolean",
          description:
            "Wake teams in parallel (NOT RECOMMENDED - unstable, causes timeouts. Default: false)",
        },
      },
      required: ["fromTeam"],
    },
  },
  {
    name: "team_report",
    description:
      "View the cached conversation for a team pair. " +
      "Returns all cache entries (spawn + tell operations) with their messages and status. " +
      "Shows the complete conversation history including protocol messages from Claude. " +
      "Caching is always enabled - this is the primary means for Claude → requestor communication.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description:
            "Name of the team whose conversation cache to view (the recipient/toTeam)",
        },
        fromTeam: {
          type: "string",
          description:
            "Name of the team requesting the report (the sender/fromTeam)",
        },
      },
      required: ["team", "fromTeam"],
    },
  },
  {
    name: "team_teams",
    description:
      "Get all currently configured teams. " +
      "Returns a list of all teams with their name and configuration details (path, description, color, etc.).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "team_debug",
    description:
      "Query in-memory logs from Wonder Logger memory transport. " +
      "Returns logs since a specified timestamp, with optional filtering by level and format. " +
      "Use getAllStores=true to see available memory store names.",
    inputSchema: {
      type: "object",
      properties: {
        logs_since: {
          type: "number",
          description:
            "Timestamp (milliseconds) to get logs since. If not provided, returns all logs in memory.",
        },
        storeName: {
          type: "string",
          description:
            "Memory store name to query. If not provided, queries the default 'iris-mcp' store. Use getAllStores=true to see available store names.",
        },
        format: {
          type: "string",
          enum: ["raw", "parsed"],
          description:
            "Return format: 'raw' (Pino JSON objects as-is) or 'parsed' (human-readable format with string levels). Default: 'parsed'",
        },
        level: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
          description:
            "Filter by log level(s). Single level: 'error'. Multiple levels: ['error', 'warn']. Available levels: trace, debug, info, warn, error, fatal",
        },
        getAllStores: {
          type: "boolean",
          description:
            "If true, returns list of all available memory store names instead of logs",
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
    this.iris = new IrisOrchestrator(
      this.sessionManager,
      this.processPool,
      this.configManager.getConfig(),
    );

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
            result = {
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
            break;

          case "team_quick_tell":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await quickTell(args as any, this.iris),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_cancel":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await cancel(args as any, this.processPool),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_clear":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await clear(
                      args as any,
                      this.iris,
                      this.sessionManager,
                      this.processPool,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_delete":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await deleteSession(
                      args as any,
                      this.iris,
                      this.sessionManager,
                      this.processPool,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_compact":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await compact(
                      args as any,
                      this.iris,
                      this.sessionManager,
                      this.configManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_isAwake":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await isAwake(
                      args as any,
                      this.iris,
                      this.processPool,
                      this.configManager,
                      this.sessionManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_wake":
            result = {
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
            break;

          case "team_sleep":
            result = {
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
            break;

          case "team_wake_all":
            result = {
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
            break;

          case "team_report":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await report(args as any, this.iris),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_teams":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await teams(args as any, this.configManager),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_debug":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await debug(args as any),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        // Log pool state AFTER successful tool execution (when DEBUG env is set)
        if (process.env.DEBUG) {
          this.processPool.logPoolState(`after:${name}`);
        }

        return result;
      } catch (error) {
        logger.error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            tool: name,
          },
          `Tool ${name} failed`,
        );

        // Log pool state AFTER failed tool execution (when DEBUG env is set)
        if (process.env.DEBUG) {
          this.processPool.logPoolState(`error:${name}`);
        }

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
    // Log important pool events using enum to prevent typos
    this.processPool.on(PoolEvent.PROCESS_TERMINATED, (data) => {
      logger.info(data, "Process terminated");
    });

    this.processPool.on(PoolEvent.PROCESS_ERROR, (data) => {
      logger.error(
        {
          err:
            data.error instanceof Error
              ? data.error
              : new Error(String(data.error)),
        },
        "Process error",
      );
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
        logger.debug(
          {
            method: req.method,
            body: req.body,
            headers: req.headers,
          },
          "Received HTTP request",
        );

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
          logger.error(
            {
              err: error instanceof Error ? error : new Error(String(error)),
            },
            "Error handling MCP request",
          );
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
          logger.error(
            {
              err: error instanceof Error ? error : new Error(String(error)),
            },
            "HTTP server error",
          );
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

  /**
   * Get the IrisOrchestrator instance
   * This allows sharing the same orchestrator (with its CacheManager) with other components like the web dashboard
   */
  getIris(): IrisOrchestrator {
    return this.iris;
  }

  private async shutdown(): Promise<void> {
    logger.info("Shutting down Iris MCP Server...");

    try {
      await this.processPool.terminateAll();
      this.sessionManager.close();

      logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Error during shutdown",
      );
      process.exit(1);
    }
  }
}

export default IrisMcpServer;
