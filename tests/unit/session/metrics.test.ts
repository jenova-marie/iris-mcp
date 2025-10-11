import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionMetricsCollector } from "../../../src/session/metrics.js";

// Mock logger
vi.mock("../../../src/utils/logger.js", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("SessionMetricsCollector", () => {
  let collector: SessionMetricsCollector;

  beforeEach(() => {
    collector = new SessionMetricsCollector();
  });

  describe("recordResponseTime", () => {
    it("should record response time for a session", () => {
      collector.recordResponseTime("session-1", 1000);

      const metrics = collector.getMetrics("session-1");

      expect(metrics).toBeDefined();
      expect(metrics?.responseTime).toEqual([1000]);
      expect(metrics?.avgResponseTime).toBe(1000);
    });

    it("should calculate average response time", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordResponseTime("session-1", 2000);
      collector.recordResponseTime("session-1", 3000);

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.avgResponseTime).toBe(2000);
    });

    it("should calculate P95 response time", () => {
      // Record 100 response times
      for (let i = 1; i <= 100; i++) {
        collector.recordResponseTime("session-1", i * 100);
      }

      const metrics = collector.getMetrics("session-1");

      // P95 should be around 95th percentile
      expect(metrics?.p95ResponseTime).toBeGreaterThan(9000);
      expect(metrics?.p95ResponseTime).toBeLessThanOrEqual(10000);
    });

    it("should limit response time history to last 100 entries", () => {
      // Record 150 response times
      for (let i = 1; i <= 150; i++) {
        collector.recordResponseTime("session-1", i * 100);
      }

      const metrics = collector.getMetrics("session-1");

      // Should only keep last 100
      expect(metrics?.responseTime.length).toBe(100);
      // First entry should be from iteration 51 (100ms * 51 = 5100)
      expect(metrics?.responseTime[0]).toBe(5100);
    });
  });

  describe("recordTokenUsage", () => {
    it("should record token usage for a session", () => {
      collector.recordTokenUsage("session-1", 1000);

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.tokenUsage).toBe(1000);
    });

    it("should accumulate token usage", () => {
      collector.recordTokenUsage("session-1", 1000);
      collector.recordTokenUsage("session-1", 2000);
      collector.recordTokenUsage("session-1", 1500);

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.tokenUsage).toBe(4500);
    });
  });

  describe("recordError and recordSuccess", () => {
    it("should start with zero error rate", () => {
      collector.recordResponseTime("session-1", 1000);

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.errorRate).toBe(0);
    });

    it("should increase error rate when errors are recorded", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordError("session-1");

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.errorRate).toBeGreaterThan(0);
    });

    it("should decrease error rate when successes are recorded", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordError("session-1");

      const beforeMetrics = collector.getMetrics("session-1");
      const errorRateBefore = beforeMetrics?.errorRate || 0;

      collector.recordSuccess("session-1");

      const afterMetrics = collector.getMetrics("session-1");
      const errorRateAfter = afterMetrics?.errorRate || 0;

      expect(errorRateAfter).toBeLessThan(errorRateBefore);
    });

    it("should calculate error rate as percentage", () => {
      // Record 10 messages with 2 errors
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime("session-1", 1000);
        if (i === 3 || i === 7) {
          collector.recordError("session-1");
        } else {
          collector.recordSuccess("session-1");
        }
      }

      const metrics = collector.getMetrics("session-1");

      // Error rate should be approximately 20% (2 errors / 10 messages * 100)
      expect(metrics?.errorRate).toBeGreaterThan(15);
      expect(metrics?.errorRate).toBeLessThan(25);
    });
  });

  describe("getMetrics and getAllMetrics", () => {
    it("should return undefined for non-existent session", () => {
      const metrics = collector.getMetrics("non-existent");

      expect(metrics).toBeUndefined();
    });

    it("should return all metrics", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordResponseTime("session-2", 2000);

      const allMetrics = collector.getAllMetrics();

      expect(allMetrics.size).toBe(2);
      expect(allMetrics.get("session-1")).toBeDefined();
      expect(allMetrics.get("session-2")).toBeDefined();
    });

    it("should return a copy of metrics map", () => {
      collector.recordResponseTime("session-1", 1000);

      const allMetrics = collector.getAllMetrics();
      allMetrics.clear();

      // Original should still have data
      expect(collector.getMetrics("session-1")).toBeDefined();
    });
  });

  describe("shouldCompact", () => {
    it("should return false for non-existent session", () => {
      expect(collector.shouldCompact("non-existent")).toBe(false);
    });

    it("should return true when token usage exceeds threshold", () => {
      collector.recordTokenUsage("session-1", 60000); // > 50k threshold

      expect(collector.shouldCompact("session-1")).toBe(true);
    });

    it("should return false when token usage is below threshold", () => {
      collector.recordTokenUsage("session-1", 40000); // < 50k threshold

      expect(collector.shouldCompact("session-1")).toBe(false);
    });

    it("should return true when error rate is high and has significant history", () => {
      // Record 60 messages with high error rate
      for (let i = 0; i < 60; i++) {
        collector.recordResponseTime("session-1", 1000);
        if (i % 5 === 0) {
          // 20% error rate
          collector.recordError("session-1");
        }
      }

      expect(collector.shouldCompact("session-1")).toBe(true);
    });

    it("should return false when error rate is high but lacks history", () => {
      // Only 10 messages
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime("session-1", 1000);
        if (i % 5 === 0) {
          collector.recordError("session-1");
        }
      }

      expect(collector.shouldCompact("session-1")).toBe(false);
    });
  });

  describe("isPerformingPoorly", () => {
    it("should return false for non-existent session", () => {
      expect(collector.isPerformingPoorly("non-existent")).toBe(false);
    });

    it("should return true when average response time is too high", () => {
      collector.recordResponseTime("session-1", 15000); // > 10s

      expect(collector.isPerformingPoorly("session-1")).toBe(true);
    });

    it("should return true when error rate is too high", () => {
      // Create high error rate (> 20%)
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime("session-1", 1000);
        if (i % 3 === 0) {
          // ~33% error rate
          collector.recordError("session-1");
        }
      }

      expect(collector.isPerformingPoorly("session-1")).toBe(true);
    });

    it("should return true when P95 response time is too high", () => {
      // Most responses fast, but some very slow
      for (let i = 0; i < 100; i++) {
        if (i >= 95) {
          collector.recordResponseTime("session-1", 35000); // > 30s
        } else {
          collector.recordResponseTime("session-1", 1000);
        }
      }

      expect(collector.isPerformingPoorly("session-1")).toBe(true);
    });

    it("should return false when performance is good", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordResponseTime("session-1", 2000);
      collector.recordSuccess("session-1");

      expect(collector.isPerformingPoorly("session-1")).toBe(false);
    });
  });

  describe("clearMetrics", () => {
    it("should remove metrics for a session", () => {
      collector.recordResponseTime("session-1", 1000);
      expect(collector.getMetrics("session-1")).toBeDefined();

      collector.clearMetrics("session-1");

      expect(collector.getMetrics("session-1")).toBeUndefined();
    });

    it("should not affect other sessions", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordResponseTime("session-2", 2000);

      collector.clearMetrics("session-1");

      expect(collector.getMetrics("session-1")).toBeUndefined();
      expect(collector.getMetrics("session-2")).toBeDefined();
    });
  });

  describe("resetAfterCompaction", () => {
    it("should reset token usage and response times", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordTokenUsage("session-1", 60000);

      collector.resetAfterCompaction("session-1");

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.tokenUsage).toBe(0);
      expect(metrics?.responseTime).toEqual([]);
      expect(metrics?.errorRate).toBe(0);
    });

    it("should do nothing for non-existent session", () => {
      // Should not throw
      collector.resetAfterCompaction("non-existent");
    });

    it("should update lastHealthCheck timestamp", () => {
      const beforeDate = new Date();
      collector.recordResponseTime("session-1", 1000);

      // Wait a tiny bit to ensure timestamp changes
      const afterDate = new Date(Date.now() + 10);

      collector.resetAfterCompaction("session-1");

      const metrics = collector.getMetrics("session-1");

      expect(metrics?.lastHealthCheck).toBeDefined();
      expect(metrics?.lastHealthCheck.getTime()).toBeGreaterThanOrEqual(
        beforeDate.getTime()
      );
    });
  });

  describe("getHealthScore", () => {
    it("should return 100 for new session", () => {
      const score = collector.getHealthScore("non-existent");

      expect(score).toBe(100);
    });

    it("should return 100 for session with no response times", () => {
      collector.recordTokenUsage("session-1", 1000);

      const score = collector.getHealthScore("session-1");

      expect(score).toBe(100);
    });

    it("should deduct points for slow average response time", () => {
      collector.recordResponseTime("session-1", 5000); // 5 seconds

      const score = collector.getHealthScore("session-1");

      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThan(0);
    });

    it("should deduct points for high error rate", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordResponseTime("session-1", 1000);
        if (i % 2 === 0) {
          // 50% error rate
          collector.recordError("session-1");
        }
      }

      const score = collector.getHealthScore("session-1");

      expect(score).toBeLessThan(70); // Should lose significant points
    });

    it("should deduct points for high token usage", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordTokenUsage("session-1", 50000); // At threshold

      const score = collector.getHealthScore("session-1");

      expect(score).toBeLessThan(100);
    });

    it("should never go below 0", () => {
      // Create terrible metrics
      for (let i = 0; i < 100; i++) {
        collector.recordResponseTime("session-1", 50000); // 50s response time
        collector.recordError("session-1");
      }
      collector.recordTokenUsage("session-1", 100000);

      const score = collector.getHealthScore("session-1");

      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getSummaryStats", () => {
    it("should return defaults for no sessions", () => {
      const stats = collector.getSummaryStats();

      expect(stats).toEqual({
        totalSessions: 0,
        avgHealthScore: 100,
        sessionsNeedingCompaction: 0,
        poorPerformingSessions: 0,
        totalTokenUsage: 0,
      });
    });

    it("should count total sessions", () => {
      collector.recordResponseTime("session-1", 1000);
      collector.recordResponseTime("session-2", 2000);
      collector.recordResponseTime("session-3", 3000);

      const stats = collector.getSummaryStats();

      expect(stats.totalSessions).toBe(3);
    });

    it("should calculate average health score", () => {
      collector.recordResponseTime("session-1", 1000); // Good
      collector.recordResponseTime("session-2", 20000); // Poor

      const stats = collector.getSummaryStats();

      expect(stats.avgHealthScore).toBeGreaterThan(0);
      expect(stats.avgHealthScore).toBeLessThan(100);
    });

    it("should count sessions needing compaction", () => {
      collector.recordTokenUsage("session-1", 60000); // Needs compaction
      collector.recordTokenUsage("session-2", 10000); // Fine

      const stats = collector.getSummaryStats();

      expect(stats.sessionsNeedingCompaction).toBe(1);
    });

    it("should count poor performing sessions", () => {
      collector.recordResponseTime("session-1", 15000); // Poor (> 10s)
      collector.recordResponseTime("session-2", 1000); // Good

      const stats = collector.getSummaryStats();

      expect(stats.poorPerformingSessions).toBe(1);
    });

    it("should sum total token usage", () => {
      collector.recordTokenUsage("session-1", 10000);
      collector.recordTokenUsage("session-2", 20000);
      collector.recordTokenUsage("session-3", 15000);

      const stats = collector.getSummaryStats();

      expect(stats.totalTokenUsage).toBe(45000);
    });
  });
});
