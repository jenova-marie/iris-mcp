/**
 * WebSocket hook for real-time updates
 * Session-based architecture (fromTeam->toTeam)
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3100';

export interface ProcessStatus {
  poolKey: string; // "fromTeam->toTeam"
  fromTeam: string;
  toTeam: string;
  sessionId: string;
  status: string;
  pid?: number;
  messagesProcessed: number;
  lastUsed: number;
  uptime: number;
  queueLength: number;
  messageCount: number;
}

export interface CacheStreamData {
  sessionId: string;
  type: "user" | "assistant" | "tool_use" | "tool_result" | "stdout" | "stderr" | "event";
  content: any;
  timestamp: number;
}

export interface PendingPermissionRequest {
  permissionId: string;
  sessionId: string;
  teamName: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  reason?: string;
  createdAt: string;
}

export interface ParsedLogEntry {
  timestamp: number;
  level: string;
  context?: string;
  message: string;
  [key: string]: any;
}

export interface LogBatchData {
  logs: ParsedLogEntry[];
  storeName?: string;
  timestamp: number;
}

export interface WebSocketState {
  connected: boolean;
  socket: Socket | null;
}

export function useWebSocket(
  onProcessStatus?: (data: ProcessStatus) => void,
  onCacheStream?: (data: CacheStreamData) => void,
  onPermissionRequest?: (data: PendingPermissionRequest) => void,
  onLogBatch?: (data: LogBatchData) => void,
) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // Store callbacks in refs so they can be updated without reconnecting
  const onProcessStatusRef = useRef(onProcessStatus);
  const onCacheStreamRef = useRef(onCacheStream);
  const onPermissionRequestRef = useRef(onPermissionRequest);
  const onLogBatchRef = useRef(onLogBatch);

  // Update refs on each render
  useEffect(() => {
    onProcessStatusRef.current = onProcessStatus;
    onCacheStreamRef.current = onCacheStream;
    onPermissionRequestRef.current = onPermissionRequest;
    onLogBatchRef.current = onLogBatch;
  });

  useEffect(() => {
    // Connect to WebSocket
    const socket = io(WS_URL, {
      path: '/ws',
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WebSocket] Connected');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
      setConnected(false);
    });

    socket.on('init', (data) => {
      console.log('[WebSocket] Initial state received', data);
    });

    socket.on('process-status', (data: ProcessStatus) => {
      console.log('[WebSocket] Process status update', data);
      if (onProcessStatusRef.current) {
        onProcessStatusRef.current(data);
      }
    });

    socket.on('cache-stream', (data: CacheStreamData) => {
      console.log('[WebSocket] Cache stream data', data);
      if (onCacheStreamRef.current) {
        onCacheStreamRef.current(data);
      }
    });

    socket.on('config-saved', (data: any) => {
      console.log('[WebSocket] Config saved', data);
    });

    socket.on('permission:request', (data: PendingPermissionRequest) => {
      console.log('[WebSocket] Permission request', data);
      if (onPermissionRequestRef.current) {
        onPermissionRequestRef.current(data);
      }
    });

    socket.on('permission:resolved', (data: any) => {
      console.log('[WebSocket] Permission resolved', data);
    });

    socket.on('permission:timeout', (data: any) => {
      console.log('[WebSocket] Permission timeout', data);
    });

    // Log streaming events
    socket.on('logs:batch', (data: LogBatchData) => {
      console.log('[WebSocket] Log batch received', data.logs.length, 'logs');
      if (onLogBatchRef.current) {
        onLogBatchRef.current(data);
      }
    });

    socket.on('logs:stores', (data: { stores: string[] }) => {
      console.log('[WebSocket] Log stores', data.stores);
    });

    socket.on('logs:error', (error: { message: string }) => {
      console.error('[WebSocket] Log error', error);
    });

    socket.on('error', (error: any) => {
      console.error('[WebSocket] Error', error);
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []); // Empty deps - connect once, callbacks updated via refs

  const streamCache = (sessionId: string) => {
    if (socketRef.current && connected) {
      console.log('[WebSocket] Requesting cache stream for', sessionId);
      socketRef.current.emit('stream-cache', sessionId);
    }
  };

  const respondToPermission = (permissionId: string, approved: boolean, reason?: string) => {
    if (socketRef.current && connected) {
      console.log('[WebSocket] Responding to permission', { permissionId, approved, reason });
      socketRef.current.emit('permission:response', {
        permissionId,
        approved,
        reason,
      });
    }
  };

  const startLogStream = (options?: { storeName?: string; level?: string | string[] }) => {
    if (socketRef.current && connected) {
      console.log('[WebSocket] Starting log stream', options);
      socketRef.current.emit('logs:start', options || {});
    }
  };

  const stopLogStream = () => {
    if (socketRef.current && connected) {
      console.log('[WebSocket] Stopping log stream');
      socketRef.current.emit('logs:stop');
    }
  };

  const getLogStores = () => {
    if (socketRef.current && connected) {
      console.log('[WebSocket] Requesting log stores');
      socketRef.current.emit('logs:get-stores');
    }
  };

  return {
    connected,
    socket: socketRef.current,
    streamCache,
    respondToPermission,
    startLogStream,
    stopLogStream,
    getLogStores,
  };
}
