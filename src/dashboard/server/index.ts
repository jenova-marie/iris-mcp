/**
 * Iris MCP Dashboard - Express Server
 * Serves React SPA and provides REST API + WebSocket for real-time updates
 */

import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import { Server as SocketIOServer } from 'socket.io';
import { readFileSync, existsSync } from 'fs';
import selfsigned from 'selfsigned';
import type { DashboardStateBridge } from './state-bridge.js';
import { createConfigRouter } from './routes/config.js';
import { createProcessesRouter } from './routes/processes.js';
import { getChildLogger } from '../../utils/logger.js';
import type { DashboardConfig } from '../../process-pool/types.js';

const logger = getChildLogger('dashboard:server');

export async function startDashboardServer(
  bridge: DashboardStateBridge,
  config: DashboardConfig,
): Promise<void> {
  const app = express();

  // Track servers separately
  let httpServer: HttpServer | undefined;
  let httpsServer: HttpsServer | undefined;

  // HTTP server (if enabled)
  if (config.http > 0) {
    httpServer = createHttpServer(app);
  }

  // HTTPS server (if enabled)
  if (config.https > 0) {
    let httpsOptions;

    if (config.selfsigned) {
      // Generate self-signed certificate
      logger.info('Generating self-signed SSL certificate...');
      const attrs = [{ name: 'commonName', value: config.host }];
      const pems = selfsigned.generate(attrs, {
        keySize: 2048,
        days: 365,
        algorithm: 'sha256',
        extensions: [
          {
            name: 'basicConstraints',
            cA: true,
          },
          {
            name: 'keyUsage',
            keyCertSign: true,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true,
          },
          {
            name: 'subjectAltName',
            altNames: [
              {
                type: 2, // DNS
                value: config.host,
              },
              {
                type: 2,
                value: 'localhost',
              },
              {
                type: 7, // IP
                ip: '127.0.0.1',
              },
            ],
          },
        ],
      });

      httpsOptions = {
        key: pems.private,
        cert: pems.cert,
      };

      logger.info('Self-signed certificate generated');
    } else {
      // Use provided certificate files
      if (!config.certPath || !config.keyPath) {
        throw new Error('HTTPS enabled but certPath and keyPath not provided');
      }

      if (!existsSync(config.certPath)) {
        throw new Error(`SSL certificate file not found: ${config.certPath}`);
      }

      if (!existsSync(config.keyPath)) {
        throw new Error(`SSL private key file not found: ${config.keyPath}`);
      }

      logger.info({
        certPath: config.certPath,
        keyPath: config.keyPath,
      }, 'Loading SSL certificate files');

      httpsOptions = {
        key: readFileSync(config.keyPath),
        cert: readFileSync(config.certPath),
      };
    }

    httpsServer = createHttpsServer(httpsOptions, app);
  }

  // Socket.IO for WebSocket connections (use first available server)
  const firstServer = httpServer || httpsServer;
  if (!firstServer) {
    throw new Error('No servers configured - at least HTTP or HTTPS must be enabled');
  }

  const io = new SocketIOServer(firstServer, {
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
    logger.info({
      socketId: socket.id,
    }, 'Dashboard client connected');

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
      logger.info({ sessionId, socketId: socket.id }, 'Client requested cache stream');
      const started = bridge.streamSessionCache(sessionId);

      if (!started) {
        socket.emit('error', {
          message: `Failed to start cache stream for session: ${sessionId}`,
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info({
        socketId: socket.id,
      }, 'Dashboard client disconnected');

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
    logger.error({
      err: err instanceof Error ? err : new Error(String(err))
    }, 'Express error');

    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  });

  // Start servers
  return new Promise((resolve, reject) => {
    const startPromises: Promise<void>[] = [];

    // Start HTTP server
    if (config.http > 0 && httpServer) {
      startPromises.push(
        new Promise<void>((httpResolve, httpReject) => {
          httpServer.listen(config.http, config.host, () => {
            logger.info({
              host: config.host,
              port: config.http,
              url: `http://${config.host}:${config.http}`,
            }, 'HTTP server started');
            httpResolve();
          });

          httpServer.on('error', (error) => {
            logger.error({
              err: error instanceof Error ? error : new Error(String(error))
            }, 'Failed to start HTTP server');
            httpReject(error);
          });
        })
      );
    }

    // Start HTTPS server
    if (config.https > 0 && httpsServer) {
      startPromises.push(
        new Promise<void>((httpsResolve, httpsReject) => {
          httpsServer.listen(config.https, config.host, () => {
            logger.info({
              host: config.host,
              port: config.https,
              url: `https://${config.host}:${config.https}`,
              selfsigned: config.selfsigned,
            }, 'HTTPS server started');
            httpsResolve();
          });

          httpsServer.on('error', (error) => {
            logger.error({
              err: error instanceof Error ? error : new Error(String(error))
            }, 'Failed to start HTTPS server');
            httpsReject(error);
          });
        })
      );
    }

    // Wait for all servers to start
    Promise.all(startPromises)
      .then(() => resolve())
      .catch(reject);
  });
}
