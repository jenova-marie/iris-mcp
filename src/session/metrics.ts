/**
 * Session Metrics Collection
 *
 * Tracks performance metrics and usage statistics for team-to-team sessions
 * to enable informed decisions about compaction, caching, and resource allocation.
 */

import { Logger } from "../utils/logger.js";
import type { SessionInfo, SessionMetrics } from "./types.js";

const logger = new Logger("session-metrics");

/**
 * Collects and analyzes session performance metrics
 */
export class SessionMetricsCollector {
  private metrics = new Map<string, SessionMetrics>();
  private readonly maxResponseTimeHistory = 100; // Keep last 100 response times
  private readonly compactionThreshold = 50000; // 50k tokens

  /**
   * Record a response time for a session
   */
  recordResponseTime(sessionId: string, responseTime: number): void {
    const metric = this.getOrCreateMetric(sessionId);

    // Add to response time history
    metric.responseTime.push(responseTime);

    // Keep only the last N response times
    if (metric.responseTime.length > this.maxResponseTimeHistory) {
      metric.responseTime.shift();
    }

    // Update calculated metrics
    this.updateCalculatedMetrics(metric);

    logger.debug("Recorded response time", {
      sessionId,
      responseTime,
      avgResponseTime: metric.avgResponseTime,
    });
  }

  /**
   * Record token usage for a session
   */
  recordTokenUsage(sessionId: string, tokens: number): void {
    const metric = this.getOrCreateMetric(sessionId);
    metric.tokenUsage += tokens;

    logger.debug("Recorded token usage", {
      sessionId,
      tokens,
      totalTokens: metric.tokenUsage,
    });
  }

  /**
   * Record an error for a session
   */
  recordError(sessionId: string): void {
    const metric = this.getOrCreateMetric(sessionId);

    // Calculate error rate (errors per 100 messages)
    const messageCount = metric.responseTime.length || 1;
    metric.errorRate = ((metric.errorRate * (messageCount - 1)) + 100) / messageCount;

    logger.debug("Recorded error", {
      sessionId,
      errorRate: metric.errorRate.toFixed(2),
    });
  }

  /**
   * Record a successful message
   */
  recordSuccess(sessionId: string): void {
    const metric = this.getOrCreateMetric(sessionId);

    // Update error rate (no error for this message)
    const messageCount = metric.responseTime.length || 1;
    metric.errorRate = (metric.errorRate * (messageCount - 1)) / messageCount;
  }

  /**
   * Get metrics for a session
   */
  getMetrics(sessionId: string): SessionMetrics | undefined {
    return this.metrics.get(sessionId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, SessionMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Check if a session should be compacted based on metrics
   */
  shouldCompact(sessionId: string): boolean {
    const metric = this.metrics.get(sessionId);
    if (!metric) return false;

    // Compact if token usage exceeds threshold
    if (metric.tokenUsage > this.compactionThreshold) {
      logger.info("Session should be compacted due to token usage", {
        sessionId,
        tokenUsage: metric.tokenUsage,
        threshold: this.compactionThreshold,
      });
      return true;
    }

    // Compact if error rate is high and session has significant history
    if (metric.errorRate > 10 && metric.responseTime.length > 50) {
      logger.info("Session should be compacted due to high error rate", {
        sessionId,
        errorRate: metric.errorRate.toFixed(2),
      });
      return true;
    }

    return false;
  }

  /**
   * Check if a session is performing poorly
   */
  isPerformingPoorly(sessionId: string): boolean {
    const metric = this.metrics.get(sessionId);
    if (!metric) return false;

    // Check if average response time is too high (> 10 seconds)
    if (metric.avgResponseTime && metric.avgResponseTime > 10000) {
      return true;
    }

    // Check if error rate is too high (> 20%)
    if (metric.errorRate > 20) {
      return true;
    }

    // Check if P95 response time is too high (> 30 seconds)
    if (metric.p95ResponseTime && metric.p95ResponseTime > 30000) {
      return true;
    }

    return false;
  }

  /**
   * Clear metrics for a session
   */
  clearMetrics(sessionId: string): void {
    this.metrics.delete(sessionId);
    logger.debug("Cleared metrics for session", { sessionId });
  }

  /**
   * Reset metrics after compaction
   */
  resetAfterCompaction(sessionId: string): void {
    const metric = this.metrics.get(sessionId);
    if (metric) {
      metric.tokenUsage = 0;
      metric.responseTime = [];
      metric.errorRate = 0;
      metric.lastHealthCheck = new Date();
      this.updateCalculatedMetrics(metric);

      logger.info("Reset metrics after compaction", { sessionId });
    }
  }

  /**
   * Get session health score (0-100)
   */
  getHealthScore(sessionId: string): number {
    const metric = this.metrics.get(sessionId);
    if (!metric || metric.responseTime.length === 0) {
      return 100; // New session starts with perfect health
    }

    let score = 100;

    // Deduct for high average response time
    if (metric.avgResponseTime) {
      const responseTimePenalty = Math.min(30, (metric.avgResponseTime / 1000) * 2);
      score -= responseTimePenalty;
    }

    // Deduct for high error rate
    score -= Math.min(30, metric.errorRate * 1.5);

    // Deduct for high token usage
    const tokenPenalty = Math.min(20, (metric.tokenUsage / this.compactionThreshold) * 20);
    score -= tokenPenalty;

    // Deduct for poor P95 performance
    if (metric.p95ResponseTime) {
      const p95Penalty = Math.min(20, (metric.p95ResponseTime / 2000) * 2);
      score -= p95Penalty;
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * Get summary statistics for all sessions
   */
  getSummaryStats(): {
    totalSessions: number;
    avgHealthScore: number;
    sessionsNeedingCompaction: number;
    poorPerformingSessions: number;
    totalTokenUsage: number;
  } {
    const sessionIds = Array.from(this.metrics.keys());

    let totalHealthScore = 0;
    let sessionsNeedingCompaction = 0;
    let poorPerformingSessions = 0;
    let totalTokenUsage = 0;

    for (const sessionId of sessionIds) {
      totalHealthScore += this.getHealthScore(sessionId);

      if (this.shouldCompact(sessionId)) {
        sessionsNeedingCompaction++;
      }

      if (this.isPerformingPoorly(sessionId)) {
        poorPerformingSessions++;
      }

      const metric = this.metrics.get(sessionId);
      if (metric) {
        totalTokenUsage += metric.tokenUsage;
      }
    }

    return {
      totalSessions: sessionIds.length,
      avgHealthScore: sessionIds.length > 0
        ? Math.round(totalHealthScore / sessionIds.length)
        : 100,
      sessionsNeedingCompaction,
      poorPerformingSessions,
      totalTokenUsage,
    };
  }

  /**
   * Get or create metric for session
   */
  private getOrCreateMetric(sessionId: string): SessionMetrics {
    let metric = this.metrics.get(sessionId);

    if (!metric) {
      metric = {
        sessionId,
        responseTime: [],
        tokenUsage: 0,
        errorRate: 0,
        lastHealthCheck: new Date(),
      };
      this.metrics.set(sessionId, metric);
    }

    return metric;
  }

  /**
   * Update calculated metrics (avg, p95)
   */
  private updateCalculatedMetrics(metric: SessionMetrics): void {
    if (metric.responseTime.length === 0) {
      metric.avgResponseTime = undefined;
      metric.p95ResponseTime = undefined;
      return;
    }

    // Calculate average
    const sum = metric.responseTime.reduce((a, b) => a + b, 0);
    metric.avgResponseTime = Math.round(sum / metric.responseTime.length);

    // Calculate P95
    const sorted = [...metric.responseTime].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    metric.p95ResponseTime = sorted[p95Index];
  }
}

/**
 * Global metrics collector instance
 */
export const globalMetricsCollector = new SessionMetricsCollector();