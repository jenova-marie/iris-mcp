#!/usr/bin/env node

/**
 * Iris MCP Server
 * Model Context Protocol server for cross-project Claude Code coordination
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfigManager } from './config/teams-config.js';
import { ClaudeProcessPool } from './process-pool/pool-manager.js';
import { NotificationQueue } from './notifications/queue.js';
import { Logger } from './utils/logger.js';
import {
  teamsAsk,
  teamsSendMessage,
  teamsNotify,
  teamsGetStatus,
} from './tools/index.js';

const logger = new Logger('server');

// MCP Tool Definitions
const TOOLS: Tool[] = [
  {
    name: 'teams_ask',
    description:
      'Ask a team a question and wait for a synchronous response. Use this for direct Q&A where you need an immediate answer.',
    inputSchema: {
      type: 'object',
      properties: {
        team: {
          type: 'string',
          description: 'Name of the team to ask (e.g., "frontend", "backend", "mobile")',
        },
        question: {
          type: 'string',
          description: 'The question to ask the team',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (default: 30000)',
        },
      },
      required: ['team', 'question'],
    },
  },
  {
    name: 'teams_send_message',
    description:
      'Send a message to another team. Can optionally wait for a response or fire-and-forget.',
    inputSchema: {
      type: 'object',
      properties: {
        fromTeam: {
          type: 'string',
          description: 'Optional: Name of the team sending the message',
        },
        toTeam: {
          type: 'string',
          description: 'Name of the team to send the message to',
        },
        message: {
          type: 'string',
          description: 'The message to send',
        },
        waitForResponse: {
          type: 'boolean',
          description: 'Whether to wait for a response (default: true)',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (default: 30000)',
        },
      },
      required: ['toTeam', 'message'],
    },
  },
  {
    name: 'teams_notify',
    description:
      'Send a fire-and-forget notification to a team. The notification is queued and will be delivered when the team next checks.',
    inputSchema: {
      type: 'object',
      properties: {
        fromTeam: {
          type: 'string',
          description: 'Optional: Name of the team sending the notification',
        },
        toTeam: {
          type: 'string',
          description: 'Name of the team to notify',
        },
        message: {
          type: 'string',
          description: 'The notification message',
        },
        ttlDays: {
          type: 'number',
          description: 'Optional: How many days before notification expires (default: 30)',
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
  private processPool: ClaudeProcessPool;
  private notificationQueue: NotificationQueue;

  constructor() {
    this.server = new Server(
      {
        name: '@iris-mcp/server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize components
    this.configManager = getConfigManager();
    const config = this.configManager.load();

    this.processPool = new ClaudeProcessPool(
      this.configManager,
      config.settings
    );

    this.notificationQueue = new NotificationQueue();

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
          case 'teams_ask':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    await teamsAsk(args as any, this.processPool),
                    null,
                    2
                  ),
                },
              ],
            };

          case 'teams_send_message':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    await teamsSendMessage(args as any, this.processPool),
                    null,
                    2
                  ),
                },
              ],
            };

          case 'teams_notify':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    await teamsNotify(args as any, this.notificationQueue),
                    null,
                    2
                  ),
                },
              ],
            };

          case 'teams_get_status':
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    await teamsGetStatus(
                      args as any,
                      this.processPool,
                      this.notificationQueue,
                      this.configManager
                    ),
                    null,
                    2
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('Iris MCP Server running on stdio');

    // Graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private async shutdown(): Promise<void> {
    logger.info('Shutting down Iris MCP Server...');

    try {
      await this.processPool.terminateAll();
      this.notificationQueue.close();

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }
}

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new IrisMcpServer();
  server.run().catch((error) => {
    logger.error('Fatal error', error);
    process.exit(1);
  });
}

export default IrisMcpServer;
