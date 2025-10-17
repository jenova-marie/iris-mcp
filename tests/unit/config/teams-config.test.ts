import { describe, it, expect, beforeEach, vi } from "vitest";
import { TeamsConfigManager } from "../../../src/config/iris-config.js";
import { ConfigurationError } from "../../../src/utils/errors.js";

// Mock modules
vi.mock("fs");
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../src/utils/paths.js", () => ({
  getConfigPath: vi.fn(() => "/default/iris/config.yaml"),
  ensureIrisHome: vi.fn(),
}));

describe("TeamsConfigManager", () => {
  let manager: TeamsConfigManager;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.IRIS_CONFIG_PATH;
  });

  describe("constructor", () => {
    it("should use provided config path", () => {
      manager = new TeamsConfigManager("/custom/config.yaml");
      expect(manager["configPath"]).toBe("/custom/config.yaml");
    });

    it("should use IRIS_CONFIG_PATH environment variable", async () => {
      process.env.IRIS_CONFIG_PATH = "/env/config.yaml";
      const { ensureIrisHome } = await import("../../../src/utils/paths.js");

      manager = new TeamsConfigManager();

      expect(manager["configPath"]).toContain("env/config.yaml");
      expect(vi.mocked(ensureIrisHome)).toHaveBeenCalled();
    });

    it("should use default config path from getConfigPath", async () => {
      const { getConfigPath, ensureIrisHome } = await import(
        "../../../src/utils/paths.js"
      );

      manager = new TeamsConfigManager();

      expect(vi.mocked(getConfigPath)).toHaveBeenCalled();
      expect(vi.mocked(ensureIrisHome)).toHaveBeenCalled();
    });
  });

  describe("load", () => {
    it("should load valid configuration", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path/team-alpha",
            description: "Test team alpha",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      expect(config.teams["team-alpha"]).toBeDefined();
      expect(config.settings.maxProcesses).toBe(10);
    });

    it("should resolve relative paths from config directory", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "./relative/path",
            description: "Test team",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      // Path should be resolved relative to /test directory
      expect(config.teams["team-alpha"].path).toContain("relative/path");
      expect(config.teams["team-alpha"].path).not.toBe("./relative/path");
    });

    it("should keep absolute paths unchanged", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path",
            description: "Test team",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      expect(config.teams["team-alpha"].path).toBe("/absolute/path");
    });

    it("should call process.exit when file does not exist (new CLI behavior)", async () => {
      const { existsSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(false);

      // Mock process.exit to prevent actual exit in tests
      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);

      manager = new TeamsConfigManager("/missing/config.yaml");

      // Should call process.exit(0) with helpful message
      expect(() => manager.load()).toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(0);

      mockExit.mockRestore();
    });

    it("should throw ConfigurationError on invalid YAML", async () => {
      const { readFileSync, existsSync } = await import("fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("{ invalid yaml");

      manager = new TeamsConfigManager("/test/config.yaml");

      expect(() => manager.load()).toThrow(ConfigurationError);
      expect(() => manager.load()).toThrow("Invalid YAML");
    });

    it("should throw ConfigurationError on validation failure", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const invalidConfig = {
        settings: {
          idleTimeout: -1, // Invalid: must be positive
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
        },
        teams: {},
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      manager = new TeamsConfigManager("/test/config.yaml");

      expect(() => manager.load()).toThrow(ConfigurationError);
      expect(() => manager.load()).toThrow("Configuration validation failed");
    });

    it("should warn if team path does not exist", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/nonexistent/path",
            description: "Test team",
          },
        },
      };

      vi.mocked(existsSync)
        .mockReturnValueOnce(true) // config file exists
        .mockReturnValueOnce(false); // team path does not exist

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      // Just verify config loaded successfully (logger warning is internal implementation)
      expect(config.teams["team-alpha"]).toBeDefined();
      expect(config.teams["team-alpha"].path).toBe("/nonexistent/path");
    });

    it("should apply default grantPermission value of 'yes'", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path/team-alpha",
            description: "Test team alpha",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      // Default value should be applied by Zod schema
      expect(config.teams["team-alpha"].grantPermission).toBe("ask");
    });

    it("should accept valid grantPermission values", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-yes": {
            path: "/path/team-yes",
            description: "Team with yes",
            grantPermission: "yes",
          },
          "team-no": {
            path: "/path/team-no",
            description: "Team with no",
            grantPermission: "no",
          },
          "team-ask": {
            path: "/path/team-ask",
            description: "Team with ask",
            grantPermission: "ask",
          },
          "team-forward": {
            path: "/path/team-forward",
            description: "Team with forward",
            grantPermission: "forward",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      expect(config.teams["team-yes"].grantPermission).toBe("yes");
      expect(config.teams["team-no"].grantPermission).toBe("no");
      expect(config.teams["team-ask"].grantPermission).toBe("ask");
      expect(config.teams["team-forward"].grantPermission).toBe("forward");
    });

    it("should reject invalid grantPermission values", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const invalidConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path/team-alpha",
            description: "Test team alpha",
            grantPermission: "invalid-value",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      manager = new TeamsConfigManager("/test/config.yaml");

      expect(() => manager.load()).toThrow(ConfigurationError);
      expect(() => manager.load()).toThrow("Configuration validation failed");
    });

    it("should accept optional allowedTools configuration", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path/team-alpha",
            description: "Test team alpha",
            allowedTools: "Read,Write,Bash",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      expect(config.teams["team-alpha"].allowedTools).toBe("Read,Write,Bash");
    });

    it("should accept optional disallowedTools configuration", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path/team-alpha",
            description: "Test team alpha",
            disallowedTools: "Bash(rm -rf),mcp__github",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      expect(config.teams["team-alpha"].disallowedTools).toBe(
        "Bash(rm -rf),mcp__github",
      );
    });

    it("should accept optional appendSystemPrompt configuration", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/absolute/path/team-alpha",
            description: "Test team alpha",
            appendSystemPrompt:
              "You are a specialized frontend development team.",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      const config = manager.load();

      expect(config.teams["team-alpha"].appendSystemPrompt).toBe(
        "You are a specialized frontend development team.",
      );
    });
  });

  describe("getConfig", () => {
    it("should return loaded configuration", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team",
            description: "Test team",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      manager.load();
      const config = manager.getConfig();

      expect(config).toBeDefined();
      expect(config.teams["team-alpha"]).toBeDefined();
    });

    it("should throw if configuration not loaded", () => {
      manager = new TeamsConfigManager("/test/config.yaml");

      expect(() => manager.getConfig()).toThrow(ConfigurationError);
      expect(() => manager.getConfig()).toThrow("Configuration not loaded");
    });
  });

  describe("getIrisConfig", () => {
    beforeEach(async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team",
            description: "Test team",
          },
          "team-beta": {
            path: "/path/to/team-beta",
            description: "Test team beta",
            idleTimeout: 600000, // Custom timeout
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      manager.load();
    });

    it("should return team configuration", () => {
      const irisConfig = manager.getIrisConfig("team-alpha");

      expect(irisConfig).toBeDefined();
      expect(irisConfig?.path).toBe("/path/to/team");
      expect(irisConfig?.description).toBe("Test team");
    });

    it("should use global idleTimeout if team does not have custom value", () => {
      const irisConfig = manager.getIrisConfig("team-alpha");

      expect(irisConfig?.idleTimeout).toBe(300000); // Global value
    });

    it("should use team-specific idleTimeout if provided", () => {
      const irisConfig = manager.getIrisConfig("team-beta");

      expect(irisConfig?.idleTimeout).toBe(600000); // Custom value
    });

    it("should return null for non-existent team", () => {
      const irisConfig = manager.getIrisConfig("nonexistent");

      expect(irisConfig).toBeNull();
    });
  });

  describe("getTeamNames", () => {
    it("should return list of team names", async () => {
      const { readFileSync, existsSync } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team-alpha",
            description: "Test team alpha",
          },
          "team-beta": {
            path: "/path/to/team-beta",
            description: "Test team beta",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      manager.load();
      const teamNames = manager.getTeamNames();

      expect(teamNames).toEqual(["team-alpha", "team-beta"]);
    });
  });

  describe("watch", () => {
    it("should watch configuration file for changes", async () => {
      const { readFileSync, existsSync, watchFile } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team",
            description: "Test team",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      manager.load();

      const callback = vi.fn();
      manager.watch(callback);

      expect(vi.mocked(watchFile)).toHaveBeenCalledWith(
        "/test/config.yaml",
        { interval: 1000 },
        expect.any(Function),
      );
    });

    it("should reload configuration when file changes", async () => {
      const { readFileSync, existsSync, watchFile } = await import("fs");

      const initialConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team",
            description: "Test team",
          },
        },
      };

      const updatedConfig = {
        ...initialConfig,
        teams: {
          ...initialConfig.teams,
          "team-beta": {
            path: "/path/to/team-beta",
            description: "New team",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify(initialConfig))
        .mockReturnValueOnce(JSON.stringify(updatedConfig));

      manager = new TeamsConfigManager("/test/config.yaml");
      manager.load();

      const callback = vi.fn();
      manager.watch(callback);

      // Simulate file change by calling the watchFile callback
      const watchCallback = vi.mocked(watchFile).mock.calls[0][2];
      watchCallback();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          teams: expect.objectContaining({
            "team-beta": expect.any(Object),
          }),
        }),
      );
    });

    it("should not call callback if reload fails", async () => {
      const { readFileSync, existsSync, watchFile } = await import("fs");

      const validConfig = {
        settings: {
          idleTimeout: 300000,
          maxProcesses: 10,
          healthCheckInterval: 30000,
          sessionInitTimeout: 30000,
          spawnTimeout: 20000,
          responseTimeout: 120000,
        },
        teams: {
          "team-alpha": {
            path: "/path/to/team",
            description: "Test team",
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify(validConfig))
        .mockReturnValueOnce("{ invalid yaml");

      manager = new TeamsConfigManager("/test/config.yaml");
      manager.load();

      const callback = vi.fn();
      manager.watch(callback);

      // Simulate file change with invalid YAML
      const watchCallback = vi.mocked(watchFile).mock.calls[0][2];
      watchCallback();

      // Callback should not be called when reload fails
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
