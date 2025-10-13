/**
 * Iris MCP Dashboard - Express Server
 * Serves React SPA and provides REST API + WebSocket for real-time updates
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { DashboardStateBridge } from './state-bridge.js';
import { createConfigRouter } from './routes/config.js';
import { createProcessesRouter } from './routes/processes.js';
import { Logger } from '../../utils/logger.js';
import type { DashboardConfig } from '../../process-pool/types.js';

const logger = new Logger('dashboard-server');

export async function startDashboardServer(
  bridge: DashboardStateBridge,
  config: DashboardConfig,
): Promise<void> {
  const app = express();
  const httpServer = createServer(app);

  // Socket.IO for WebSocket connections
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*', // Allow all origins for now (localhost only anyway)
      methods: ['GET', 'POST'],
    },
    path: '/ws',
  });

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Request logging
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: Date.now(),
    });
  });

  // API routes
  app.use('/api/config', createConfigRouter(bridge));
  app.use('/api/processes', createProcessesRouter(bridge));

  // WebSocket connection handling
  io.on('connection', (socket) => {
    logger.info('Dashboard client connected', {
      socketId: socket.id,
    });

    // Send initial state
    socket.emit('init', {
      sessions: bridge.getActiveSessions(),
      poolStatus: bridge.getPoolStatus(),
      config: bridge.getConfig(),
    });

    // Subscribe to process status updates
    const processStatusHandler = (data: any) => {
      socket.emit('process-status', data);
    };

    const configSavedHandler = (data: any) => {
      socket.emit('config-saved', data);
    };

    const cacheStreamHandler = (data: any) => {
      socket.emit('cache-stream', data);
    };

    // Register event handlers
    bridge.on('ws:process-status', processStatusHandler);
    bridge.on('ws:config-saved', configSavedHandler);
    bridge.on('ws:cache-stream', cacheStreamHandler);

    // Handle client requests to stream cache for a specific session
    socket.on('stream-cache', (sessionId: string) => {
      logger.info('Client requested cache stream', { sessionId, socketId: socket.id });
      const started = bridge.streamSessionCache(sessionId);

      if (!started) {
        socket.emit('error', {
          message: `Failed to start cache stream for session: ${sessionId}`,
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info('Dashboard client disconnected', {
        socketId: socket.id,
      });

      // Clean up event handlers
      bridge.off('ws:process-status', processStatusHandler);
      bridge.off('ws:config-saved', configSavedHandler);
      bridge.off('ws:cache-stream', cacheStreamHandler);
    });
  });

  // Serve static files (React build)
  // Serves from dist/dashboard/public (must run `pnpm build` first)
  // For development with hot reload, use: pnpm dev:client (separate Vite server)
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicPath = path.join(__dirname, '../public');

  app.use(express.static(publicPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(publicPath, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // Error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Express error', err);

    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  });

  // Start server
  return new Promise((resolve, reject) => {
    httpServer.listen(config.port, config.host, () => {
      logger.info('Dashboard server started', {
        host: config.host,
        port: config.port,
        url: `http://${config.host}:${config.port}`,
      });
      resolve();
    });

    httpServer.on('error', (error) => {
      logger.error('Failed to start dashboard server', error);
      reject(error);
    });
  });
}
