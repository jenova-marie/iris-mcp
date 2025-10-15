/**
 * Iris Orchestrator - THE BRAIN
 *
 * All business logic lives here:
 * - Completion detection
 * - Timeout orchestration (two-timeout architecture)
 * - Process state management
 * - Cache coordination
 *
 * ClaudeProcess is a dumb pipe - Iris makes all decisions.
 */

import { SessionManager } from "./session/session-manager.js";
import { ClaudeProcessPool } from "./process-pool/pool-manager.js";
import { CacheManager } from "./cache/cache-manager.js";
import {
  CacheEntryType,
  TerminationReason,
  CacheEntry,
} from "./cache/types.js";
import { getChildLogger } from "./utils/logger.js";
import { filter, tap } from "rxjs/operators";
import type { Subscription } from "rxjs";
import type { TeamsConfig } from "./process-pool/types.js";

const logger = getChildLogger("iris:core");

export interface SendMessageOptions {
  timeout?: number;
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
 * Iris Orchestrator - Coordinates everything
 *
 * Two-timeout architecture:
 * - responseTimeout (from config): Detects stalled Claude responses, triggers process recreation
 * - mcpTimeout (from caller): Controls how long caller waits for response
 *   - -1: Async mode (return immediately)
 *   - 0: Wait indefinitely
 *   - N: Wait N ms, then return partial results
 */
export class IrisOrchestrator {
  private cacheManager: CacheManager;
  private responseTimeouts = new Map<string, NodeJS.Timeout>();
  private responseSubscriptions = new Map<string, Subscription>();

  constructor(
    private sessionManager: SessionManager,
    private processPool: ClaudeProcessPool,
    private config: TeamsConfig,
  ) {
    this.cacheManager = new CacheManager();
  }

  /**
   * Send message from one team to another
   *
   * @param timeout MCP timeout parameter controls caller wait behavior:
   *   -1: Async mode (returns immediately)
   *    0: Wait indefinitely until completion or responseTimeout
   *    N: Wait N milliseconds for result, otherwise return before completion
   *
   * IMPORTANT: For ALL timeout modes, the complete message history will still be
   * cached regardless of whether the caller is actively connected or not.
   * The cache persists and can be retrieved later via cache read operations.
   *
   * responseTimeout (from config) is separate - detects stalled Claude responses
   */
  async sendMessage(
    fromTeam: string,
    toTeam: string,
    message: string,
    options: SendMessageOptions = {},
  ): Promise<string | object> {
    const { timeout = 30000 } = options;

    logger.info("Sending message", {
      fromTeam,
      toTeam,
      messageLength: message.length,
      timeout,
    });

    // Step 1: Get or create session
    const session = await this.sessionManager.getOrCreateSession(
      fromTeam,
      toTeam,
    );

    logger.debug("Session obtained", {
      sessionId: session.sessionId,
      fromTeam: session.fromTeam,
      toTeam: session.toTeam,
      processState: session.processState,
    });

    // Step 2: Check if process is busy
    const processState = this.sessionManager.getProcessState(session.sessionId);

    if (processState === "processing") {
      return {
        status: "busy",
        message: "Process currently processing another request",
        currentCacheSessionId: session.currentCacheSessionId,
      };
    }

    if (processState === "spawning") {
      return {
        status: "spawning",
        message: "Session starting... Please retry your request in a moment.",
      };
    }

    // Step 3: Get or create MessageCache for this session
    const messageCache = this.cacheManager.getOrCreateCache(
      session.sessionId,
      fromTeam,
      toTeam,
    );
    logger.debug(
      {
        sessionId: session.sessionId,
      },
      "Got or created MessageCache",
    );

    // Step 4: Get or create process (pool-manager handles spawning)
    const process = await this.processPool.getOrCreateProcess(
      toTeam,
      session.sessionId,
      fromTeam,
    );

    // Step 5: Create CacheEntry for this tell
    const tellEntry = messageCache.createEntry(CacheEntryType.TELL, message);

    logger.debug("Created tell CacheEntry", {
      sessionId: session.sessionId,
      tellStringLength: message.length,
    });

    // Step 6: Update session state
    this.sessionManager.updateProcessState(session.sessionId, "processing");
    this.sessionManager.setCurrentCacheSessionId(
      session.sessionId,
      session.sessionId,
    );

    // Step 7: Start responseTimeout timer
    this.startResponseTimeout(session.sessionId, tellEntry);

    // Step 8: Execute tell (non-blocking!)
    try {
      process.executeTell(tellEntry);
    } catch (error) {
      // Process busy or other error
      this.cleanupTell(session.sessionId);
      throw error;
    }

    // Step 9: Async mode - return immediately
    if (timeout === -1) {
      return {
        status: "async",
        sessionId: session.sessionId,
        message: "Tell executing asynchronously. Check cache for results.",
      };
    }

    // Step 10: Wait for completion or MCP timeout
    return this.waitForCompletion(session.sessionId, tellEntry, timeout);
  }

  /**
   * Start responseTimeout timer (resets on each message)
   * This is Iris's responsibility - NOT ClaudeProcess
   */
  private startResponseTimeout(
    sessionId: string,
    cacheEntry: CacheEntry,
  ): void {
    logger.debug("startResponseTimeout called", {
      sessionId,
      cacheEntryId: (cacheEntry as any).__debugId || "unknown",
      cacheEntryStatus: cacheEntry.status,
      currentMessageCount: cacheEntry.getMessages().length,
    });

    const responseTimeout = this.config.settings.responseTimeout ?? 120000;

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      // Clear existing timeout
      if (timeoutId) clearTimeout(timeoutId);

      // Set new timeout
      timeoutId = setTimeout(() => {
        this.handleResponseTimeout(sessionId, cacheEntry);
      }, responseTimeout);
    };

    // Subscribe to cache messages to reset timer
    logger.debug("Creating startResponseTimeout subscription", {
      sessionId,
      cacheEntryId: (cacheEntry as any).__debugId || "unknown",
    });

    const subscription = cacheEntry.messages$.subscribe((msg) => {
      this.sessionManager.updateLastResponse(sessionId);
      resetTimer(); // Reset timer on each message

      logger.debug("Cache message received, timer reset", {
        sessionId,
        messageType: msg.type,
      });

      // Check for completion
      if (msg.type === "result") {
        this.handleTellCompletion(sessionId, cacheEntry);
        subscription.unsubscribe();
        clearTimeout(timeoutId);
      }
    });

    // Store subscription for cleanup
    this.responseSubscriptions.set(sessionId, subscription);

    // Start initial timer
    resetTimer();

    logger.debug("Response timeout timer started", {
      sessionId,
      responseTimeout,
    });
  }

  /**
   * Handle tell completion (called when 'result' message received)
   */
  private handleTellCompletion(
    sessionId: string,
    cacheEntry: CacheEntry,
  ): void {
    logger.info("Tell completed successfully", {
      sessionId,
      cacheEntryType: cacheEntry.cacheEntryType,
      messageCount: cacheEntry.getMessages().length,
    });

    // Defer complete() to allow all subscribers to receive the result message
    // This prevents a race condition where complete() is called synchronously
    // during messagesSubject.next(), blocking later subscribers from receiving
    // the message.
    setImmediate(() => {
      logger.debug("Deferred complete() executing", { sessionId });
      cacheEntry.complete();
    });

    // Update session state
    this.sessionManager.updateProcessState(sessionId, "idle");
    this.sessionManager.setCurrentCacheSessionId(sessionId, null);

    // Update usage stats
    this.sessionManager.recordUsage(sessionId);
    this.sessionManager.incrementMessageCount(sessionId);

    // Cleanup subscription
    const subscription = this.responseSubscriptions.get(sessionId);
    if (subscription) {
      subscription.unsubscribe();
      this.responseSubscriptions.delete(sessionId);
    }

    logger.debug("Tell completion cleanup complete", { sessionId });
  }

  /**
   * Handle responseTimeout - recreate process
   * This is the critical error path where Claude has stopped responding
   */
  private async handleResponseTimeout(
    sessionId: string,
    cacheEntry: CacheEntry,
  ): Promise<void> {
    logger.error("Response timeout - recreating process", {
      sessionId,
      cacheEntryType: cacheEntry.cacheEntryType,
      timeout: this.config.settings.responseTimeout,
      messageCount: cacheEntry.getMessages().length,
    });

    // Mark entry as terminated
    cacheEntry.terminate(TerminationReason.RESPONSE_TIMEOUT);

    // Get session info
    const session = this.sessionManager.getSessionById(sessionId);
    if (!session) return;

    // Get MessageCache (preserve it!)
    const messageCache = this.cacheManager.getCache(sessionId);

    // Terminate old process
    const oldProcess = this.processPool.getProcessBySessionId(sessionId);
    if (oldProcess) {
      await oldProcess.terminate();
    }

    // Update session state
    this.sessionManager.updateProcessState(sessionId, "stopped");
    this.sessionManager.setCurrentCacheSessionId(sessionId, null);

    // Note: MessageCache preserved in CacheManager
    logger.info(
      {
        sessionId,
        cacheEntryCount: messageCache?.getAllEntries().length,
      },
      "Process terminated, cache preserved",
    );

    // Cleanup subscription
    const subscription = this.responseSubscriptions.get(sessionId);
    if (subscription) {
      subscription.unsubscribe();
      this.responseSubscriptions.delete(sessionId);
    }
  }

  /**
   * Wait for completion or MCP timeout
   * Iris polls cache waiting for result or timeout
   */
  private async waitForCompletion(
    sessionId: string,
    cacheEntry: CacheEntry,
    mcpTimeout: number,
  ): Promise<string | object> {
    logger.debug("waitForCompletion starting", {
      sessionId,
      mcpTimeout,
      cacheEntryStatus: cacheEntry.status,
      currentMessageCount: cacheEntry.getMessages().length,
      cacheEntryId: (cacheEntry as any).__debugId || "unknown",
    });

    return new Promise((resolve) => {
      let mcpTimeoutId: NodeJS.Timeout | null = null;
      let completed = false;

      // Set MCP timeout (if not 0)
      if (mcpTimeout > 0) {
        mcpTimeoutId = setTimeout(() => {
          if (!completed) {
            completed = true;
            subscription.unsubscribe();

            logger.info("MCP timeout reached, returning partial results", {
              sessionId,
              mcpTimeout,
              messagesReceived: cacheEntry.getMessages().length,
            });

            // Return partial results
            resolve({
              status: "mcp_timeout",
              sessionId,
              message: "Caller timeout reached. Process still running.",
              partialResponse: this.extractPartialResponse(cacheEntry),
              rawMessages: cacheEntry.getMessages(),
            });
          }
        }, mcpTimeout);
      }

      // Subscribe to completion
      logger.debug("Creating waitForCompletion subscription", {
        sessionId,
        cacheEntryStatus: cacheEntry.status,
        currentMessageCount: cacheEntry.getMessages().length,
      });

      const subscription = cacheEntry.messages$
        .pipe(
          tap((msg) =>
            logger.debug("waitForCompletion received message (before filter)", {
              sessionId,
              messageType: msg.type,
              totalMessages: cacheEntry.getMessages().length,
            }),
          ),
          filter((msg) => {
            const matches = msg.type === "result";
            logger.debug("waitForCompletion filter check", {
              sessionId,
              messageType: msg.type,
              matches,
            });
            return matches;
          }),
        )
        .subscribe(() => {
          logger.debug("waitForCompletion subscription callback invoked", {
            sessionId,
            completed,
          });

          if (!completed) {
            completed = true;
            if (mcpTimeoutId) clearTimeout(mcpTimeoutId);
            subscription.unsubscribe();

            logger.info("Tell completed within MCP timeout", {
              sessionId,
              responseLength: this.extractFullResponse(cacheEntry).length,
            });

            // Extract full response
            const response = this.extractFullResponse(cacheEntry);
            resolve(response);
          }
        });

      logger.debug("waitForCompletion subscription created", {
        sessionId,
        subscriptionClosed: subscription.closed,
      });

      // Handle terminated case
      if (cacheEntry.status === "terminated") {
        if (!completed) {
          completed = true;
          if (mcpTimeoutId) clearTimeout(mcpTimeoutId);
          subscription.unsubscribe();

          logger.warn("Cache entry already terminated", {
            sessionId,
            reason: cacheEntry.terminationReason,
          });

          resolve({
            status: "terminated",
            sessionId,
            reason: cacheEntry.terminationReason,
            message: "Process terminated during tell execution",
            partialResponse: this.extractPartialResponse(cacheEntry),
          });
        }
      }
    });
  }

  /**
   * Extract partial response from cache entry (for timeouts)
   */
  private extractPartialResponse(cacheEntry: CacheEntry): string {
    const messages = cacheEntry.getMessages();
    const assistantMessages = messages.filter((m) => m.type === "assistant");

    if (assistantMessages.length === 0) {
      return "(No response received yet)";
    }

    return assistantMessages
      .map((m) => m.data.message?.content?.[0]?.text || "")
      .join("\n");
  }

  /**
   * Extract full response from cache entry (for completion)
   */
  private extractFullResponse(cacheEntry: CacheEntry): string {
    return this.extractPartialResponse(cacheEntry);
  }

  /**
   * Cleanup tell (on error)
   */
  private cleanupTell(sessionId: string): void {
    this.sessionManager.updateProcessState(sessionId, "idle");
    this.sessionManager.setCurrentCacheSessionId(sessionId, null);

    const subscription = this.responseSubscriptions.get(sessionId);
    if (subscription) {
      subscription.unsubscribe();
      this.responseSubscriptions.delete(sessionId);
    }

    logger.debug("Tell cleanup complete", { sessionId });
  }

  /**
   * Ask a question to a team (convenience wrapper for sendMessage)
   */
  async ask(
    fromTeam: string,
    toTeam: string,
    question: string,
    timeout?: number,
  ): Promise<string> {
    const result = await this.sendMessage(fromTeam, toTeam, question, {
      timeout,
    });

    // If result is a string, return it directly
    if (typeof result === "string") {
      return result;
    }

    // If result is an object (timeout/error), return message field or stringify
    return (result as any).message || JSON.stringify(result);
  }

  /**
   * Get system status
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
   * Get message cache for a session
   */
  getMessageCache(sessionId: string) {
    return this.cacheManager.getCache(sessionId);
  }

  /**
   * Get message cache for a team pair
   */
  getMessageCacheForTeams(fromTeam: string, toTeam: string) {
    const session = this.sessionManager.getSession(fromTeam, toTeam);
    if (!session) return null;
    return this.cacheManager.getCache(session.sessionId);
  }

  /**
   * Check if a team is "awake" (has a live, ready process)
   */
  isAwake(fromTeam: string, toTeam: string): boolean {
    // Check if session exists
    const session = this.sessionManager.getSession(fromTeam, toTeam);
    if (!session) {
      logger.debug("Team not awake: no session", { fromTeam, toTeam });
      return false;
    }

    // Check if process exists for this session
    const process = this.processPool.getProcessBySessionId(session.sessionId);
    if (!process) {
      logger.debug("Team not awake: no process", {
        fromTeam,
        toTeam,
        sessionId: session.sessionId,
      });
      return false;
    }

    const metrics = process.getBasicMetrics();
    const isReady = metrics.isReady && !metrics.isBusy;

    logger.debug("Team awake check", {
      fromTeam,
      toTeam,
      sessionId: session.sessionId,
      isReady: metrics.isReady,
      isBusy: metrics.isBusy,
      result: isReady,
    });

    return isReady;
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Iris orchestrator");

    // Unsubscribe all
    for (const subscription of this.responseSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.responseSubscriptions.clear();

    // Clear timeouts
    for (const timeoutId of this.responseTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.responseTimeouts.clear();

    // Destroy all cache sessions
    this.cacheManager.destroyAll();

    await this.processPool.terminateAll();
    this.sessionManager.close();

    logger.info("Iris orchestrator shut down complete");
  }
}
