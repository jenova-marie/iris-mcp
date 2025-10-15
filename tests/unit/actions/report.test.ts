import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { report } from "../../../src/actions/report.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import type { MessageCache } from "../../../src/cache/message-cache.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock the validation
vi.mock("../../../src/utils/validation.js", () => ({
  validateTeamName: vi.fn(),
}));

describe("report", () => {
  let mockIris: IrisOrchestrator;
  let mockMessageCache: MessageCache;

  beforeEach(() => {
    mockMessageCache = {
      sessionId: "session-123",
      fromTeam: "team-beta",
      toTeam: "team-alpha",
      getAllEntries: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({
        totalEntries: 0,
        spawnEntries: 0,
        tellEntries: 0,
        activeEntries: 0,
        completedEntries: 0,
      }),
    } as unknown as MessageCache;

    mockIris = {
      getMessageCacheForTeams: vi.fn(),
      getSession: vi.fn(),
      isAwake: vi.fn().mockReturnValue(false),
    } as unknown as IrisOrchestrator;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("no session exists", () => {
    it("should return empty report when no cache exists", async () => {
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(null);

      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        fromTeam: "team-beta",
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
        timestamp: expect.any(Number),
      });
    });
  });

  describe("session exists with cache", () => {
    it("should return cache report when cache exists", async () => {
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(
        mockMessageCache,
      );

      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        fromTeam: "team-beta",
        hasSession: true,
        hasProcess: false,
        allComplete: true,
        sessionId: "session-123",
        entries: [],
        stats: {
          totalEntries: 0,
          spawnEntries: 0,
          tellEntries: 0,
          activeEntries: 0,
          completedEntries: 0,
        },
        timestamp: expect.any(Number),
      });
    });
  });

  describe("validation", () => {
    it("should validate team names", async () => {
      const { validateTeamName } = await import(
        "../../../src/utils/validation.js"
      );

      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(null);

      await report({ team: "team-alpha", fromTeam: "team-beta" }, mockIris);

      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-alpha");
      expect(vi.mocked(validateTeamName)).toHaveBeenCalledWith("team-beta");
    });
  });

  describe("timing", () => {
    it("should include timestamp", async () => {
      vi.mocked(mockIris.getMessageCacheForTeams).mockReturnValue(null);

      const result = await report(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
      );

      expect(result.timestamp).toBeGreaterThan(0);
    });
  });
});
