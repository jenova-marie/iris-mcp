/**
 * Unit tests for Dashboard State Bridge
 * Tests the cache report functionality
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DashboardStateBridge } from "../../../src/dashboard/server/state-bridge.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import type { SessionManager } from "../../../src/session/session-manager.js";
import type { TeamsConfigManager } from "../../../src/config/iris-config.js";
import type { MessageCache } from "../../../src/cache/message-cache.js";
import type { CacheEntry } from "../../../src/cache/types.js";
import { CacheEntryType } from "../../../src/cache/types.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock IrisOrchestrator
vi.mock("../../../src/iris.js", () => ({
  IrisOrchestrator: vi.fn().mockImplementation(() => ({
    getMessageCacheForTeams: vi.fn(),
    getSession: vi.fn(),
    isAwake: vi.fn(),
  })),
}));

describe("DashboardStateBridge", () => {
  let stateBridge: DashboardStateBridge;
  let mockProcessPool: ClaudeProcessPool;
  let mockSessionManager: SessionManager;
  let mockConfigManager: TeamsConfigManager;
  let mockMessageCache: MessageCache;

  beforeEach(() => {
    // Create mock process pool
    mockProcessPool = {
      on: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        processes: {},
        totalProcesses: 0,
        maxProcesses: 10,
        activeSessions: 0,
      }),
    } as unknown as ClaudeProcessPool;

    // Create mock session manager
    mockSessionManager = {
      listSessions: vi.fn().mockReturnValue([]),
      getSession: vi.fn(),
    } as unknown as SessionManager;

    // Create mock config manager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        settings: {
          maxProcesses: 10,
        },
        dashboard: {
          enabled: true,
        },
        teams: {
          "team-alpha": { path: "/path/alpha", description: "Team Alpha" },
          "team-beta": { path: "/path/beta", description: "Team Beta" },
        },
      }),
      getTeamNames: vi.fn().mockReturnValue(["team-alpha", "team-beta"]),
      getIrisConfig: vi.fn(),
    } as unknown as TeamsConfigManager;

    // Create mock message cache
    mockMessageCache = {
      sessionId: "test-session-123",
      fromTeam: "team-alpha",
      toTeam: "team-beta",
      getAllEntries: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({
        totalEntries: 0,
        spawnEntries: 0,
        tellEntries: 0,
        activeEntries: 0,
        completedEntries: 0,
      }),
    } as unknown as MessageCache;

    // Create state bridge (passing undefined for iris to test default behavior)
    stateBridge = new DashboardStateBridge(
      mockProcessPool,
      mockSessionManager,
      mockConfigManager,
      undefined
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getSessionReport - no session", () => {
    it("should return empty report when no session exists", async () => {
      // Mock iris to return no cache
      const mockIris = (stateBridge as any).iris;
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(null);

      const report = await stateBridge.getSessionReport("team-alpha", "team-beta");

      expect(report).toMatchObject({
        team: "team-beta",
        fromTeam: "team-alpha",
        hasSession: false,
        hasProcess: false,
        allComplete: true,
        entries: [],
        stats: {
          totalEntries: 0,
          spawnEntries: 0,
          tellEntries: 0,
          activeEntries: 0,
          completedEntries: 0,
        },
      });
      expect(report.timestamp).toBeGreaterThan(0);
    });
  });

  describe("getSessionReport - session with empty cache", () => {
    it("should return report with empty entries when cache exists but has no entries", async () => {
      // Mock iris to return cache with no entries
      const mockIris = (stateBridge as any).iris;
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(mockMessageCache);
      vi.mocked(mockIris.getSession).mockReturnValue({
        sessionId: "test-session-123",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        processState: "idle",
      });
      vi.mocked(mockIris.isAwake).mockReturnValue(false);

      const report = await stateBridge.getSessionReport("team-alpha", "team-beta");

      expect(report).toMatchObject({
        team: "team-beta",
        fromTeam: "team-alpha",
        hasSession: true,
        hasProcess: false,
        processState: "idle",
        sessionId: "test-session-123",
        allComplete: true,
        entries: [],
        stats: {
          totalEntries: 0,
          spawnEntries: 0,
          tellEntries: 0,
          activeEntries: 0,
          completedEntries: 0,
        },
      });
    });
  });

  describe("getSessionReport - session with cache entries", () => {
    it("should return report with cache entries", async () => {
      // Create mock cache entry
      const mockCacheEntry = {
        cacheEntryType: CacheEntryType.TELL,
        tellString: "Hello test",
        status: "completed",
        createdAt: Date.now(),
        completedAt: Date.now() + 1000,
        getMessages: vi.fn().mockReturnValue([
          {
            timestamp: Date.now(),
            type: "user",
            data: { message: "Hello" },
          },
          {
            timestamp: Date.now() + 500,
            type: "assistant",
            data: {
              message: {
                content: [
                  { type: "text", text: "Hello! How can I help you?" },
                ],
              },
            },
          },
          {
            timestamp: Date.now() + 1000,
            type: "result",
            data: { subtype: "success" },
          },
        ]),
      } as unknown as CacheEntry;

      // Mock cache to return one entry
      vi.mocked(mockMessageCache.getAllEntries).mockReturnValue([mockCacheEntry]);
      vi.mocked(mockMessageCache.getStats).mockReturnValue({
        totalEntries: 1,
        spawnEntries: 0,
        tellEntries: 1,
        activeEntries: 0,
        completedEntries: 1,
      });

      // Mock iris
      const mockIris = (stateBridge as any).iris;
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(mockMessageCache);
      vi.mocked(mockIris.getSession).mockReturnValue({
        sessionId: "test-session-123",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        processState: "idle",
      });
      vi.mocked(mockIris.isAwake).mockReturnValue(true);

      const report = await stateBridge.getSessionReport("team-alpha", "team-beta");

      expect(report).toMatchObject({
        team: "team-beta",
        fromTeam: "team-alpha",
        hasSession: true,
        hasProcess: true,
        processState: "idle",
        sessionId: "test-session-123",
        allComplete: true,
        stats: {
          totalEntries: 1,
          tellEntries: 1,
          completedEntries: 1,
        },
      });

      expect(report.entries).toHaveLength(1);
      expect(report.entries[0]).toMatchObject({
        type: "tell",
        tellString: "Hello test",
        status: "completed",
        isComplete: true,
        messageCount: 3,
      });

      // Check that assistant message was extracted
      const assistantMessage = report.entries[0].messages.find(
        (m: any) => m.type === "assistant"
      );
      expect(assistantMessage?.content).toBe("Hello! How can I help you?");
    });
  });

  describe("getSessionReport - session with active cache entry", () => {
    it("should show allComplete as false when cache entry is active", async () => {
      // Create mock cache entry that's not complete
      const mockActiveCacheEntry = {
        cacheEntryType: CacheEntryType.TELL,
        tellString: "Processing...",
        status: "active",
        createdAt: Date.now(),
        completedAt: null,
        getMessages: vi.fn().mockReturnValue([
          {
            timestamp: Date.now(),
            type: "user",
            data: { message: "Hello" },
          },
        ]),
      } as unknown as CacheEntry;

      // Mock cache to return active entry
      vi.mocked(mockMessageCache.getAllEntries).mockReturnValue([mockActiveCacheEntry]);
      vi.mocked(mockMessageCache.getStats).mockReturnValue({
        totalEntries: 1,
        spawnEntries: 0,
        tellEntries: 1,
        activeEntries: 1,
        completedEntries: 0,
      });

      // Mock iris
      const mockIris = (stateBridge as any).iris;
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(mockMessageCache);
      vi.mocked(mockIris.getSession).mockReturnValue({
        sessionId: "test-session-123",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        processState: "processing",
      });
      vi.mocked(mockIris.isAwake).mockReturnValue(true);

      const report = await stateBridge.getSessionReport("team-alpha", "team-beta");

      expect(report.allComplete).toBe(false);
      expect(report.processState).toBe("processing");
      expect(report.entries[0].isComplete).toBe(false);
      expect(report.stats.activeEntries).toBe(1);
      expect(report.stats.completedEntries).toBe(0);
    });
  });

  describe("getActiveSessions", () => {
    it("should combine session and process data", () => {
      // Mock session manager to return a session
      vi.mocked(mockSessionManager.listSessions).mockReturnValue([
        {
          sessionId: "test-123",
          fromTeam: "team-alpha",
          toTeam: "team-beta",
          messageCount: 5,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          status: "active",
          processState: "idle",
          lastResponseAt: null,
        },
      ]);

      // Mock process pool status
      vi.mocked(mockProcessPool.getStatus).mockReturnValue({
        processes: {
          "team-alpha->team-beta": {
            pid: 12345,
            status: "idle",
            messagesProcessed: 3,
            uptime: 60000,
            queueLength: 0,
            sessionId: "test-123",
            messageCount: 5,
            lastActivity: Date.now(),
            idleTimeRemaining: 240000,
          },
        },
        totalProcesses: 1,
        maxProcesses: 10,
        activeSessions: 1,
      });

      const sessions = stateBridge.getActiveSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        poolKey: "team-alpha->team-beta",
        fromTeam: "team-alpha",
        toTeam: "team-beta",
        sessionId: "test-123",
        messageCount: 5,
        processState: "idle",
        pid: 12345,
        messagesProcessed: 3,
        uptime: 60000,
        queueLength: 0,
      });
    });
  });

  describe("getPoolStatus", () => {
    it("should return pool status summary", () => {
      // Mock active sessions
      vi.mocked(mockSessionManager.listSessions).mockReturnValue([
        {
          sessionId: "test-123",
          fromTeam: "team-alpha",
          toTeam: "team-beta",
          messageCount: 5,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          status: "active",
          processState: "idle",
          lastResponseAt: null,
        },
        {
          sessionId: "test-456",
          fromTeam: "team-beta",
          toTeam: "team-alpha",
          messageCount: 3,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          status: "active",
          processState: "stopped",
          lastResponseAt: null,
        },
      ]);

      const status = stateBridge.getPoolStatus();

      expect(status).toEqual({
        totalSessions: 2,
        activeProcesses: 1, // Only one is not stopped
        maxProcesses: 10,
        configuredTeams: 2,
      });
    });
  });
});