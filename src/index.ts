#!/usr/bin/env node

/**
 * Iris MCP Server
 * Model Context Protocol server for cross-project Claude Code coordination
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { Command } from 'commander';

import { getConfigManager } from "./config/teams-config.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
// import { MessageQueue } from "./messages/queue.js";
import { SessionManager } from "./session/session-manager.js";
import { IrisOrchestrator } from "./iris.js";
import { Logger } from "./utils/logger.js";
import { say } from "./mcp/index.js";
// TODO: teams_get_status needs to be moved/renamed

const logger = new Logger('server');

// MCP Tool Definitions
const TOOLS: Tool[] = [
  {
    name: 'teams_request',
    description:
      'Unified tool for team communication. Supports three modes: ' +
      '1) Synchronous request (waitForResponse=true): Send message and wait for response. ' +
      '2) Asynchronous request (waitForResponse=false): Send without waiting. ' +
      '3) Persistent notification (persist=true): Fire-and-forget to persistent queue.',
    inputSchema: {
      type: 'object',
      properties: {
        toTeam: {
          type: 'string',
          description: 'Name of the team to send message to (e.g., "frontend", "backend", "mobile")',
        },
        message: {
          type: 'string',
          description: 'The message content to send',
        },
        fromTeam: {
          type: 'string',
          description: 'Optional: Name of the team sending the message',
        },
        waitForResponse: {
          type: 'boolean',
          description: 'Wait for response (default: true). Ignored if persist=true.',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (default: 30000). Only used when waitForResponse=true.',
        },
        persist: {
          type: 'boolean',
          description: 'Use persistent queue for fire-and-forget (default: false). When true, message is queued in SQLite.',
        },
        ttlDays: {
          type: 'number',
          description: 'Optional: TTL in days for persistent notifications (default: 30). Only used when persist=true.',
        },
      },
      required: ['toTeam', 'message'],
    },
  },
  {
    name: 'teams_get_status',
    description:
      'Get the status of teams, running processes, and notification queue. Use this to check which teams are active and available.',
    inputSchema: {
      type: 'object',
      properties: {
        team: {
          type: 'string',
          description: 'Optional: Get status for a specific team only',
        },
        includeNotifications: {
          type: 'boolean',
          description: 'Include notification queue statistics (default: true)',
        },
      },
    },
  },
];

class IrisMcpServer {
  private server: Server;
  private configManager: ReturnType<typeof getConfigManager>;
  private sessionManager: SessionManager;
  private processPool: ClaudeProcessPool;
  // private messageQueue: MessageQueue;
  private iris: IrisOrchestrator;

  constructor() {
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

    // Initialize components
    this.configManager = getConfigManager();
    const config = this.configManager.load();

    // Initialize session manager
    this.sessionManager = new SessionManager(config);

    this.processPool = new ClaudeProcessPool(
      this.configManager,
      config.settings,
    );

    // this.messageQueue = new MessageQueue();

    // Initialize Iris orchestrator (BLL)
    this.iris = new IrisOrchestrator(this.sessionManager, this.processPool);

    // Set up MCP handlers
    this.setupHandlers();

    // Set up process pool event listeners
    this.setupEventListeners();

    logger.info('Iris MCP Server initialized', {
      teams: Object.keys(config.teams),
      maxProcesses: config.settings.maxProcesses,
    });
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'teams_request':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    await say(args as any, this.iris),
                    null,
                    2
                  ),
                },
              ],
            };

          case 'teams_get_status':
            // TODO: Re-implement teams_get_status
            throw new Error('teams_get_status not yet migrated to mcp/');
            // return {
            //   content: [
            //     {
            //       type: 'text',
            //       text: JSON.stringify(
            //         await teamsGetStatus(
            //           args as any,
            //           this.processPool,
            //           // this.messageQueue,
            //           this.configManager
            //         ),
            //         null,
            //         2
            //       ),
            //     },
            //   ],
            // };

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        logger.error(`Tool ${name} failed`, error);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : String(error),
                  tool: name,
                },
                null,
                2
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
    this.processPool.on('process-spawned', (data) => {
      logger.info('Process spawned', data);
    });

    this.processPool.on('process-terminated', (data) => {
      logger.info('Process terminated', data);
    });

    this.processPool.on('process-error', (data) => {
      logger.error('Process error', data.error);
    });
  }


  async run(transport: 'stdio' | 'http' = 'stdio', port: number = 1615): Promise<void> {
    // Initialize session manager
    logger.info("Initializing session manager...");
    await this.sessionManager.initialize();
    logger.info("Session manager initialized");

    if (transport === 'http') {
      // HTTP transport mode using StreamableHTTPServerTransport
      const app = express();
      app.use(express.json());

      // Store transports for stateless mode (one per request)
      const transports = new Map<string, StreamableHTTPServerTransport>();

      // Handle MCP requests with proper SDK transport (POST for JSON-RPC, GET for SSE)
      app.all('/mcp', async (req, res) => {
        logger.debug('Received HTTP request', {
          method: req.method,
          body: req.body,
          headers: req.headers
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
          res.on('close', () => {
            transports.delete(requestId);
            httpTransport.close();
          });

          // Connect the transport to our server
          await this.server.connect(httpTransport);

          // Handle the request (works for both POST and GET)
          await httpTransport.handleRequest(req, res, req.body);
        } catch (error) {
          logger.error('Error handling MCP request:', error);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error'
              },
              id: req.body?.id || null
            });
          }
        }
      });

      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({
          status: 'ok',
          transport: 'http',
          server: '@iris-mcp/server',
          version: '1.0.0'
        });
      });

      app.listen(port, () => {
        logger.info(`Iris MCP Server running on HTTP port ${port}`);
        logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
        logger.info(`Health check: http://localhost:${port}/health`);
      }).on('error', (error) => {
        logger.error('HTTP server error:', error);
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
      // this.messageQueue.close();
      this.sessionManager.close();

      logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown", error);
      process.exit(1);
    }
  }
}

// Start the server with command-line argument parsing
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Command();

  program
    .name('iris-mcp')
    .description('Iris MCP Server - Cross-project Claude Code coordination')
    .version('1.0.0')
    .option('-t, --transport <type>', 'Transport type (stdio or http)', 'stdio')
    .option('-p, --port <number>', 'HTTP server port (default: 1615)', '1615')
    .parse(process.argv);

  const options = program.opts();
  const transport = options.transport as 'stdio' | 'http';
  const port = parseInt(options.port, 10);

  // Validate transport type
  if (transport !== 'stdio' && transport !== 'http') {
    logger.error(`Invalid transport type: ${transport}. Must be 'stdio' or 'http'`);
    process.exit(1);
  }

  // Validate port number
  if (transport === 'http' && (isNaN(port) || port < 1 || port > 65535)) {
    logger.error(`Invalid port number: ${options.port}. Must be between 1 and 65535`);
    process.exit(1);
  }

  const server = new IrisMcpServer();
  server.run(transport, port).catch((error) => {
    logger.error('Fatal error', error);
    process.exit(1);
  });
}

export default IrisMcpServer;
