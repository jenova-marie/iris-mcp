/**
 * Iris MCP - Process Pool Types
 * TypeScript interfaces for process management and team coordination
 */

export interface ProcessPoolConfig {
  idleTimeout: number;
  maxProcesses: number;
  healthCheckInterval: number;
  sessionInitTimeout: number;
  spawnTimeout: number;
  responseTimeout: number;
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
  skipPermissions?: boolean;
  color?: string;
  // Phase 2: Remote execution via SSH
  remote?: string; // SSH connection string (e.g., "user@host" or "ssh inanna")
  ssh2?: boolean; // Use ssh2 library instead of OpenSSH client (default: false)
  remoteOptions?: RemoteOptions;
  claudePath?: string; // Custom path to Claude CLI executable (default: "claude", supports ~ expansion)
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

export type ProcessStatus =
  | "spawning"
  | "idle"
  | "processing"
  | "terminating"
  | "stopped";

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
