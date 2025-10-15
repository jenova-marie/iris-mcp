/**
 * Integration tests for Session Metrics
 * Tests core metrics collection and health scoring
 *
 * NEW ARCHITECTURE CHANGES:
 * - Metrics are now keyed by sessionId (not null->team)
 * - All sessions have fromTeam->toTeam format
 * - Metrics tracking logic remains unchanged
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

    it("should track response times separately per session", () => {
      const session1 = "session-1";
      const session2 = "session-2";

      collector.recordResponseTime(session1, 1000);
      collector.recordResponseTime(session2, 5000);

      const metrics1 = collector.getMetrics(session1);
      const metrics2 = collector.getMetrics(session2);

      expect(metrics1?.avgResponseTime).toBe(1000);
      expect(metrics2?.avgResponseTime).toBe(5000);
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

    it("should not recommend compaction at low token usage", () => {
      collector.recordTokenUsage(testSessionId, 5000);

      expect(collector.shouldCompact(testSessionId)).toBe(false);
    });

    it("should track token usage separately per session", () => {
      const session1 = "session-1";
      const session2 = "session-2";

      collector.recordTokenUsage(session1, 10000);
      collector.recordTokenUsage(session2, 50000);

      const metrics1 = collector.getMetrics(session1);
      const metrics2 = collector.getMetrics(session2);

      expect(metrics1?.tokenUsage).toBe(10000);
      expect(metrics2?.tokenUsage).toBe(50000);
    });
  });

  describe("Error rate tracking", () => {
    it("should track error rate", () => {
      collector.recordResponseTime(testSessionId, 1000);
      collector.recordSuccess(testSessionId);

      collector.recordResponseTime(testSessionId, 2000);
      collector.recordError(testSessionId);

      const metrics = collector.getMetrics(testSessionId);
      // Error rate is returned as percentage (0-100)
      expect(metrics?.errorRate).toBeGreaterThan(0);
      expect(metrics?.errorRate).toBeLessThanOrEqual(100);
    });

    it("should calculate error rate correctly with all successes", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime(testSessionId, 1000);
        collector.recordSuccess(testSessionId);
      }

      const metrics = collector.getMetrics(testSessionId);
      expect(metrics?.errorRate).toBe(0);
    });

    it("should calculate error rate correctly with all failures", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime(testSessionId, 1000);
        collector.recordError(testSessionId);
      }

      const metrics = collector.getMetrics(testSessionId);
      // Error rate is returned as percentage (0-100)
      expect(metrics?.errorRate).toBe(100);
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
      expect(score).toBeGreaterThan(0);
    });

    it("should decrease score with slow response times", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime(testSessionId, 8000);
      }

      const score = collector.getHealthScore(testSessionId);
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThan(0);
    });

    it("should decrease score with high error rate", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime(testSessionId, 1000);
        collector.recordError(testSessionId);
      }

      const score = collector.getHealthScore(testSessionId);
      expect(score).toBeLessThan(100);
    });

    it("should maintain good score with normal metrics", () => {
      // Normal token usage
      collector.recordTokenUsage(testSessionId, 10000);

      // Normal response times
      for (let i = 0; i < 5; i++) {
        collector.recordResponseTime(testSessionId, 2000);
        collector.recordSuccess(testSessionId);
      }

      const score = collector.getHealthScore(testSessionId);
      expect(score).toBeGreaterThan(80);
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

    it("should track multiple sessions in summary", () => {
      const sessions = ["s1", "s2", "s3", "s4", "s5"];

      for (const sessionId of sessions) {
        collector.recordTokenUsage(sessionId, 5000);
        collector.recordResponseTime(sessionId, 1000);
      }

      const summary = collector.getSummaryStats();
      expect(summary.totalSessions).toBe(5);
      expect(summary.totalTokenUsage).toBe(25000);
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

    it("should only reset specified session", () => {
      const session1 = "session-1";
      const session2 = "session-2";

      collector.recordTokenUsage(session1, 50000);
      collector.recordTokenUsage(session2, 30000);

      collector.resetAfterCompaction(session1);

      const metrics1 = collector.getMetrics(session1);
      const metrics2 = collector.getMetrics(session2);

      expect(metrics1?.tokenUsage).toBe(0);
      expect(metrics2?.tokenUsage).toBe(30000);
    });

    it("should return perfect health score after reset", () => {
      collector.recordTokenUsage(testSessionId, 60000);
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime(testSessionId, 8000);
        collector.recordError(testSessionId);
      }

      // Health should be poor
      expect(collector.getHealthScore(testSessionId)).toBeLessThan(50);

      // Reset
      collector.resetAfterCompaction(testSessionId);

      // Health should be perfect
      expect(collector.getHealthScore(testSessionId)).toBe(100);
    });
  });
});
