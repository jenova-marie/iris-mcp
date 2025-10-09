import { describe, it, expect, beforeEach } from 'vitest';
import { IrisMcpServer, handleListTools, handleCallTool } from './index.js';
import type { CallToolRequest, ListToolsRequest } from '@modelcontextprotocol/sdk/types.js';

describe('IrisMcpServer', () => {
  let server: IrisMcpServer;

  beforeEach(() => {
    server = new IrisMcpServer();
  });

  describe('initialization', () => {
    it('should create a server instance', () => {
      expect(server).toBeInstanceOf(IrisMcpServer);
    });
  });
});

describe('handleListTools', () => {
  it('should return list of available tools', async () => {
    const request = {} as ListToolsRequest;
    const response = await handleListTools(request);

    expect(response).toHaveProperty('tools');
    expect(response.tools).toHaveLength(1);
    expect(response.tools[0]).toMatchObject({
      name: 'hello',
      description: 'Returns a friendly greeting message',
    });
  });

  it('should include input schema for hello tool', async () => {
    const request = {} as ListToolsRequest;
    const response = await handleListTools(request);

    const helloTool = response.tools[0];
    expect(helloTool.inputSchema).toBeDefined();
    expect(helloTool.inputSchema).toHaveProperty('properties');
    expect(helloTool.inputSchema.properties).toHaveProperty('name');
  });
});

describe('handleCallTool', () => {
  it('should handle hello tool with default name', async () => {
    const request = {
      params: {
        name: 'hello',
        arguments: {},
      },
    } as CallToolRequest;

    const response = await handleCallTool(request);

    expect(response).toHaveProperty('content');
    expect(response.content).toHaveLength(1);
    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: 'Hello, World! Welcome to Iris MCP Server.',
    });
  });

  it('should handle hello tool with custom name', async () => {
    const request = {
      params: {
        name: 'hello',
        arguments: {
          name: 'Alice',
        },
      },
    } as CallToolRequest;

    const response = await handleCallTool(request);

    expect(response).toHaveProperty('content');
    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: 'Hello, Alice! Welcome to Iris MCP Server.',
    });
  });

  it('should handle hello tool with different custom names', async () => {
    const names = ['Bob', 'Charlie', 'Diana'];

    for (const name of names) {
      const request = {
        params: {
          name: 'hello',
          arguments: { name },
        },
      } as CallToolRequest;

      const response = await handleCallTool(request);

      expect(response.content[0]).toMatchObject({
        type: 'text',
        text: `Hello, ${name}! Welcome to Iris MCP Server.`,
      });
    }
  });

  it('should throw error for unknown tool', async () => {
    const request = {
      params: {
        name: 'unknown_tool',
        arguments: {},
      },
    } as CallToolRequest;

    await expect(handleCallTool(request)).rejects.toThrow(
      'Unknown tool: unknown_tool'
    );
  });

  it('should handle missing arguments gracefully', async () => {
    const request = {
      params: {
        name: 'hello',
        arguments: undefined,
      },
    } as CallToolRequest;

    const response = await handleCallTool(request);

    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: 'Hello, World! Welcome to Iris MCP Server.',
    });
  });
});
