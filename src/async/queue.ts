/**
 * Iris AsyncQueue - Generic async task queue with RxJS
 *
 * Provides per-team queuing for async operations like tell, command, sleep.
 * Uses RxJS to reactively process tasks as ClaudeProcess instances become available.
 *
 * Key features:
 * - Per-team queues for parallel cross-team processing
 * - Serial processing within each team queue (FIFO)
 * - 100-message rolling limit per team
 * - No timeouts - tasks wait indefinitely until processed
 * - Reactive coordination with ClaudeProcess completion events
 */

import { Subject, concatMap, catchError, of, type Observable } from "rxjs";
import type { IrisOrchestrator } from "../iris.js";
import { Logger } from "../utils/logger.js";
import { generateSecureUUID } from "../session/validation.js";

const logger = new Logger("async-queue");

/**
 * Supported async task types
 */
export type AsyncTaskType = "tell" | "command" | "sleep";

/**
 * Generic async task
 */
export interface AsyncTask {
  /** Unique task identifier */
  taskId: string;

  /** Task type */
  type: AsyncTaskType;

  /** Target team */
  toTeam: string;

  /** Source team (null for external) */
  fromTeam: string | null;

  /** Message or command content */
  content: string;

  /** Optional timeout (default: 30000ms) */
  timeout?: number;

  /** Optional command arguments (for 'command' type) */
  args?: string;

  /** Timestamp when task was enqueued */
  enqueuedAt: number;
}

/**
 * Task result
 */
export interface AsyncTaskResult {
  taskId: string;
  type: AsyncTaskType;
  toTeam: string;
  success: boolean;
  response?: string;
  error?: string;
  duration: number;
  completedAt: number;
}

/**
 * Per-team queue statistics
 */
export interface QueueStats {
  teamName: string;
  pending: number;
  processed: number;
  failed: number;
  maxQueueSize: number;
}

/**
 * AsyncQueue - Generic async task queue with RxJS
 *
 * Manages per-team queues for async operations (tell, command, sleep).
 * Processes tasks serially within each team, parallelly across teams.
 */
export class AsyncQueue {
  private queues = new Map<string, Subject<AsyncTask>>();
  private queueStats = new Map<
    string,
    { pending: number; processed: number; failed: number }
  >();
  private readonly MAX_QUEUE_SIZE = 100;

  constructor(private iris: IrisOrchestrator) {
    logger.info("AsyncQueue initialized");
  }

  /**
   * Enqueue a task (returns immediately with taskId)
   *
   * @param task - Task to enqueue
   * @returns Task ID for tracking
   * @throws Error if queue is full (100 tasks)
   */
  enqueue(task: Omit<AsyncTask, "taskId" | "enqueuedAt">): string {
    const taskId = generateSecureUUID();
    const fullTask: AsyncTask = {
      ...task,
      taskId,
      enqueuedAt: Date.now(),
    };

    // Check queue size
    const stats = this.getOrCreateStats(task.toTeam);
    if (stats.pending >= this.MAX_QUEUE_SIZE) {
      logger.error("Queue full, rejecting task", {
        toTeam: task.toTeam,
        pending: stats.pending,
        maxQueueSize: this.MAX_QUEUE_SIZE,
      });
      throw new Error(
        `Queue for team '${task.toTeam}' is full (${this.MAX_QUEUE_SIZE} tasks). Please wait.`,
      );
    }

    // Increment pending count
    stats.pending++;

    // Get or create queue for this team
    const queue = this.getOrCreateQueue(task.toTeam);

    // Enqueue task
    queue.next(fullTask);

    logger.info("Task enqueued", {
      taskId,
      type: task.type,
      toTeam: task.toTeam,
      queueSize: stats.pending,
    });

    return taskId;
  }

  /**
   * Get or create queue for a team
   */
  private getOrCreateQueue(teamName: string): Subject<AsyncTask> {
    if (!this.queues.has(teamName)) {
      const queue = new Subject<AsyncTask>();

      // Process queue with concatMap (serial, FIFO)
      queue
        .pipe(
          concatMap((task) => this.processTask(task)),
          catchError((error) => {
            logger.error("Queue processing error", {
              teamName,
              error: error instanceof Error ? error.message : String(error),
            });
            return of(null); // Continue processing despite errors
          }),
        )
        .subscribe();

      this.queues.set(teamName, queue);
      logger.info("Created queue for team", { teamName });
    }

    return this.queues.get(teamName)!;
  }

  /**
   * Get or create stats for a team
   */
  private getOrCreateStats(teamName: string) {
    if (!this.queueStats.has(teamName)) {
      this.queueStats.set(teamName, {
        pending: 0,
        processed: 0,
        failed: 0,
      });
    }
    return this.queueStats.get(teamName)!;
  }

  /**
   * Process a single task
   */
  private async processTask(task: AsyncTask): Promise<AsyncTaskResult> {
    const startTime = Date.now();
    const stats = this.getOrCreateStats(task.toTeam);

    logger.info("Processing task", {
      taskId: task.taskId,
      type: task.type,
      toTeam: task.toTeam,
    });

    try {
      let response: string;

      // Route to appropriate handler based on task type
      switch (task.type) {
        case "tell":
          response = await this.iris.sendMessage(
            task.fromTeam,
            task.toTeam,
            task.content,
            {
              timeout: task.timeout || 30000,
              waitForResponse: true,
            },
          );
          break;

        case "command":
          // Commands use the slash command format
          const commandStr = task.args
            ? `/${task.content} ${task.args}`
            : `/${task.content}`;
          response = await this.iris.sendMessage(
            task.fromTeam,
            task.toTeam,
            commandStr,
            {
              timeout: task.timeout || 30000,
              waitForResponse: true,
            },
          );
          break;

        case "sleep":
          // Sleep is implemented as a tell with special handling
          response = await this.iris.sendMessage(
            task.fromTeam,
            task.toTeam,
            task.content,
            {
              timeout: task.timeout || 30000,
              waitForResponse: true,
            },
          );
          break;

        default:
          throw new Error(`Unknown task type: ${(task as AsyncTask).type}`);
      }

      const duration = Date.now() - startTime;

      // Update stats
      stats.pending--;
      stats.processed++;

      logger.info("Task completed successfully", {
        taskId: task.taskId,
        type: task.type,
        toTeam: task.toTeam,
        duration,
        responseLength: response.length,
      });

      return {
        taskId: task.taskId,
        type: task.type,
        toTeam: task.toTeam,
        success: true,
        response,
        duration,
        completedAt: Date.now(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update stats
      stats.pending--;
      stats.failed++;

      logger.error("Task failed", {
        taskId: task.taskId,
        type: task.type,
        toTeam: task.toTeam,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      return {
        taskId: task.taskId,
        type: task.type,
        toTeam: task.toTeam,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Get queue statistics for a team
   */
  getQueueStats(teamName: string): QueueStats | null {
    const stats = this.queueStats.get(teamName);
    if (!stats) return null;

    return {
      teamName,
      pending: stats.pending,
      processed: stats.processed,
      failed: stats.failed,
      maxQueueSize: this.MAX_QUEUE_SIZE,
    };
  }

  /**
   * Get statistics for all queues
   */
  getAllQueueStats(): QueueStats[] {
    return Array.from(this.queueStats.entries()).map(([teamName, stats]) => ({
      teamName,
      pending: stats.pending,
      processed: stats.processed,
      failed: stats.failed,
      maxQueueSize: this.MAX_QUEUE_SIZE,
    }));
  }

  /**
   * Clear queue for a team (for testing)
   */
  clearQueue(teamName: string): void {
    const queue = this.queues.get(teamName);
    if (queue) {
      queue.complete();
      this.queues.delete(teamName);
    }

    this.queueStats.delete(teamName);

    logger.info("Queue cleared", { teamName });
  }

  /**
   * Shutdown all queues
   */
  shutdown(): void {
    logger.info("Shutting down AsyncQueue");

    for (const [teamName, queue] of this.queues.entries()) {
      queue.complete();
      logger.debug("Queue completed", { teamName });
    }

    this.queues.clear();
    this.queueStats.clear();

    logger.info("AsyncQueue shutdown complete");
  }
}
