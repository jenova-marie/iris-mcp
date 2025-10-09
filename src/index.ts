#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolRequest,
  ListToolsRequest,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Iris MCP Server
 * A simple hello world MCP server implementation
 */

const HELLO_TOOL: Tool = {
  name: 'hello',
  description: 'Returns a friendly greeting message',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the person to greet',
      },
    },
  },
};

/**
 * Handler for listing available tools
 */
export async function handleListTools(_request: ListToolsRequest) {
  return {
    tools: [HELLO_TOOL],
  };
}

/**
 * Handler for calling tools
 */
export async function handleCallTool(request: CallToolRequest) {
  const { name, arguments: args } = request.params;

  if (name === 'hello') {
    const personName = (args?.name as string) || 'World';
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${personName}! Welcome to Iris MCP Server.`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export class IrisMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'iris-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, handleListTools);

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, handleCallTool);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new IrisMcpServer();
  server.run().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

export default IrisMcpServer;
