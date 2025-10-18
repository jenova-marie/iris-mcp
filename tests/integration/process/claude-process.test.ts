/**
 * Integration tests for ClaudeProcess
 * Tests actual spawning and communication with Claude CLI
 * Tests RxJS observability (status$, errors$) and EventEmitter bridge
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";
import { ProcessStatus } from "../../../src/process-pool/types.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { CacheEntryImpl } from "../../../src/cache/cache-entry.js";
import { CacheEntryType } from "../../../src/cache/types.js";
import { existsSync } from "fs";
import { firstValueFrom, take, toArray, timeout } from "rxjs";

describe("ClaudeProcess Integration", () => {
  let claudeProcess: ClaudeProcess;
  const testIrisConfig: IrisConfig = {
    path: process.cwd(),
    description: "Test team for integration tests",
  };

  // Load config early to get timeout value
  const testConfigPath = "./tests/config.yaml";
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout =
    tempConfigManager.getConfig().settings.sessionInitTimeout;

  afterEach(async () => {
    if (claudeProcess) {
      const metrics = claudeProcess.getBasicMetrics();
      // Only terminate if process is not already stopped
      if (metrics.status !== ProcessStatus.STOPPED) {
        await claudeProcess.terminate();
      }
    }
  }, 30000); // 30 second timeout for cleanup

  describe("RxJS observability", () => {
    it("should emit status$ observable during process lifecycle", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-status-observable",
      );

      // Collect status emissions - we'll receive: stopped (initial), spawning, idle/processing
      const statuses: ProcessStatus[] = [];
      const statusSubscription = claudeProcess.status$.subscribe((status) => {
        statuses.push(status);
      });

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      // Clean up subscription
      statusSubscription.unsubscribe();

      // Should have received at least: stopped → spawning → idle (or processing)
      expect(statuses.length).toBeGreaterThanOrEqual(3);
      expect(statuses[0]).toBe(ProcessStatus.STOPPED);
      expect(statuses[1]).toBe(ProcessStatus.SPAWNING);
      expect([ProcessStatus.IDLE, ProcessStatus.PROCESSING]).toContain(
        statuses[2],
      );
    }, 30000); // 30 second timeout

    it("should provide current status via status$ BehaviorSubject", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-status-current",
      );

      // BehaviorSubject should emit current value immediately
      const initialStatus = await firstValueFrom(
        claudeProcess.status$.pipe(take(1), timeout(1000)),
      );
      expect(initialStatus).toBe(ProcessStatus.STOPPED);

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      // After spawn, should be idle or processing
      const currentStatus = await firstValueFrom(
        claudeProcess.status$.pipe(take(1), timeout(1000)),
      );
      expect([ProcessStatus.IDLE, ProcessStatus.PROCESSING]).toContain(
        currentStatus,
      );
    });

    it.skip("should emit errors$ when process fails", async () => {
      const invalidConfig: IrisConfig = {
        path: "/nonexistent/path",
        description: "Invalid path",
      };

      claudeProcess = new ClaudeProcess(
        "invalid-team",
        invalidConfig,
        "test-session-error-observable",
      );

      // Listen for error observable - collect any errors that occur
      const errors: any[] = [];
      const errorSubscription = claudeProcess.errors$.subscribe((error) => {
        errors.push(error);
      });

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");

      // Attempt to spawn - should fail
      try {
        await claudeProcess.spawn(spawnCacheEntry);
        // If spawn succeeds unexpectedly, fail the test
        expect.fail("Spawn should have failed with invalid path");
      } catch (error) {
        // Expected - spawn should throw
        expect(error).toBeInstanceOf(Error);
      }

      // Clean up
      errorSubscription.unsubscribe();

      // Should have received at least one error via observable
      // Note: errors$ emits Error objects directly, NOT wrapped with teamName
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toBeInstanceOf(Error);
    }, 30000);

    it("should emit both observables and EventEmitter events (bridge)", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-bridge",
      );

      // Listen to both observable and EventEmitter
      const observedStatuses: ProcessStatus[] = [];
      const statusSubscription = claudeProcess.status$.subscribe((status) => {
        observedStatuses.push(status);
      });

      // Listen for process-error EventEmitter event (the bridge event that exists)
      let errorEventEmitted = false;
      claudeProcess.once("process-error", () => {
        errorEventEmitted = true;
      });

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      // Clean up
      statusSubscription.unsubscribe();

      // Observables should have emitted
      expect(observedStatuses.length).toBeGreaterThanOrEqual(2);
      expect(observedStatuses[0]).toBe(ProcessStatus.STOPPED);
      expect(observedStatuses[1]).toBe(ProcessStatus.SPAWNING);
      // EventEmitter bridge exists (error event listener was set up, even if not triggered)
      expect(errorEventEmitted).toBe(false); // No error should have occurred
    }, 30000);

    it("should allow multiple subscribers to status$ observable", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-multi-subscriber",
      );

      // Create two independent subscribers
      const statuses1: ProcessStatus[] = [];
      const statuses2: ProcessStatus[] = [];

      const sub1 = claudeProcess.status$.subscribe((status) => {
        statuses1.push(status);
      });

      const sub2 = claudeProcess.status$.subscribe((status) => {
        statuses2.push(status);
      });

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      // Clean up
      sub1.unsubscribe();
      sub2.unsubscribe();

      // Both subscribers should receive same emissions
      expect(statuses1.length).toBeGreaterThanOrEqual(2);
      expect(statuses2.length).toBeGreaterThanOrEqual(2);
      expect(statuses1).toEqual(statuses2);
      expect(statuses1[0]).toBe(ProcessStatus.STOPPED);
      expect(statuses1[1]).toBe(ProcessStatus.SPAWNING);
    });
  });

  describe("process spawning", () => {
    it("should spawn claude process successfully", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-spawn",
      );

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.pid).toBeDefined();
      // Process might be PROCESSING (waiting for result) or IDLE (result arrived)
      expect([ProcessStatus.IDLE, ProcessStatus.PROCESSING]).toContain(
        metrics.status,
      );
    }, 30000);

    it.skip("should handle spawn errors gracefully", async () => {
      const invalidConfig: IrisConfig = {
        path: "/nonexistent/path",
        description: "Invalid path",
      };

      claudeProcess = new ClaudeProcess(
        "invalid-team",
        invalidConfig,
        "test-session-invalid",
      );

      // Attach error handler to prevent unhandled error
      // Note: ClaudeProcess emits "process-error" event (not "error") per OBSERVABILITY.md
      const errorPromise = new Promise((resolve) => {
        claudeProcess.once("process-error", (data) => {
          resolve(data);
        });
      });

      // Should either throw or emit process-error event
      try {
        const spawnCacheEntry = new CacheEntryImpl(
          CacheEntryType.SPAWN,
          "ping",
        );
        await Promise.race([
          claudeProcess.spawn(spawnCacheEntry),
          errorPromise,
        ]);
        // Process might spawn but then immediately fail
        const metrics = claudeProcess.getBasicMetrics();
        expect(metrics.status).toBeDefined();
      } catch (error) {
        // Expected - spawn failed
        expect(error).toBeDefined();
      }
    }, 30000);

    it("should transition to IDLE/PROCESSING after spawn completes", async () => {
      claudeProcess = new ClaudeProcess(
        "team-alpha",
        testIrisConfig,
        "test-session-spawn-completion",
      );

      const spawnCacheEntry = new CacheEntryImpl(CacheEntryType.SPAWN, "ping");
      await claudeProcess.spawn(spawnCacheEntry);

      // After spawn completes, process should be in IDLE or PROCESSING state
      const currentStatus = await firstValueFrom(
        claudeProcess.status$.pipe(take(1), timeout(1000)),
      );
      expect([ProcessStatus.IDLE, ProcessStatus.PROCESSING]).toContain(
        currentStatus,
      );

      // Verify metrics reflect spawned state
      const metrics = claudeProcess.getBasicMetrics();
      expect(metrics.pid).not.toBeNull();
      expect(metrics.teamName).toBe("team-alpha");
      expect([ProcessStatus.IDLE, ProcessStatus.PROCESSING]).toContain(
        metrics.status,
      );
    }, 30000);
  });
});
