/**
 * Integration tests for Session Metrics
 * Tests core metrics collection and health scoring
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SessionMetricsCollector } from "../../../src/session/metrics.js";

describe("Session Metrics Integration", () => {
  let collector: SessionMetricsCollector;
  const testSessionId = "test-session-123";

  beforeEach(() => {
    collector = new SessionMetricsCollector();
  });

  describe("Response time tracking", () => {
    it("should record and calculate average response time", () => {
      collector.recordResponseTime(testSessionId, 1000);
      collector.recordResponseTime(testSessionId, 2000);
      collector.recordResponseTime(testSessionId, 3000);

      const metrics = collector.getMetrics(testSessionId);
      expect(metrics).toBeDefined();
      expect(metrics?.avgResponseTime).toBe(2000);
      expect(metrics?.responseTime).toHaveLength(3);
    });

    it("should calculate P95 response time", () => {
      // Add 100 response times
      for (let i = 1; i <= 100; i++) {
        collector.recordResponseTime(testSessionId, i * 100);
      }

      const metrics = collector.getMetrics(testSessionId);
      expect(metrics?.p95ResponseTime).toBeGreaterThan(9000);
    });
  });

  describe("Token usage tracking", () => {
    it("should accumulate token usage", () => {
      collector.recordTokenUsage(testSessionId, 1000);
      collector.recordTokenUsage(testSessionId, 2000);
      collector.recordTokenUsage(testSessionId, 3000);

      const metrics = collector.getMetrics(testSessionId);
      expect(metrics?.tokenUsage).toBe(6000);
    });

    it("should recommend compaction at high token usage", () => {
      collector.recordTokenUsage(testSessionId, 60000);

      expect(collector.shouldCompact(testSessionId)).toBe(true);
    });
  });

  describe("Error rate tracking", () => {
    it("should track error rate", () => {
      collector.recordResponseTime(testSessionId, 1000);
      collector.recordSuccess(testSessionId);

      collector.recordResponseTime(testSessionId, 2000);
      collector.recordError(testSessionId);

      const metrics = collector.getMetrics(testSessionId);
      expect(metrics?.errorRate).toBeGreaterThan(0);
    });
  });

  describe("Health scoring", () => {
    it("should return perfect score for new session", () => {
      const score = collector.getHealthScore(testSessionId);
      expect(score).toBe(100);
    });

    it("should decrease score with high token usage", () => {
      collector.recordTokenUsage(testSessionId, 40000);
      collector.recordResponseTime(testSessionId, 1000);

      const score = collector.getHealthScore(testSessionId);
      expect(score).toBeLessThan(100);
    });

    it("should decrease score with slow response times", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime(testSessionId, 8000);
      }

      const score = collector.getHealthScore(testSessionId);
      expect(score).toBeLessThan(100);
    });
  });

  describe("Summary statistics", () => {
    it("should provide accurate summary across sessions", () => {
      collector.recordTokenUsage("session-1", 10000);
      collector.recordResponseTime("session-1", 1000);

      collector.recordTokenUsage("session-2", 60000);
      collector.recordResponseTime("session-2", 1000);

      const summary = collector.getSummaryStats();
      expect(summary.totalSessions).toBe(2);
      expect(summary.sessionsNeedingCompaction).toBe(1);
      expect(summary.totalTokenUsage).toBe(70000);
    });
  });

  describe("Metrics reset after compaction", () => {
    it("should reset metrics after compaction", () => {
      collector.recordTokenUsage(testSessionId, 50000);
      collector.recordResponseTime(testSessionId, 5000);

      collector.resetAfterCompaction(testSessionId);

      const metrics = collector.getMetrics(testSessionId);
      expect(metrics?.tokenUsage).toBe(0);
      expect(metrics?.responseTime).toHaveLength(0);
    });
  });
});
