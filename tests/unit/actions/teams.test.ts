import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { teams } from "../../../src/actions/teams.js";
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

describe("teams", () => {
  let mockConfigManager: TeamsConfigManager;

  beforeEach(() => {
    // Setup mock config manager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        teams: {
          "team-alpha": {
            path: "/path/to/alpha",
            description: "Alpha team",
            color: "#FF0000",
            idleTimeout: 300000,
            skipPermissions: true,
          },
          "team-beta": {
            path: "/path/to/beta",
            description: "Beta team",
            color: "#00FF00",
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

  describe("basic listing", () => {
    it("should list all configured teams", async () => {
      const result = await teams({}, mockConfigManager);

      expect(result.teams).toHaveLength(3);
      expect(result.totalTeams).toBe(3);
      expect(result.teams.map((t) => t.name)).toEqual([
        "team-alpha",
        "team-beta",
        "team-gamma",
      ]);
    });

    it("should include team configuration", async () => {
      const result = await teams({}, mockConfigManager);

      const alphaTeam = result.teams.find((t) => t.name === "team-alpha");
      expect(alphaTeam?.config).toEqual({
        path: "/path/to/alpha",
        description: "Alpha team",
        color: "#FF0000",
        idleTimeout: 300000,
        skipPermissions: true,
      });
    });

    it("should sort teams alphabetically by name", async () => {
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {
          "team-zulu": { path: "/z", description: "Z" },
          "team-alpha": { path: "/a", description: "A" },
          "team-mike": { path: "/m", description: "M" },
        },
      } as any);

      const result = await teams({}, mockConfigManager);

      expect(result.teams.map((t) => t.name)).toEqual([
        "team-alpha",
        "team-mike",
        "team-zulu",
      ]);
    });

    it("should include all config fields when present", async () => {
      const result = await teams({}, mockConfigManager);

      const betaTeam = result.teams.find((t) => t.name === "team-beta");
      expect(betaTeam?.config).toEqual({
        path: "/path/to/beta",
        description: "Beta team",
        color: "#00FF00",
        idleTimeout: undefined,
        skipPermissions: undefined,
      });
    });

    it("should handle minimal team config", async () => {
      const result = await teams({}, mockConfigManager);

      const gammaTeam = result.teams.find((t) => t.name === "team-gamma");
      expect(gammaTeam?.config).toEqual({
        path: "/path/to/gamma",
        description: "Gamma team",
        color: undefined,
        idleTimeout: undefined,
        skipPermissions: undefined,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty teams config", async () => {
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {},
      } as any);

      const result = await teams({}, mockConfigManager);

      expect(result.teams).toHaveLength(0);
      expect(result.totalTeams).toBe(0);
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

      const result = await teams({}, mockConfigManager);

      expect(result.teams).toHaveLength(1);
      expect(result.totalTeams).toBe(1);
      expect(result.teams[0].name).toBe("team-only");
    });

    it("should include timestamp", async () => {
      const before = Date.now();
      const result = await teams({}, mockConfigManager);
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("error handling", () => {
    it("should propagate config errors", async () => {
      vi.mocked(mockConfigManager.getConfig).mockImplementation(() => {
        throw new Error("Config error");
      });

      await expect(teams({}, mockConfigManager)).rejects.toThrow(
        "Config error",
      );
    });
  });

  describe("output format", () => {
    it("should include all required top-level fields", async () => {
      const result = await teams({}, mockConfigManager);

      expect(result).toHaveProperty("teams");
      expect(result).toHaveProperty("totalTeams");
      expect(result).toHaveProperty("timestamp");
    });

    it("should include all required team fields", async () => {
      const result = await teams({}, mockConfigManager);

      const team = result.teams[0];
      expect(team).toHaveProperty("name");
      expect(team).toHaveProperty("config");
      expect(team.config).toHaveProperty("path");
    });

    it("should not include status field", async () => {
      const result = await teams({}, mockConfigManager);

      const team = result.teams[0];
      expect(team).not.toHaveProperty("status");
    });

    it("should not include process field", async () => {
      const result = await teams({}, mockConfigManager);

      const team = result.teams[0];
      expect(team).not.toHaveProperty("process");
    });
  });

  describe("team counting", () => {
    it("should correctly count multiple teams", async () => {
      const result = await teams({}, mockConfigManager);

      expect(result.totalTeams).toBe(3);
      expect(result.teams.length).toBe(result.totalTeams);
    });

    it("should correctly count zero teams", async () => {
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {},
      } as any);

      const result = await teams({}, mockConfigManager);

      expect(result.totalTeams).toBe(0);
      expect(result.teams.length).toBe(0);
    });

    it("should correctly count single team", async () => {
      vi.mocked(mockConfigManager.getConfig).mockReturnValue({
        teams: {
          "team-solo": { path: "/solo", description: "Solo" },
        },
      } as any);

      const result = await teams({}, mockConfigManager);

      expect(result.totalTeams).toBe(1);
      expect(result.teams.length).toBe(1);
    });
  });
});
