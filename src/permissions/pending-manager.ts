/**
 * PendingPermissionsManager - Tracks pending permission approval requests
 *
 * Manages permission requests waiting for dashboard approval with timeout handling.
 * Each pending request is tracked by a unique ID and resolves via Promise when
 * dashboard responds or timeout occurs.
 */

import { EventEmitter } from "events";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("permissions:pending");

export interface PendingPermissionRequest {
  permissionId: string;
  sessionId: string;
  teamName: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  reason?: string;
  createdAt: Date;
}

export interface PendingPermissionResponse {
  approved: boolean;
  reason?: string;
}

interface PendingEntry {
  request: PendingPermissionRequest;
  resolve: (response: PendingPermissionResponse) => void;
  reject: (error: Error) => void;
  timeoutTimer: NodeJS.Timeout;
}

/**
 * Manages pending permission requests with timeout and Promise-based resolution
 */
export class PendingPermissionsManager extends EventEmitter {
  private pending = new Map<string, PendingEntry>();
  private permissionCounter = 0;
  private defaultTimeout: number;

  constructor(defaultTimeoutMs = 30000) {
    super();
    this.defaultTimeout = defaultTimeoutMs;
  }

  /**
   * Generate unique permission ID
   */
  private generatePermissionId(): string {
    return `perm_${Date.now()}_${++this.permissionCounter}`;
  }

  /**
   * Create new pending permission request
   * Returns a Promise that resolves when dashboard responds or timeout occurs
   */
  async createPendingPermission(
    sessionId: string,
    teamName: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    reason?: string,
    timeoutMs?: number,
  ): Promise<PendingPermissionResponse> {
    const permissionId = this.generatePermissionId();
    const timeout = timeoutMs ?? this.defaultTimeout;

    const request: PendingPermissionRequest = {
      permissionId,
      sessionId,
      teamName,
      toolName,
      toolInput,
      reason,
      createdAt: new Date(),
    };

    logger.info(
      {
        permissionId,
        sessionId,
        teamName,
        toolName,
        timeout,
      },
      "Creating pending permission request",
    );

    // Create Promise that will be resolved by dashboard response or timeout
    const promise = new Promise<PendingPermissionResponse>((resolve, reject) => {
      // Set timeout timer
      const timeoutTimer = setTimeout(() => {
        this.handleTimeout(permissionId);
      }, timeout);

      // Store entry
      this.pending.set(permissionId, {
        request,
        resolve,
        reject,
        timeoutTimer,
      });
    });

    // Emit event for WebSocket broadcast
    this.emit("permission:created", request);

    return promise;
  }

  /**
   * Resolve pending permission with dashboard response
   */
  resolvePendingPermission(
    permissionId: string,
    approved: boolean,
    reason?: string,
  ): boolean {
    const entry = this.pending.get(permissionId);
    if (!entry) {
      logger.warn({ permissionId }, "Permission not found for resolution");
      return false;
    }

    logger.info(
      {
        permissionId,
        approved,
        teamName: entry.request.teamName,
      },
      "Resolving pending permission",
    );

    // Clear timeout
    clearTimeout(entry.timeoutTimer);

    // Resolve promise
    entry.resolve({ approved, reason });

    // Remove from pending
    this.pending.delete(permissionId);

    // Emit event
    this.emit("permission:resolved", {
      permissionId,
      approved,
      reason,
    });

    return true;
  }

  /**
   * Handle permission timeout
   */
  private handleTimeout(permissionId: string): void {
    const entry = this.pending.get(permissionId);
    if (!entry) {
      return;
    }

    logger.warn(
      {
        permissionId,
        teamName: entry.request.teamName,
        toolName: entry.request.toolName,
      },
      "Permission request timed out",
    );

    // Resolve with denial
    entry.resolve({
      approved: false,
      reason: "Permission request timed out - no dashboard response received",
    });

    // Remove from pending
    this.pending.delete(permissionId);

    // Emit event
    this.emit("permission:timeout", {
      permissionId,
      request: entry.request,
    });
  }

  /**
   * Get all pending permission requests
   */
  getPendingRequests(): PendingPermissionRequest[] {
    return Array.from(this.pending.values()).map((entry) => entry.request);
  }

  /**
   * Get specific pending request by ID
   */
  getPendingRequest(permissionId: string): PendingPermissionRequest | undefined {
    return this.pending.get(permissionId)?.request;
  }

  /**
   * Cancel specific pending request
   */
  cancelPendingPermission(permissionId: string): boolean {
    const entry = this.pending.get(permissionId);
    if (!entry) {
      return false;
    }

    logger.info({ permissionId }, "Canceling pending permission");

    clearTimeout(entry.timeoutTimer);
    entry.resolve({
      approved: false,
      reason: "Permission request canceled",
    });

    this.pending.delete(permissionId);
    return true;
  }

  /**
   * Clear all pending permissions (e.g., on shutdown)
   */
  clearAll(): void {
    logger.info(
      { count: this.pending.size },
      "Clearing all pending permissions",
    );

    for (const [permissionId, entry] of this.pending.entries()) {
      clearTimeout(entry.timeoutTimer);
      entry.resolve({
        approved: false,
        reason: "Server shutting down",
      });
    }

    this.pending.clear();
  }

  /**
   * Get count of pending permissions
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}
