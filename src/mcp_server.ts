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
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { getConfigManager } from "./config/iris-config.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { PoolEvent } from "./process-pool/types.js";
import { SessionManager } from "./session/session-manager.js";
import { IrisOrchestrator } from "./iris.js";
import { getChildLogger } from "./utils/logger.js";
import { PendingPermissionsManager } from "./permissions/pending-manager.js";
import { getIrisHome, getConfigPath, getDataDir } from "./utils/paths.js";
import { tell } from "./actions/tell.js";
import { quickTell } from "./actions/quick_tell.js";
import { cancel } from "./actions/cancel.js";
import { reboot } from "./actions/reboot.js";
import { deleteSession } from "./actions/delete.js";
import { fork } from "./actions/fork.js";
import { isAwake } from "./actions/isAwake.js";
import { wake } from "./actions/wake.js";
import { sleep } from "./actions/sleep.js";
import { wakeAll } from "./actions/wake-all.js";
import { report } from "./actions/report.js";
import { teams } from "./actions/teams.js";
import { debug } from "./actions/debug.js";
import { permissionsApprove } from "./actions/permissions.js";
import { date } from "./actions/date.js";
import { agent, AGENT_TYPES } from "./actions/agent.js";
import { runWithContext } from "./utils/request-context.js";

const logger = getChildLogger("iris:mcp");

// MCP Tool Definitions
const TOOLS: Tool[] = [
  {
    name: "send_message",
    description:
      "Send a message to a team and wait for response. Use this for communication that requires acknowledgment or when you need to wait for the team to complete a task.",
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
    name: "quick_message",
    description:
      "Quickly send a message to a team without waiting (async/fire-and-forget). " +
      "Returns immediately after queuing the message. " +
      "Use when you want to notify a team but don't need to wait for their response. " +
      'Perfect for phrases like "quickly tell team-X to..." or "notify team-Y that..."',
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
    name: "ask_message",
    description:
      "Ask a question to a team and wait for their response. " +
      "This is a semantic alias for send_message that makes it clear you're expecting an answer. " +
      'Use for phrases like "ask team-X about..." or "ask team-Y to explain..."',
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description:
            'Name of the team to ask (e.g., "frontend", "backend", "mobile")',
        },
        message: {
          type: "string",
          description: "The question or request to send",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team asking the question",
        },
        timeout: {
          type: "number",
          description:
            "Optional timeout in milliseconds (default: 30000). 0 to wait indefinitely.",
        },
        persist: {
          type: "boolean",
          description:
            "Use persistent queue (default: false). When true, message is queued in SQLite.",
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
    name: "session_reboot",
    description:
      "Reboot a session to start fresh with a clean slate. " +
      "Creates a brand new session with new UUID, terminating the existing process and deleting old session data. " +
      "Use when you want to restart the conversation, clear history, or reset after context has become too large or confused.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description: "Name of the team whose session to reboot",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the reboot",
        },
      },
      required: ["toTeam", "fromTeam"],
    },
  },
  {
    name: "session_delete",
    description:
      "Delete a session permanently. " +
      "Terminates the process and removes the session data completely without creating a replacement. " +
      "Use when you want to completely remove a session and don't need a fresh one.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description: "Name of the team whose session to delete",
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
    name: "session_fork",
    description:
      "Fork a session into a new terminal window for manual interaction. " +
      "Launches a separate terminal with 'claude --resume --fork-session' so you can interact with the session directly. " +
      "Executes the user-configured fork script (~/.iris/spawn.sh or ps1). Works for both local and remote teams.",
    inputSchema: {
      type: "object",
      properties: {
        toTeam: {
          type: "string",
          description: "Name of the team whose session to fork",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the fork",
        },
      },
      required: ["toTeam", "fromTeam"],
    },
  },
  {
    name: "team_status",
    description:
      "Get the status of teams (awake/active or asleep/inactive). " +
      "Returns process details for active teams including PID, status, and session information. " +
      "Optionally includes notification queue statistics.",
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
    name: "team_launch",
    description:
      "Launch a team by ensuring its process is active. " +
      "This is a convenience alias for team_wake that matches natural language like 'launch team-X' or 'start team-Y'. " +
      "Returns immediately if team is already active, otherwise starts the process.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description:
            'Name of the team to launch (e.g., "frontend", "backend", "mobile")',
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
    name: "session_report",
    description:
      "View the conversation history for a session. " +
      "Returns complete conversation cache including all messages, responses, and protocol messages from Claude. " +
      "Shows the full context of your communication with a team.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Name of the team whose conversation to view",
        },
        fromTeam: {
          type: "string",
          description: "Name of the team requesting the report",
        },
      },
      required: ["team", "fromTeam"],
    },
  },
  {
    name: "session_cancel",
    description:
      "Cancel a running session operation. " +
      "Attempts to interrupt a long-running Claude operation by sending ESC to stdin. " +
      "Note: May not work in all cases depending on headless mode support.",
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
    name: "list_teams",
    description:
      "List all configured teams. " +
      "Returns team names with configuration details including path, description, color, and settings.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_logs",
    description:
      "Query in-memory logs from the Iris MCP server. " +
      "Returns logs since a specified timestamp with optional filtering by level and format. " +
      "Useful for debugging and monitoring server activity.",
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
  {
    name: "permissions__approve",
    description:
      "Permission approval handler for Claude Code's --permission-prompt-tool feature. " +
      "This tool is called by Claude Code when it needs permission to use another tool. " +
      "Auto-approves all Iris MCP tools (mcp__iris__*) and denies all others.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description:
            "The name of the tool requesting permission (e.g., 'mcp__iris__team_teams')",
        },
        input: {
          type: "object",
          description: "The input parameters for the tool being requested",
        },
        reason: {
          type: "string",
          description:
            "Optional reason provided by Claude for why it needs permission",
        },
      },
      required: ["tool_name", "input"],
    },
  },
  {
    name: "get_date",
    description:
      "Get the current system date and time. " +
      "Returns timestamp in multiple formats: ISO 8601, UTC string, Unix timestamp, and detailed components (year, month, day, etc.).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_agent",
    description:
      "Get a canned prompt for a specialized agent role. " +
      `Available agent types: ${AGENT_TYPES.join(", ")}. ` +
      "Returns prompt text that can be executed by the calling agent to adopt that specialized role. " +
      "Useful for delegating tasks to specialized agent personas.",
    inputSchema: {
      type: "object",
      properties: {
        agentType: {
          type: "string",
          description: `Type of agent to get prompt for. Available: ${AGENT_TYPES.join(", ")}`,
          enum: [...AGENT_TYPES],
        },
        context: {
          type: "object",
          description:
            "Optional context variables to interpolate into the template (e.g., {projectName: 'iris-mcp', version: '1.0'})",
        },
      },
      required: ["agentType"],
    },
  },
];

export class IrisMcpServer {
  private server: Server;
  private configManager: ReturnType<typeof getConfigManager>;
  private sessionManager: SessionManager;
  private processPool: ClaudeProcessPool;
  private iris: IrisOrchestrator;
  private pendingPermissions: PendingPermissionsManager;

  constructor(
    sessionManager: SessionManager,
    processPool: ClaudeProcessPool,
    configManager: ReturnType<typeof getConfigManager>,
  ) {
    this.server = new Server(
      {
        name: "@iris-mcp/server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      },
    );

    // Store shared components
    this.sessionManager = sessionManager;
    this.processPool = processPool;
    this.configManager = configManager;

    // Initialize pending permissions manager
    const permissionTimeout =
      this.configManager.getConfig().settings?.permissionTimeout || 30000;
    this.pendingPermissions = new PendingPermissionsManager(permissionTimeout);

    // Initialize Iris orchestrator (BLL)
    this.iris = new IrisOrchestrator(
      this.sessionManager,
      this.processPool,
      this.configManager.getConfig(),
      this.pendingPermissions,
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

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = AGENT_TYPES.map((agentType) => ({
        name: agentType,
        description: `Get specialized prompt for ${agentType.replace(/-/g, ' ')} agent role`,
        arguments: [
          {
            name: "projectPath",
            description: "Optional path to project for context discovery (auto-detects TypeScript, framework, testing tools, etc.)",
            required: false,
          },
          {
            name: "includeGitDiff",
            description: "Include git diff of uncommitted changes in the prompt context",
            required: false,
          },
        ],
      }));

      return { prompts };
    });

    // Get specific prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Validate agent type
      if (!AGENT_TYPES.includes(name as any)) {
        throw new Error(
          `Invalid agent type "${name}". Available types: ${AGENT_TYPES.join(", ")}`,
        );
      }

      // Build agent input from prompt arguments
      const agentInput: any = {
        agentType: name,
      };

      if (args?.projectPath) {
        agentInput.projectPath = args.projectPath as string;
      }

      if (args?.includeGitDiff === "true" || args?.includeGitDiff === "1") {
        agentInput.includeGitDiff = true;
      }

      // Get the agent prompt
      const result = await agent(agentInput);

      if (!result.valid) {
        throw new Error(result.prompt);
      }

      // Return as MCP prompt message
      return {
        description: `Specialized ${name.replace(/-/g, ' ')} agent prompt${agentInput.projectPath ? ' with project context' : ''}${agentInput.includeGitDiff ? ' and git diff' : ''}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: result.prompt,
            },
          },
        ],
      };
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
          case "send_message":
          case "ask_message":
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

          case "quick_message":
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

          case "session_cancel":
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

          case "session_reboot":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await reboot(
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

          case "session_delete":
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

          // TODO: Implement team_compact action
          // case "team_compact":
          //   result = {
          //     content: [
          //       {
          //         type: "text",
          //         text: JSON.stringify(
          //           await compact(
          //             args as any,
          //             this.iris,
          //             this.sessionManager,
          //             this.configManager,
          //           ),
          //           null,
          //           2,
          //         ),
          //       },
          //     ],
          //   };
          //   break;

          case "session_fork":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await fork(
                      args as any,
                      this.iris,
                      this.sessionManager,
                      this.processPool,
                      this.configManager,
                    ),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "team_status":
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
          case "team_launch":
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

          case "session_report":
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

          case "list_teams":
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

          case "get_logs":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(await debug(args as any), null, 2),
                },
              ],
            };
            break;

          case "permissions__approve":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await permissionsApprove(args as any, this.iris),
                    null,
                    2,
                  ),
                },
              ],
            };
            break;

          case "get_date":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(await date(args as any), null, 2),
                },
              ],
            };
            break;

          case "get_agent":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(await agent(args as any), null, 2),
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

  /**
   * Get the PendingPermissionsManager instance
   * Used by dashboard bridge to access pending permissions
   */
  getPendingPermissions(): PendingPermissionsManager {
    return this.pendingPermissions;
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

      // Handle MCP requests with session-specific paths (for reverse MCP tunneling)
      // Remote teams connect to /mcp/{sessionId} where sessionId maps to the process
      app.all("/mcp/:sessionId", async (req, res) => {
        const sessionId = req.params.sessionId;

        logger.debug(
          {
            method: req.method,
            sessionId,
            body: req.body,
            headers: req.headers,
          },
          "Received HTTP request for session-specific MCP path",
        );

        // Lookup process from pool using sessionId
        const process = this.processPool.getProcessBySessionId(sessionId);
        if (!process) {
          logger.warn({ sessionId }, "Session not found in process pool");
          return res.status(404).json({
            jsonrpc: "2.0",
            error: {
              code: -32602,
              message: `Session not found: ${sessionId}`,
            },
            id: req.body?.id || null,
          });
        }

        logger.info(
          {
            sessionId,
            teamName: process.teamName,
          },
          "Resolved team from session",
        );

        try {
          // Run with AsyncLocalStorage context so permissions__approve can access sessionId
          await runWithContext({ sessionId }, async () => {
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
          });
        } catch (error) {
          logger.error(
            {
              err: error instanceof Error ? error : new Error(String(error)),
              sessionId,
            },
            "Error handling session-specific MCP request",
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
