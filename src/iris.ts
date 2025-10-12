/**
 * Iris Orchestrator - Business Logic Layer
 *
 * Coordinates SessionManager and PoolManager to provide high-level
 * team-to-team communication operations.
 *
 * This layer sits between the MCP transport (index.ts) and the
 * infrastructure components (SessionManager, PoolManager).
 */

import { SessionManager } from "./session/session-manager.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { AsyncQueue } from "./async/queue.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("iris");

export interface SendMessageOptions {
  timeout?: number;
  waitForResponse?: boolean;
}

export interface IrisStatus {
  sessions: {
    total: number;
    active: number;
  };
  processes: {
    total: number;
    maxProcesses: number;
  };
}

/**
 * Iris Orchestrator - Coordinates SessionManager and PoolManager
 *
 * Provides business logic for:
 * - Team-to-team messaging
 * - Session lifecycle management
 * - Process pool coordination
 * - Status reporting
 */
export class IrisOrchestrator {
  private asyncQueue: AsyncQueue;

  constructor(
    private sessionManager: SessionManager,
    private processPool: ClaudeProcessPool,
  ) {
    this.asyncQueue = new AsyncQueue(this);
  }

  /**
   * Send a message from one team to another
   *
   * Orchestrates:
   * 1. Get or create session for team pair
   * 2. Get or create process with session ID
   * 3. Check if process is spawning (return "Session starting...")
   * 4. Send message and return response
   * 5. Track session usage and message count
   *
   * @param fromTeam - Sending team (null for external)
   * @param toTeam - Receiving team
   * @param message - Message content
   * @param options - Send options (timeout, waitForResponse)
   * @returns Response from Claude or "Session starting..." if spawning
   */
  async sendMessage(
    fromTeam: string | null,
    toTeam: string,
    message: string,
    options: SendMessageOptions = {},
  ): Promise<string> {
    const { timeout = 30000, waitForResponse = true } = options;

    logger.info("Sending message", {
      fromTeam,
      toTeam,
      messageLength: message.length,
      timeout,
    });

    // Step 1: Get or create session for team pair
    const session = await this.sessionManager.getOrCreateSession(
      fromTeam,
      toTeam,
    );

    logger.debug("Session obtained", {
      sessionId: session.sessionId,
      fromTeam: session.fromTeam,
      toTeam: session.toTeam,
    });

    // Step 2: Get or create process with session ID
    const process = await this.processPool.getOrCreateProcess(
      toTeam,
      session.sessionId,
      fromTeam,
    );

    // Step 3: Check if process is still spawning
    const metrics = process.getMetrics();
    if (metrics.status === "spawning") {
      logger.info("Process is spawning, returning early", {
        sessionId: session.sessionId,
        toTeam,
      });
      return "Session starting... Please retry your request in a moment.";
    }

    if (!waitForResponse) {
      // Fire-and-forget mode
      logger.debug("Fire-and-forget mode, not waiting for response");
      process.sendMessage(message, timeout).catch((error) => {
        logger.error("Fire-and-forget message failed", {
          error: error instanceof Error ? error.message : String(error),
          sessionId: session.sessionId,
        });
      });

      // Track usage even for fire-and-forget
      this.sessionManager.recordUsage(session.sessionId);
      this.sessionManager.incrementMessageCount(session.sessionId);

      return "Message sent (fire-and-forget mode)";
    }

    // Step 4: Send message and wait for response
    try {
      const response = await process.sendMessage(message, timeout);

      // Step 5: Track session usage and message count
      this.sessionManager.recordUsage(session.sessionId);
      this.sessionManager.incrementMessageCount(session.sessionId);

      logger.info("Message sent successfully", {
        sessionId: session.sessionId,
        responseLength: response.length,
      });

      return response;
    } catch (error) {
      logger.error("Failed to send message", {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.sessionId,
        toTeam,
      });
      throw error;
    }
  }

  /**
   * Ask a question to a team (convenience wrapper for sendMessage)
   *
   * @param fromTeam - Asking team (null for external)
   * @param toTeam - Team to ask
   * @param question - Question content
   * @param timeout - Optional timeout in ms
   * @returns Answer from Claude
   */
  async ask(
    fromTeam: string | null,
    toTeam: string,
    question: string,
    timeout?: number,
  ): Promise<string> {
    return this.sendMessage(fromTeam, toTeam, question, {
      timeout,
      waitForResponse: true,
    });
  }

  /**
   * Get system status
   *
   * @returns Status of sessions and processes
   */
  getStatus(): IrisStatus {
    const sessionStats = this.sessionManager.getStats();
    const poolStatus = this.processPool.getStatus();

    return {
      sessions: {
        total: sessionStats.total,
        active: sessionStats.active,
      },
      processes: {
        total: poolStatus.totalProcesses,
        maxProcesses: poolStatus.maxProcesses,
      },
    };
  }

  /**
   * Get detailed process pool status
   */
  getProcessPoolStatus() {
    return this.processPool.getStatus();
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string) {
    return this.sessionManager.getSessionById(sessionId);
  }

  /**
   * List sessions with optional filters
   */
  listSessions(filters?: any) {
    return this.sessionManager.listSessions(filters);
  }

  /**
   * Send command to a session (e.g., /compact)
   */
  async sendCommandToSession(
    sessionId: string,
    command: string,
  ): Promise<string | null> {
    return this.processPool.sendCommandToSession(sessionId, command);
  }

  /**
   * Get the async queue for direct access (e.g., stats, enqueueing)
   */
  getAsyncQueue(): AsyncQueue {
    return this.asyncQueue;
  }

  /**
   * Check if a team is "awake" (has a live, ready process)
   *
   * A team is considered awake if:
   * 1. It has an active session
   * 2. It has an active process in the pool
   * 3. The process status is NOT "spawning" or "stopped"
   *
   * @param fromTeam - Source team (null for external)
   * @param toTeam - Target team to check
   * @returns true if team has a ready process, false otherwise
   */
  isAwake(fromTeam: string | null, toTeam: string): boolean {
    // Check if session exists
    const session = this.sessionManager.getSession(fromTeam, toTeam);
    if (!session) {
      logger.debug("Team not awake: no session", { fromTeam, toTeam });
      return false;
    }

    // Check if process exists for this session
    const process = this.processPool.getProcessBySessionId(session.sessionId);
    if (!process) {
      logger.debug("Team not awake: no process", { fromTeam, toTeam, sessionId: session.sessionId });
      return false;
    }

    const metrics = process.getMetrics();
    const isReady = metrics.status !== "spawning" && metrics.status !== "stopped";

    logger.debug("Team awake check", {
      fromTeam,
      toTeam,
      sessionId: session.sessionId,
      status: metrics.status,
      isReady,
    });

    return isReady;
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Iris orchestrator");
    this.asyncQueue.shutdown();
    await this.processPool.terminateAll();
    this.sessionManager.close();
  }
}
