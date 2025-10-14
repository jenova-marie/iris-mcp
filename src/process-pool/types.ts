/**
 * Iris MCP - Process Pool Types
 * TypeScript interfaces for process management and team coordination
 */

export interface ProcessPoolConfig {
  idleTimeout: number;
  maxProcesses: number;
  healthCheckInterval: number;
  sessionInitTimeout: number;
  responseTimeout: number;
  httpPort?: number;
  defaultTransport?: "stdio" | "http";
  wonderLoggerConfig?: string; // Path to wonder-logger.yaml config file
}

export interface TeamConfig {
  path: string; // Absolute path to team project directory
  description: string;
  idleTimeout?: number;
  sessionInitTimeout?: number;
  skipPermissions?: boolean;
  color?: string;
}

export interface DashboardConfig {
  enabled: boolean;
  port: number;
  host: string;
}

export interface TeamsConfig {
  settings: ProcessPoolConfig;
  dashboard?: DashboardConfig;
  teams: Record<string, TeamConfig>;
}

export interface ProcessMessage {
  message: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export type ProcessStatus =
  | 'spawning'
  | 'idle'
  | 'processing'
  | 'terminating'
  | 'stopped';

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
