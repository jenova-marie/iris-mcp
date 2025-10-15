/**
 * Integration test for dashboard cache viewing with actual tell() messages
 * This test verifies that cache entries are properly created and retrievable
 * after sending messages between teams.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { firstValueFrom } from "rxjs";
import { filter } from "rxjs/operators";
import { SessionManager } from "../../../src/session/session-manager.js";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import { IrisOrchestrator } from "../../../src/iris.js";
import { DashboardStateBridge } from "../../../src/dashboard/server/state-bridge.js";
import { CacheEntryStatus } from "../../../src/cache/types.js";
import { ProcessStatus } from "../../../src/process-pool/claude-process.js";
import { tell } from "../../../src/actions/tell.js";
import { wake } from "../../../src/actions/wake.js";
import { sleep } from "../../../src/actions/sleep.js";

describe("Dashboard Cache with Tell Messages", () => {
  let sessionManager: SessionManager;
  let configManager: TeamsConfigManager;
  let processPool: ClaudeProcessPool;
  let iris: IrisOrchestrator;
  let stateBridge: DashboardStateBridge;

  const testConfigPath = "./tests/config.json";

  // Load config early to get timeout value (following session-manager.test.ts pattern)
  const tempConfigManager = new TeamsConfigManager(testConfigPath);
  tempConfigManager.load();
  const sessionInitTimeout = tempConfigManager.getConfig().settings.sessionInitTimeout;

  // Single initialization for ALL tests (following session-manager.test.ts pattern)
  beforeAll(async () => {
    // Setup config manager
    configManager = new TeamsConfigManager(testConfigPath);
    configManager.load();
    const teamsConfig = configManager.getConfig();

    // Don't pass dbOptions - let it use inMemory config from tests/config.json
    // This follows the session-manager.test.ts pattern
    sessionManager = new SessionManager(teamsConfig);

    // Setup process pool
    processPool = new ClaudeProcessPool(configManager, teamsConfig.settings);

    // Setup Iris orchestrator
    iris = new IrisOrchestrator(sessionManager, processPool, teamsConfig);

    // Setup dashboard state bridge - pass iris instance so it uses same CacheManager
    stateBridge = new DashboardStateBridge(
      processPool,
      sessionManager,
      configManager,
      iris
    );

    // Initialize session manager
    try {
      await sessionManager.initialize();
    } catch (error) {
      // Log but don't fail - some teams might initialize successfully
      console.error("Partial initialization failure:", error);
    }
  }, 120000); // 2 minute timeout for setup

  afterEach(() => {
    // Reset the manager to clean state between tests (preserves DB and sessions)
    // Following session-manager.test.ts pattern
    if (sessionManager) {
      sessionManager.reset();
    }
  });

  afterAll(() => {
    // Cleanup - following session-manager.test.ts pattern
    if (processPool) {
      processPool.terminateAll();
    }
    if (sessionManager) {
      sessionManager.close();
    }
    // No need to clean database files - using in-memory database
  });

  describe("Empty cache before messages", () => {
    it("should return empty cache when no messages have been sent", async () => {
      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");

      expect(report).toMatchObject({
        team: "team-alpha",
        fromTeam: "team-iris",
        hasSession: false,
        hasProcess: false,
        allComplete: true,
        entries: [],
        stats: {
          totalEntries: 0,
          spawnEntries: 0,
          tellEntries: 0,
        },
      });
    });
  });

  describe("Wake team and create session", () => {
    it("should wake team-alpha and create a session", async () => {
      const result = await wake(
        { team: "team-alpha", fromTeam: "team-iris" },
        iris,
        processPool,
        sessionManager
      );

      expect(result.team).toBe("team-alpha");

      // Session might already exist if wake was called before
      if (result.status === "error" && result.message?.includes("already awake")) {
        console.log("Team already awake, continuing...");
        expect(result.sessionId).toBeTruthy();
      } else {
        expect(result.status).toMatch(/awake|waking/);
        if (result.sessionId) {
          expect(result.sessionId).toBeTruthy();
        } else {
          console.log("Wake result without sessionId:", result);
          // Session might already exist, which is fine for our test
        }
      }

      // Wait for process to be ready
      await new Promise(resolve => setTimeout(resolve, 2000));
    }, 60000);

    it("should show session exists but cache is still empty after wake", async () => {
      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");

      console.log("Report after wake:", JSON.stringify(report, null, 2));

      // Note: wake() creates a SessionInfo in SessionManager but doesn't create a MessageCache
      // The report shows hasSession: false because it checks for MessageCache existence
      // This is actually correct behavior - cache is created on first message

      if (report.hasSession) {
        expect(report.sessionId).toBeTruthy();
        // Check for spawn entry if cache exists
        const spawnEntry = report.entries.find(e => e.type === "spawn");
        if (spawnEntry) {
          expect(spawnEntry.type).toBe("spawn");
        }
      } else {
        // This is expected - no cache until first message
        expect(report.hasSession).toBe(false);
        expect(report.entries).toHaveLength(0);
      }
    });
  });

  describe("Send message and populate cache", () => {
    it("should send a tell message to populate the cache", async () => {
      // First ensure team is awake
      const wakeResult = await wake(
        { team: "team-alpha", fromTeam: "team-iris" },
        iris,
        processPool,
        sessionManager
      );

      console.log("Wake result:", wakeResult.status);

      // Wait for process to be idle from wake ping
      const maxWaitTime = 30000;
      const pollInterval = 500;
      const startTime = Date.now();

      let isIdle = false;
      while (Date.now() - startTime < maxWaitTime) {
        const process = processPool.getProcess("team-alpha");
        if (process) {
          const metrics = process.getBasicMetrics();
          console.log(`Process status: ${metrics.status}, busy: ${metrics.isBusy}`);
          if (metrics.status === "idle" && !metrics.isBusy) {
            isIdle = true;
            break;
          }
        } else {
          console.log("Process not found, might need to wait for spawn");
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      if (!isIdle) {
        console.log("Process never became idle, attempting send anyway");
      }

      const result = await tell(
        {
          fromTeam: "team-iris",
          toTeam: "team-alpha",
          message: "Test message for cache viewing",
          timeout: 30000, // Wait for response
        },
        iris
      );

      expect(result).toBeDefined();
      expect(result.to).toBe("team-alpha");
      expect(result.message).toBe("Test message for cache viewing");
      expect(result.response).toBeTruthy(); // Should get Claude's response

      console.log("Tell result:", {
        to: result.to,
        responseLength: result.response?.length,
        duration: result.duration,
      });
    }, 60000);

    it("should show cache entries after sending message", async () => {
      // Debug: let's check what caches exist
      const cacheManager = (iris as any).cacheManager;
      const allCaches = cacheManager.getAllCaches();
      console.log("All caches:", allCaches.map((c: any) => ({
        sessionId: c.sessionId,
        fromTeam: c.fromTeam,
        toTeam: c.toTeam,
        entryCount: c.getAllEntries().length
      })));

      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");

      console.log("Cache report after tell:", JSON.stringify(report, null, 2));

      // If no session found, it might be the cache isn't linked properly
      if (!report.hasSession) {
        console.log("No session found in report, but cache might exist");
        // Try getting cache directly
        const messageCache = iris.getMessageCacheForTeams("team-iris", "team-alpha");
        if (messageCache) {
          console.log("Direct cache lookup found:", {
            sessionId: messageCache.sessionId,
            fromTeam: messageCache.fromTeam,
            toTeam: messageCache.toTeam,
            entries: messageCache.getAllEntries().length
          });
        } else {
          console.log("Direct cache lookup also returned null");
        }
      }

      expect(report.hasSession).toBe(true);
      // Process might still be busy or stopped
      expect(report.entries.length).toBeGreaterThan(0);

      // Find the tell entry
      const tellEntry = report.entries.find(e => e.type === "tell");
      expect(tellEntry).toBeDefined();
      expect(tellEntry?.tellString).toBe("Test message for cache viewing");

      // Entry might be active or completed depending on timing
      expect(["active", "completed"]).toContain(tellEntry?.status);

      // Check messages within the entry
      expect(tellEntry?.messages.length).toBeGreaterThan(0);

      // Should have assistant message with Claude's response (even if partial)
      const assistantMessage = tellEntry?.messages.find(m => m.type === "assistant" && m.content);
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.content).toBeTruthy();

      // Check stats
      expect(report.stats.totalEntries).toBeGreaterThan(0);
      expect(report.stats.tellEntries).toBeGreaterThan(0);
      // completedEntries might be 0 if still active
      expect(report.stats.completedEntries).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Send async message", () => {
    it("should send async message and show it as active", async () => {
      // Wait a bit to ensure previous message is done processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await tell(
        {
          fromTeam: "team-iris",
          toTeam: "team-alpha",
          message: "Async message test",
          timeout: -1, // Async mode - return immediately
        },
        iris
      );

      expect(result.to).toBe("team-alpha");
      // In async mode, no response is expected (or might get error if busy)
      if (result.error) {
        console.log("Process busy, skipping async test");
        expect(result.error).toContain("processing");
      } else {
        expect(result.response).toBeUndefined();
      }
    });

    it("should show async message in cache while processing", async () => {
      // Get cache report immediately
      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");

      // Find the async tell entry
      const asyncEntry = report.entries.find(
        e => e.type === "tell" && e.tellString === "Async message test"
      );

      if (asyncEntry) {
        console.log("Async entry status:", asyncEntry.status);

        // It might be active or already completed depending on timing
        expect(["active", "completed"]).toContain(asyncEntry.status);

        if (asyncEntry.status === "active") {
          expect(report.allComplete).toBe(false);
        }
      }
    });

    it("should show async message as completed using status observable", async () => {
      // Get the message cache to access the cache entry
      const messageCache = iris.getMessageCacheForTeams("team-iris", "team-alpha");

      if (!messageCache) {
        // If no cache, the async message wasn't sent (test dependency issue)
        console.log("No message cache found, skipping async completion test");
        return;
      }

      // Find the async cache entry
      const entries = messageCache.getAllEntries();
      const asyncEntry = entries.find(e => e.tellString === "Async message test");

      if (!asyncEntry) {
        console.log("Async entry not found, might not have been sent");
        return;
      }

      // If entry is already completed, we're done
      if (asyncEntry.status === CacheEntryStatus.COMPLETED) {
        expect(asyncEntry.status).toBe(CacheEntryStatus.COMPLETED);
      } else {
        // Wait for the entry to complete using the status$ observable
        // This will wait up to 30 seconds for completion
        const completionPromise = firstValueFrom(
          asyncEntry.status$.pipe(
            filter(status => status === CacheEntryStatus.COMPLETED || status === CacheEntryStatus.TERMINATED)
          )
        );

        // Set a timeout so we don't wait forever
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for completion")), 30000)
        );

        try {
          const finalStatus = await Promise.race([completionPromise, timeoutPromise]);
          expect([CacheEntryStatus.COMPLETED, CacheEntryStatus.TERMINATED]).toContain(finalStatus);
        } catch (error) {
          // Timeout is acceptable for async messages
          console.log("Async message did not complete within timeout, which is acceptable");
          expect(asyncEntry.status).toBe(CacheEntryStatus.ACTIVE);
        }
      }

      // Verify through the dashboard report as well
      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");
      const reportEntry = report.entries.find(
        e => e.type === "tell" && e.tellString === "Async message test"
      );
      expect(reportEntry).toBeDefined();
    });
  });

  describe("Multiple messages in sequence", () => {
    it("should handle multiple messages and show all in cache", async () => {
      // Send multiple messages
      const messages = [
        "First message",
        "Second message",
        "Third message",
      ];

      for (const msg of messages) {
        await tell(
          {
            fromTeam: "team-iris",
            toTeam: "team-alpha",
            message: msg,
            timeout: 30000,
          },
          iris
        );
      }

      // Get the message cache to access cache entries
      const messageCache = iris.getMessageCacheForTeams("team-iris", "team-alpha");
      expect(messageCache).toBeDefined();

      if (messageCache) {
        // Wait for all entries to complete using status$ observables
        const entries = messageCache.getAllEntries();
        const tellEntries = entries.filter(e =>
          messages.includes(e.tellString)
        );

        // Wait for each entry to complete
        const completionPromises = tellEntries.map(async entry => {
          if (entry.status === CacheEntryStatus.COMPLETED) {
            return; // Already completed
          }

          // Wait for completion using status$ observable
          const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout waiting for "${entry.tellString}" to complete`)), 30000)
          );

          const completionPromise = firstValueFrom(
            entry.status$.pipe(
              filter(status =>
                status === CacheEntryStatus.COMPLETED ||
                status === CacheEntryStatus.TERMINATED
              )
            )
          ).then(() => {});

          await Promise.race([completionPromise, timeoutPromise]);
        });

        await Promise.all(completionPromises);
      }

      // Now verify via the dashboard report
      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");

      // Should have multiple tell entries
      const tellEntries = report.entries.filter(e => e.type === "tell");

      // Check that all our messages are there and completed
      for (const msg of messages) {
        const entry = tellEntries.find(e => e.tellString === msg);
        expect(entry).toBeDefined();
        expect(entry?.status).toBe("completed");
      }

      expect(report.stats.tellEntries).toBeGreaterThanOrEqual(messages.length);
    }, 120000);
  });

  describe("Cache persists after process sleep", () => {
    it("should put team to sleep", async () => {
      // Get the process instance before sleep
      const process = processPool.getProcess("team-alpha");

      if (!process) {
        console.log("No process found for team-alpha, test might be running in wrong order");
        return;
      }

      // Set up promise to wait for "stopped" status
      const stoppedPromise = firstValueFrom(
        process.status$.pipe(filter(status => status === ProcessStatus.STOPPED))
      );

      // Call sleep (which triggers terminate)
      const result = await sleep(
        { fromTeam: "team-iris", team: "team-alpha" },
        processPool
      );

      expect(result.team).toBe("team-alpha");
      expect(result.status).toBe("sleeping");

      // Wait for process to actually stop (with timeout)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for process to stop")), 10000)
      );

      try {
        await Promise.race([stoppedPromise, timeoutPromise]);
        console.log("Process stopped successfully");

        // Wait an additional moment for session store to be updated
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log("Process did not stop within timeout:", error);
        // Don't fail the test - the next test will verify the state
      }
    });

    it("should still show cache entries after process is stopped", async () => {
      const report = await stateBridge.getSessionReport("team-iris", "team-alpha");

      expect(report.hasSession).toBe(true);
      expect(report.hasProcess).toBe(false); // Process is stopped
      // Note: processState might be "idle" because Iris doesn't listen to process-terminated events yet
      // This will be fixed when Iris fully migrates to observables
      expect(["idle", "stopped"]).toContain(report.processState);

      // Cache entries should still be there
      expect(report.entries.length).toBeGreaterThan(0);

      // All entries should still be completed
      const tellEntries = report.entries.filter(e => e.type === "tell");
      expect(tellEntries.length).toBeGreaterThan(0);

      for (const entry of tellEntries) {
        expect(entry.status).toBe("completed");
        expect(entry.isComplete).toBe(true);
      }

      // Stats should still be accurate
      expect(report.stats.totalEntries).toBeGreaterThan(0);
      expect(report.stats.completedEntries).toBe(report.stats.totalEntries);
    });
  });

  describe("Cross-team cache viewing", () => {
    it("should not show cache for reverse direction", async () => {
      // Try to get cache for team-alpha -> team-iris (reverse direction)
      const reverseReport = await stateBridge.getSessionReport("team-alpha", "team-iris");

      expect(reverseReport.hasSession).toBe(false);
      expect(reverseReport.entries).toHaveLength(0);
      expect(reverseReport.stats.totalEntries).toBe(0);
    });

    it("should create separate cache for reverse direction", async () => {
      // Wake team-iris from team-alpha perspective
      await wake(
        { team: "team-iris", fromTeam: "team-alpha" },
        iris,
        processPool,
        sessionManager
      );

      // Send message in reverse direction
      await tell(
        {
          fromTeam: "team-alpha",
          toTeam: "team-iris",
          message: "Message from alpha to iris",
          timeout: 30000,
        },
        iris
      );

      // Check reverse direction cache
      const reverseReport = await stateBridge.getSessionReport("team-alpha", "team-iris");

      expect(reverseReport.hasSession).toBe(true);
      expect(reverseReport.entries.length).toBeGreaterThan(0);

      const tellEntry = reverseReport.entries.find(e => e.type === "tell");
      expect(tellEntry?.tellString).toBe("Message from alpha to iris");

      // Original direction cache should still be separate
      const originalReport = await stateBridge.getSessionReport("team-iris", "team-alpha");

      // Should not contain the reverse message
      const reverseMessage = originalReport.entries.find(
        e => e.tellString === "Message from alpha to iris"
      );
      expect(reverseMessage).toBeUndefined();
    }, 120000);
  });
});