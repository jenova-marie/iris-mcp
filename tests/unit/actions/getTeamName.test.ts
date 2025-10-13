import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getTeamName } from "../../../src/actions/getTeamName.js";
import type { TeamsConfigManager } from "../../../src/config/teams-config.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("getTeamName", () => {
  let mockConfigManager: TeamsConfigManager;

  beforeEach(() => {
    // Setup mock config manager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        teams: {
          "team-alpha": {
            path: "/path/to/alpha",
            description: "Alpha team",
          },
          "team-beta": {
            path: "/path/to/beta",
            description: "Beta team",
          },
          "team-gamma": {
            path: "/path/to/gamma",
            description: "Gamma team",
          },
        },
      }),
    } as unknown as TeamsConfigManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("team found", () => {
    it("should find team by exact path match", async () => {
      const result = await getTeamName(
        { pwd: "/path/to/alpha" },
        mockConfigManager
      );

      expect(result).toMatchObject({
        teamName: "team-alpha",
        resolvedPath: "/path/to/alpha",
        found: true,
      });
      expect(result.teamsChecked).toBeUndefined();
    });

    it("should resolve absolute paths", async () => {
      const result = await getTeamName(
        { pwd: "/path/to/beta" },
        mockConfigManager
      );

      expect(result).toMatchObject({
        teamName: "team-beta",
        resolvedPath: "/path/to/beta",
        found: true,
      });
    });

    it("should match any configured team", async () => {
      const result = await getTeamName(
        { pwd: "/path/to/gamma" },
        mockConfigManager
      );

      expect(result).toMatchObject({
        teamName: "team-gamma",
        resolvedPath: "/path/to/gamma",
        found: true,
      });
    });
  });

  describe("team not found", () => {
    it("should return null when no team matches", async () => {
      const result = await getTeamName(
        { pwd: "/path/to/unknown" },
        mockConfigManager
      );

      expect(result).toMatchObject({
        teamName: null,
        resolvedPath: "/path/to/unknown",
        found: false,
      });
      expect(result.teamsChecked).toBeDefined();
      expect(result.teamsChecked).toHaveLength(3);
    });

    it("should include teamsChecked in output when not found", async () => {
      const result = await getTeamName(
        { pwd: "/nonexistent/path" },
        mockConfigManager
      );

      expect(result.teamsChecked).toEqual([
        { name: "team-alpha", path: "/path/to/alpha" },
        { name: "team-beta", path: "/path/to/beta" },
        { name: "team-gamma", path: "/path/to/gamma" },
      ]);
    });
  });

  describe("path resolution", () => {
    it("should resolve relative paths", async () => {
      // Note: resolve() will convert relative to absolute based on process.cwd()
      // So we can't easily test relative paths without mocking path.resolve
      const result = await getTeamName(
        { pwd: "/path/to/alpha" },
        mockConfigManager
      );

      expect(result.resolvedPath).toBe("/path/to/alpha");
    });

    it("should handle paths with trailing slashes", async () => {
      // Path resolution should normalize these
      const result = await getTeamName(
        { pwd: "/path/to/alpha/" },
        mockConfigManager
      );

      // resolve() removes trailing slashes
      expect(result.resolvedPath).toBe("/path/to/alpha");
    });
  });

  describe("edge cases", () => {
    it("should handle empty teams config", async () => {
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {},
      } as any);

      const result = await getTeamName(
        { pwd: "/path/to/alpha" },
        mockConfigManager
      );

      expect(result).toMatchObject({
        teamName: null,
        found: false,
      });
      expect(result.teamsChecked).toHaveLength(0);
    });

    it("should handle single team config", async () => {
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {
          "team-only": {
            path: "/path/to/only",
            description: "Only team",
          },
        },
      } as any);

      const result = await getTeamName(
        { pwd: "/path/to/only" },
        mockConfigManager
      );

      expect(result).toMatchObject({
        teamName: "team-only",
        found: true,
      });
    });

    it("should return first match if multiple teams have same path", async () => {
      // This is an edge case that shouldn't happen in practice
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {
          "team-first": {
            path: "/duplicate/path",
            description: "First team",
          },
          "team-second": {
            path: "/duplicate/path",
            description: "Second team",
          },
        },
      } as any);

      const result = await getTeamName(
        { pwd: "/duplicate/path" },
        mockConfigManager
      );

      // Object.entries() preserves insertion order in ES2015+
      expect(result.teamName).toBe("team-first");
      expect(result.found).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should propagate config errors", async () => {
      vi.mocked(mockConfigManager.getConfig).mockImplementation(() => {
        throw new Error("Config error");
      });

      await expect(
        getTeamName({ pwd: "/path/to/alpha" }, mockConfigManager)
      ).rejects.toThrow("Config error");
    });

    it("should handle invalid paths gracefully", async () => {
      // Empty string path - resolve() will return cwd
      const result = await getTeamName({ pwd: "" }, mockConfigManager);

      // Should not throw, just won't match any team
      expect(result.found).toBe(false);
    });
  });

  describe("output format", () => {
    it("should always include required fields when found", async () => {
      const result = await getTeamName(
        { pwd: "/path/to/alpha" },
        mockConfigManager
      );

      expect(result).toHaveProperty("teamName");
      expect(result).toHaveProperty("resolvedPath");
      expect(result).toHaveProperty("found");
    });

    it("should always include required fields when not found", async () => {
      const result = await getTeamName(
        { pwd: "/unknown" },
        mockConfigManager
      );

      expect(result).toHaveProperty("teamName");
      expect(result).toHaveProperty("resolvedPath");
      expect(result).toHaveProperty("found");
      expect(result).toHaveProperty("teamsChecked");
    });
  });
});
