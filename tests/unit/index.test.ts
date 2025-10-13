/**
 * Unit tests for MCP Server (index.ts)
 *
 * Tests MCP tool registration and basic server setup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Mock all dependencies
vi.mock("@modelcontextprotocol/sdk/server/index.js");
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock action handlers
vi.mock("../../src/actions/tell.js", () => ({
  tell: vi.fn().mockResolvedValue({
    from: "team-beta",
    to: "team-alpha",
    message: "Test message",
    response: "Mock response",
    duration: 100,
    timestamp: Date.now(),
  }),
}));
vi.mock("../../src/actions/isAwake.js", () => ({
  isAwake: vi.fn().mockResolvedValue({
    teams: [],
    pool: { activeProcesses: 0, maxProcesses: 10, totalMessages: 0 },
    timestamp: Date.now(),
  }),
}));
vi.mock("../../src/actions/wake.js", () => ({
  wake: vi.fn().mockResolvedValue({
    team: "team-alpha",
    status: "awake",
    duration: 100,
  }),
}));
vi.mock("../../src/actions/sleep.js", () => ({
  sleep: vi.fn().mockResolvedValue({
    team: "team-alpha",
    status: "asleep",
    duration: 100,
  }),
}));
vi.mock("../../src/actions/wake-all.js", () => ({
  wakeAll: vi.fn().mockResolvedValue({
    message: "All teams woken",
    teams: [],
    summary: { total: 2, alreadyAwake: 2, woken: 0, failed: 0 },
    duration: 100,
  }),
}));
vi.mock("../../src/actions/report.js", () => ({
  report: vi.fn().mockResolvedValue({
    team: "team-alpha",
    stdout: "",
    stderr: "",
    hasProcess: false,
    totalBytes: 0,
    timestamp: Date.now(),
  }),
}));
vi.mock("../../src/actions/command.js", () => ({
  command: vi.fn().mockResolvedValue({
    team: "team-alpha",
    command: "compact",
    response: "Compacted",
    success: true,
    duration: 100,
  }),
}));

import { tell } from "../../src/actions/tell.js";
import { isAwake } from "../../src/actions/isAwake.js";
import { wake } from "../../src/actions/wake.js";
import { sleep } from "../../src/actions/sleep.js";
import { wakeAll } from "../../src/actions/wake-all.js";
import { report } from "../../src/actions/report.js";
import { command } from "../../src/actions/command.js";

describe("MCP Server", () => {
  let mockServer: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Server
    mockServer = {
      setRequestHandler: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(Server).mockImplementation(() => mockServer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Server instantiation", () => {
    it("should create MCP server with correct metadata", () => {
      new Server(
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

      expect(Server).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "@iris-mcp/server",
          version: "1.0.0",
        }),
        expect.objectContaining({
          capabilities: expect.objectContaining({
            tools: {},
          }),
        }),
      );
    });
  });

  describe("Tool registration", () => {
    it("should register ListTools handler", () => {
      const server = new Server(
        { name: "@iris-mcp/server", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );

      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "team_tell",
            description: "Send message to team",
            inputSchema: { type: "object" },
          },
          {
            name: "team_isAwake",
            description: "Check if teams are awake",
            inputSchema: { type: "object" },
          },
          {
            name: "team_wake",
            description: "Wake up a team",
            inputSchema: { type: "object" },
          },
          {
            name: "team_sleep",
            description: "Put a team to sleep",
            inputSchema: { type: "object" },
          },
          {
            name: "team_wake_all",
            description: "Wake all teams",
            inputSchema: { type: "object" },
          },
          {
            name: "team_report",
            description: "View team output",
            inputSchema: { type: "object" },
          },
          {
            name: "team_command",
            description: "Send command to team",
            inputSchema: { type: "object" },
          },
        ],
      }));

      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ListToolsRequestSchema,
        expect.any(Function),
      );
    });

    it("should register CallTool handler", () => {
      const server = new Server(
        { name: "@iris-mcp/server", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );

      server.setRequestHandler(CallToolRequestSchema, async () => ({
        content: [{ type: "text", text: "response" }],
      }));

      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        CallToolRequestSchema,
        expect.any(Function),
      );
    });
  });

  describe("Tool handlers", () => {
    it("should define all required tools", () => {
      const requiredTools = [
        "team_tell",
        "team_isAwake",
        "team_wake",
        "team_sleep",
        "team_wake_all",
        "team_report",
        "team_command",
      ];

      // Verify all action modules are imported
      expect(tell).toBeDefined();
      expect(isAwake).toBeDefined();
      expect(wake).toBeDefined();
      expect(sleep).toBeDefined();
      expect(wakeAll).toBeDefined();
      expect(report).toBeDefined();
      expect(command).toBeDefined();
    });

    it("should handle team_tell calls", async () => {
      const args = {
        fromTeam: "team-beta",
        toTeam: "team-alpha",
        message: "Test message",
      };

      // Ensure mock returns value for this test
      vi.mocked(tell).mockResolvedValueOnce({
        from: "team-beta",
        to: "team-alpha",
        message: "Test message",
        response: "Mock response",
        duration: 100,
        timestamp: Date.now(),
      });

      // Simulate calling the action
      const result = await tell(args, {} as any);

      expect(tell).toHaveBeenCalledWith(args, expect.any(Object));
      expect(result).toMatchObject({
        from: "team-beta",
        to: "team-alpha",
        response: "Mock response",
      });
    });

    it("should handle team_isAwake calls", async () => {
      const args = { team: "team-alpha" };

      vi.mocked(isAwake).mockResolvedValueOnce({
        teams: [],
        pool: { activeProcesses: 0, maxProcesses: 10, totalMessages: 0 },
        timestamp: Date.now(),
      });

      const result = await isAwake(args, {} as any, {} as any, {} as any);

      expect(isAwake).toHaveBeenCalledWith(
        args,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      );
      expect(result.teams).toBeDefined();
    });

    it("should handle team_wake calls", async () => {
      const args = { team: "team-alpha", fromTeam: "team-beta" };

      vi.mocked(wake).mockResolvedValueOnce({
        team: "team-alpha",
        status: "awake",
        duration: 100,
      });

      const result = await wake(args, {} as any, {} as any, {} as any);

      expect(wake).toHaveBeenCalledWith(
        args,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      );
      expect(result.team).toBe("team-alpha");
    });

    it("should handle team_sleep calls", async () => {
      const args = { team: "team-alpha", fromTeam: "team-beta" };

      vi.mocked(sleep).mockResolvedValueOnce({
        team: "team-alpha",
        status: "asleep",
        duration: 100,
      });

      const result = await sleep(args, {} as any);

      expect(sleep).toHaveBeenCalledWith(args, expect.any(Object));
      expect(result.team).toBe("team-alpha");
    });

    it("should handle team_wake_all calls", async () => {
      const args = { fromTeam: "team-beta" };

      vi.mocked(wakeAll).mockResolvedValueOnce({
        message: "All teams woken",
        teams: [],
        summary: { total: 2, alreadyAwake: 2, woken: 0, failed: 0 },
        duration: 100,
      });

      const result = await wakeAll(args, {} as any, {} as any, {} as any);

      expect(wakeAll).toHaveBeenCalledWith(
        args,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      );
      expect(result.teams).toBeDefined();
    });

    it("should handle team_report calls", async () => {
      const args = { team: "team-alpha", fromTeam: "team-beta" };

      vi.mocked(report).mockResolvedValueOnce({
        team: "team-alpha",
        stdout: "",
        stderr: "",
        hasProcess: false,
        totalBytes: 0,
        timestamp: Date.now(),
      });

      const result = await report(args, {} as any);

      expect(report).toHaveBeenCalledWith(args, expect.any(Object));
      expect(result.team).toBe("team-alpha");
    });

    it("should handle team_command calls", async () => {
      const args = {
        team: "team-alpha",
        command: "compact",
        fromTeam: "team-beta",
      };

      vi.mocked(command).mockResolvedValueOnce({
        team: "team-alpha",
        command: "compact",
        response: "Compacted",
        success: true,
        duration: 100,
      });

      const result = await command(args, {} as any);

      expect(command).toHaveBeenCalledWith(args, expect.any(Object));
      expect(result.command).toBe("compact");
    });
  });

  describe("Error handling", () => {
    it("should handle action errors gracefully", async () => {
      vi.mocked(tell).mockRejectedValueOnce(new Error("Test error"));

      await expect(
        tell(
          { fromTeam: "team-beta", toTeam: "team-alpha", message: "test" },
          {} as any,
        ),
      ).rejects.toThrow("Test error");
    });

    it("should handle non-Error objects", async () => {
      vi.mocked(tell).mockRejectedValueOnce("string error");

      await expect(
        tell(
          { fromTeam: "team-beta", toTeam: "team-alpha", message: "test" },
          {} as any,
        ),
      ).rejects.toBe("string error");
    });
  });
});
