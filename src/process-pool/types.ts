/**
 * Iris MCP - Process Pool Types
 * TypeScript interfaces for process management and team coordination
 */

/**
 * Process Pool Event Names
 * Use enum to prevent typos in event listeners
 */
export enum PoolEvent {
  PROCESS_TERMINATED = "process-terminated",
  PROCESS_ERROR = "process-error",
  HEALTH_CHECK = "health-check",
}

/**
 * Process Status Values
 * Use enum to prevent typos in status checks
 */
export enum ProcessStatus {
  STOPPED = "stopped",
  SPAWNING = "spawning",
  IDLE = "idle",
  PROCESSING = "processing",
  TERMINATING = "terminating",
}

export interface ProcessPoolConfig {
  idleTimeout: number;
  maxProcesses: number;
  healthCheckInterval: number;
  sessionInitTimeout: number;
  spawnTimeout: number;
  responseTimeout: number;
  permissionTimeout?: number; // Timeout for dashboard permission approval (default: 30000ms)
  httpPort?: number;
  defaultTransport?: "stdio" | "http";
  wonderLoggerConfig?: string; // Path to wonder-logger.yaml config file
}

export interface RemoteOptions {
  identity?: string; // Path to SSH private key
  passphrase?: string; // Passphrase for encrypted SSH key
  port?: number; // SSH port
  strictHostKeyChecking?: boolean; // SSH host key checking
  connectTimeout?: number; // Connection timeout in ms
  serverAliveInterval?: number; // Keep-alive interval in seconds
  serverAliveCountMax?: number; // Max missed keep-alives
  compression?: boolean; // Enable SSH compression
  forwardAgent?: boolean; // Forward SSH agent
  extraSshArgs?: string[]; // Additional SSH arguments
}

export interface IrisConfig {
  path: string; // Absolute path to team project directory
  description: string;
  idleTimeout?: number;
  sessionInitTimeout?: number;
  color?: string;
  // Phase 2: Remote execution via SSH
  remote?: string; // SSH connection string (e.g., "user@host" or "ssh inanna")
  ssh2?: boolean; // Use ssh2 library instead of OpenSSH client (default: false)
  remoteOptions?: RemoteOptions;
  claudePath?: string; // Custom path to Claude CLI executable (default: "claude", supports ~ expansion)
  // Reverse MCP tunneling
  enableReverseMcp?: boolean; // Enable reverse MCP tunnel for this team
  reverseMcpPort?: number; // Port to tunnel (default: 1615)
  allowHttp?: boolean; // Allow HTTP for reverse MCP (dev only, default: false)
  mcpConfigScript?: string; // Custom script path for writing MCP config files (default: bundled mcp-cp.sh or mcp-scp.sh)
  // Permission approval mode
  grantPermission?: "yes" | "no" | "ask" | "forward"; // How to handle permission requests (default: "yes" for auto-approve)
  // Tool allowlist/denylist
  allowedTools?: string; // Comma-separated list of allowed MCP tools (passed to Claude CLI --allowed-tools flag)
  disallowedTools?: string; // Comma-separated list of denied MCP tools (passed to Claude CLI --disallowed-tools flag)
  // System prompt customization
  appendSystemPrompt?: string; // Additional system prompt to append (passed to Claude CLI --append-system-prompt flag)
}

export interface DashboardConfig {
  enabled: boolean;
  host: string;
  http: number; // HTTP port (0 = disabled)
  https: number; // HTTPS port (0 = disabled)
  selfsigned: boolean; // Use self-signed certificate for HTTPS
  certPath?: string; // Path to SSL certificate file (required if https enabled and selfsigned=false)
  keyPath?: string; // Path to SSL private key file (required if https enabled and selfsigned=false)
  forkScriptPath?: string; // Path to fork.sh/bat script (runtime detected)
}

export interface DatabaseConfig {
  path?: string; // Path to database file (relative to IRIS_HOME or absolute). Defaults to 'data/team-sessions.db'
  inMemory?: boolean; // Use in-memory database (for testing). Defaults to false
}

export interface TeamsConfig {
  settings: ProcessPoolConfig;
  dashboard?: DashboardConfig;
  database?: DatabaseConfig;
  teams: Record<string, IrisConfig>;
}

export interface ProcessMessage {
  message: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export interface ProcessMetrics {
  pid: number | undefined;
  status: ProcessStatus;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  idleTimeRemaining: number;
  queueLength: number;
  sessionId: string;
  messageCount: number;
  lastActivity: number;
}

export interface ProcessPoolStatus {
  totalProcesses: number;
  maxProcesses: number;
  processes: Record<string, ProcessMetrics>;
  activeSessions: number;
}
