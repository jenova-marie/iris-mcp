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
import type { PendingPermissionsManager } from "./permissions/pending-manager.js";

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

export interface PermissionDecision {
  allow: boolean;
  message?: string;
  teamName: string;
  mode: "yes" | "no" | "ask" | "forward";
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
  private pendingPermissions?: PendingPermissionsManager;

  constructor(
    private sessionManager: SessionManager,
    private processPool: ClaudeProcessPool,
    private config: TeamsConfig,
    pendingPermissions?: PendingPermissionsManager,
  ) {
    this.cacheManager = new CacheManager();
    this.pendingPermissions = pendingPermissions;
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

    logger.info({
      fromTeam,
      toTeam,
      messageLength: message.length,
      timeout,
    }, "Sending message";

    // Step 1: Get or create session
    const session = await this.sessionManager.getOrCreateSession(
      fromTeam,
      toTeam,
    );

    logger.debug(
      {
        sessionId: session.sessionId,
        fromTeam: session.fromTeam,
        toTeam: session.toTeam,
        processState: session.processState,
      },
      "Session obtained",
    );

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

    // Step 4.5: Update session with debug info (if available from transport)
    const launchCommand = process.getLaunchCommand?.();
    const teamConfigSnapshot = process.getTeamConfigSnapshot?.();

    logger.debug(
      {
        sessionId: session.sessionId,
        hasGetLaunchCommand: typeof process.getLaunchCommand === "function",
        hasGetTeamConfigSnapshot:
          typeof process.getTeamConfigSnapshot === "function",
        launchCommandValue: launchCommand
          ? `${launchCommand.length} chars`
          : "NULL",
        teamConfigValue: teamConfigSnapshot
          ? `${teamConfigSnapshot.length} chars`
          : "NULL",
      },
      "Checking debug info from process",
    );

    if (launchCommand && teamConfigSnapshot) {
      this.sessionManager.updateDebugInfo(
        session.sessionId,
        launchCommand,
        teamConfigSnapshot,
      );
      logger.info(
        {
          sessionId: session.sessionId,
          commandLength: launchCommand.length,
          configLength: teamConfigSnapshot.length,
        },
        "Updated session debug info",
      );
    } else {
      logger.warn(
        {
          sessionId: session.sessionId,
          hasLaunchCommand: !!launchCommand,
          hasTeamConfig: !!teamConfigSnapshot,
        },
        "Debug info not available from transport",
      );
    }

    // Step 5: Create CacheEntry for this tell
    const tellEntry = messageCache.createEntry(CacheEntryType.TELL, message);

    logger.debug(
      {
        sessionId: session.sessionId,
        tellStringLength: message.length,
      },
      "Created tell CacheEntry",
    );

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
    logger.debug(
      {
        sessionId,
        cacheEntryId: (cacheEntry as any).__debugId || "unknown",
        cacheEntryStatus: cacheEntry.status,
        currentMessageCount: cacheEntry.getMessages().length,
      },
      "startResponseTimeout called",
    );

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
    logger.debug(
      {
        sessionId,
        cacheEntryId: (cacheEntry as any).__debugId || "unknown",
      },
      "Creating startResponseTimeout subscription",
    );

    const subscription = cacheEntry.messages$.subscribe((msg) => {
      this.sessionManager.updateLastResponse(sessionId);
      resetTimer(); // Reset timer on each message

      logger.debug(
        {
          sessionId,
          messageType: msg.type,
        },
        "Cache message received, timer reset",
      );

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

    logger.debug(
      {
        sessionId,
        responseTimeout,
      },
      "Response timeout timer started",
    );
  }

  /**
   * Handle tell completion (called when 'result' message received)
   */
  private handleTellCompletion(
    sessionId: string,
    cacheEntry: CacheEntry,
  ): void {
    logger.info(
      {
        sessionId,
        cacheEntryType: cacheEntry.cacheEntryType,
        messageCount: cacheEntry.getMessages().length,
      },
      "Tell completed successfully",
    );

    // Defer complete() to allow all subscribers to receive the result message
    // This prevents a race condition where complete() is called synchronously
    // during messagesSubject.next(), blocking later subscribers from receiving
    // the message.
    setImmediate(() => {
      logger.debug({ sessionId }, "Deferred complete() executing");
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

    logger.debug({ sessionId }, "Deferred complete() cleanup complete");
  }

  /**
   * Handle responseTimeout - recreate process
   * This is the critical error path where Claude has stopped responding
   */
  private async handleResponseTimeout(
    sessionId: string,
    cacheEntry: CacheEntry,
  ): Promise<void> {
    logger.error(
      {
        sessionId,
        cacheEntryType: cacheEntry.cacheEntryType,
        timeout: this.config.settings.responseTimeout,
        messageCount: cacheEntry.getMessages().length,
      },
      "Response timeout - recreating process",
    );

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
    logger.debug(
      {
        sessionId,
        mcpTimeout,
        cacheEntryStatus: cacheEntry.status,
        currentMessageCount: cacheEntry.getMessages().length,
        cacheEntryId: (cacheEntry as any).__debugId || "unknown",
      },
      "waitForCompletion starting",
    );

    return new Promise((resolve) => {
      let mcpTimeoutId: NodeJS.Timeout | null = null;
      let completed = false;

      // Set MCP timeout (if not 0)
      if (mcpTimeout > 0) {
        mcpTimeoutId = setTimeout(() => {
          if (!completed) {
            completed = true;
            subscription.unsubscribe();

            logger.info(
              {
                sessionId,
                mcpTimeout,
                messagesReceived: cacheEntry.getMessages().length,
              },
              "MCP timeout reached, returning partial results",
            );

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
      logger.debug(
        {
          sessionId,
          cacheEntryStatus: cacheEntry.status,
          currentMessageCount: cacheEntry.getMessages().length,
        },
        "Creating waitForCompletion subscription",
      );

      const subscription = cacheEntry.messages$
        .pipe(
          tap((msg) =>
            logger.debug(
              {
                sessionId,
                messageType: msg.type,
                totalMessages: cacheEntry.getMessages().length,
              },
              "waitForCompletion received message (before filter)",
            ),
          ),
          filter((msg) => {
            const matches = msg.type === "result";
            logger.debug(
              {
                sessionId,
                messageType: msg.type,
                matches,
              },
              "waitForCompletion filter check",
            );
            return matches;
          }),
        )
        .subscribe(() => {
          logger.debug(
            {
              sessionId,
              completed,
            },
            "waitForCompletion subscription callback invoked",
          );

          if (!completed) {
            completed = true;
            if (mcpTimeoutId) clearTimeout(mcpTimeoutId);
            subscription.unsubscribe();

            logger.info(
              {
                sessionId,
                responseLength: this.extractFullResponse(cacheEntry).length,
              },
              "Tell completed within MCP timeout",
            );

            // Extract full response
            const response = this.extractFullResponse(cacheEntry);
            resolve(response);
          }
        });

      logger.debug(
        {
          sessionId,
          subscriptionClosed: subscription.closed,
        },
        "waitForCompletion subscription created",
      );

      // Handle terminated case
      if (cacheEntry.status === "terminated") {
        if (!completed) {
          completed = true;
          if (mcpTimeoutId) clearTimeout(mcpTimeoutId);
          subscription.unsubscribe();

          logger.warn(
            {
              sessionId,
              reason: cacheEntry.terminationReason,
            },
            "Cache entry already terminated",
          );

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

    logger.debug({ sessionId }, "Tell cleanup complete");
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
   * Handle permission request using sessionId-based team detection
   *
   * Business logic for permission approval based on team's grantPermission config:
   * - yes: Auto-approve all actions
   * - no: Auto-deny all actions (read-only mode)
   * - ask: Prompt user via dashboard (TODO: not yet implemented)
   * - forward: Forward to parent team (TODO: not yet implemented)
   *
   * @param sessionId - Session ID from URL path (/mcp/:sessionId)
   * @param toolName - Tool requesting permission (e.g., "mcp__iris__team_wake")
   * @param toolInput - Tool input parameters
   * @param reason - Optional reason from Claude
   */
  async handlePermissionRequest(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    reason?: string,
  ): Promise<PermissionDecision> {
    logger.info(
      {
        sessionId,
        toolName,
        reason,
      },
      "Processing permission request",
    );

    // Lookup process from session
    const process = this.processPool.getProcessBySessionId(sessionId);
    if (!process) {
      logger.error({ sessionId }, "Session not found in process pool");
      return {
        allow: false,
        message: `Permission denied: Session not found (${sessionId})`,
        teamName: "unknown",
        mode: "no",
      };
    }

    const teamName = process.teamName;
    logger.debug({ sessionId, teamName }, "Resolved team from session");

    // Get team config
    const teamConfig = this.config.teams[teamName];
    if (!teamConfig) {
      logger.error({ teamName }, "Team config not found");
      return {
        allow: false,
        message: `Permission denied: Team config not found (${teamName})`,
        teamName,
        mode: "no",
      };
    }

    // Get permission mode (default: "ask")
    const mode = teamConfig.grantPermission || "ask";

    logger.info(
      {
        teamName,
        mode,
        toolName,
      },
      "Checking permission mode",
    );

    // Apply permission rules
    switch (mode) {
      case "yes":
        // Auto-approve all actions
        logger.info(
          { teamName, toolName },
          "Auto-approving (grantPermission: yes)",
        );
        return {
          allow: true,
          teamName,
          mode,
        };

      case "no":
        // Auto-deny all actions (read-only mode)
        logger.warn(
          { teamName, toolName },
          "Auto-denying (grantPermission: no)",
        );
        return {
          allow: false,
          message: `Permission denied: Team '${teamName}' is in read-only mode (grantPermission: no)`,
          teamName,
          mode,
        };

      case "ask":
        // Broadcast to dashboard for manual approval
        if (!this.pendingPermissions) {
          logger.warn(
            { teamName, toolName },
            "Ask mode not available - no permissions manager",
          );
          return {
            allow: false,
            message: `Permission denied: Dashboard not available for approval`,
            teamName,
            mode,
          };
        }

        logger.info(
          { teamName, toolName },
          "Creating pending permission request for dashboard approval",
        );

        try {
          // Create pending permission - this will be broadcasted to dashboard via events
          const response =
            await this.pendingPermissions.createPendingPermission(
              sessionId,
              teamName,
              toolName,
              toolInput,
              reason,
            );

          logger.info(
            {
              teamName,
              toolName,
              approved: response.approved,
            },
            "Permission request resolved by dashboard",
          );

          return {
            allow: response.approved,
            message:
              response.reason ||
              (response.approved ? undefined : "Permission denied by user"),
            teamName,
            mode,
          };
        } catch (error) {
          logger.error(
            {
              err: error instanceof Error ? error : new Error(String(error)),
              teamName,
              toolName,
            },
            "Error creating pending permission",
          );

          return {
            allow: false,
            message: `Permission denied: Error requesting approval - ${error instanceof Error ? error.message : String(error)}`,
            teamName,
            mode,
          };
        }

      case "forward":
        // TODO: Forward permission request to parent team
        // For now, deny with message explaining feature not yet implemented
        logger.warn(
          { teamName, toolName },
          "Forward mode not yet implemented, denying",
        );
        return {
          allow: false,
          message: `Permission denied: Forward mode (grantPermission: forward) not yet implemented for team '${teamName}'`,
          teamName,
          mode,
        };

      default:
        // Unknown mode - deny for safety
        logger.error({ teamName, mode }, "Unknown grantPermission mode");
        return {
          allow: false,
          message: `Permission denied: Unknown permission mode '${mode}' for team '${teamName}'`,
          teamName,
          mode: "no",
        };
    }
  }

  /**
   * Check if a team is "awake" (has a live, ready process)
   */
  isAwake(fromTeam: string, toTeam: string): boolean {
    // Check if session exists
    const session = this.sessionManager.getSession(fromTeam, toTeam);
    if (!session) {
      logger.debug({ fromTeam, toTeam }, "Team not awake: no session");
      return false;
    }

    // Check if process exists for this session
    const process = this.processPool.getProcessBySessionId(session.sessionId);
    if (!process) {
      logger.debug(
        {
          fromTeam,
          toTeam,
          sessionId: session.sessionId,
        },
        "Team not awake: no process",
      );
      return false;
    }

    const metrics = process.getBasicMetrics();
    const isReady = metrics.isReady && !metrics.isBusy;

    logger.debug(
      {
        fromTeam,
        toTeam,
        sessionId: session.sessionId,
        isReady: metrics.isReady,
        isBusy: metrics.isBusy,
        result: isReady,
      },
      "Team awake check",
    );

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
