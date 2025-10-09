/**
 * Iris MCP - Process Pool Types
 * TypeScript interfaces for process management and team coordination
 */

export interface ProcessPoolConfig {
  idleTimeout: number;
  maxProcesses: number;
  healthCheckInterval: number;
}

export interface TeamConfig {
  path: string;
  description: string;
  idleTimeout?: number;
  skipPermissions?: boolean;
  color?: string;
}

export interface TeamsConfig {
  settings: ProcessPoolConfig;
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
}

export interface ProcessPoolStatus {
  totalProcesses: number;
  maxProcesses: number;
  processes: Record<string, ProcessMetrics>;
}
