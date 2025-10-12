/**
 * WebSocket hook for real-time updates
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3100';

export interface ProcessStatus {
  teamName: string;
  status: string;
  pid?: number;
  uptime?: number;
  lastActivity?: number;
}

export interface CacheStreamData {
  teamName: string;
  type: 'stdout' | 'stderr';
  line: string;
}

export interface WebSocketState {
  connected: boolean;
  socket: Socket | null;
}

export function useWebSocket(onProcessStatus?: (data: ProcessStatus) => void, onCacheStream?: (data: CacheStreamData) => void) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

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
      if (onProcessStatus) {
        onProcessStatus(data);
      }
    });

    socket.on('cache-stream', (data: CacheStreamData) => {
      console.log('[WebSocket] Cache stream data', data);
      if (onCacheStream) {
        onCacheStream(data);
      }
    });

    socket.on('config-saved', (data: any) => {
      console.log('[WebSocket] Config saved', data);
    });

    socket.on('error', (error: any) => {
      console.error('[WebSocket] Error', error);
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, [onProcessStatus, onCacheStream]);

  const streamCache = (teamName: string) => {
    if (socketRef.current && connected) {
      console.log('[WebSocket] Requesting cache stream for', teamName);
      socketRef.current.emit('stream-cache', teamName);
    }
  };

  return {
    connected,
    socket: socketRef.current,
    streamCache,
  };
}
