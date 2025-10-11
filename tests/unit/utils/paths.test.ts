import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import {
  getIrisHome,
  getConfigPath,
  getDataDir,
  getSessionDbPath,
  ensureIrisHome,
} from "../../../src/utils/paths.js";

// Mock fs and os modules
vi.mock("fs");
vi.mock("os");

describe("paths utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getIrisHome", () => {
    it("should return IRIS_HOME from environment variable when set", () => {
      process.env.IRIS_HOME = "/custom/iris/path";

      const result = getIrisHome();

      expect(result).toBe(resolve("/custom/iris/path"));
    });

    it("should return default ~/.iris when IRIS_HOME not set", () => {
      delete process.env.IRIS_HOME;
      vi.mocked(homedir).mockReturnValue("/home/user");

      const result = getIrisHome();

      expect(result).toBe(resolve("/home/user/.iris"));
    });

    it("should resolve relative paths", () => {
      process.env.IRIS_HOME = "../relative/path";

      const result = getIrisHome();

      expect(result).toBe(resolve("../relative/path"));
    });
  });

  describe("getConfigPath", () => {
    it("should return config.json path inside IRIS_HOME", () => {
      process.env.IRIS_HOME = "/custom/iris";

      const result = getConfigPath();

      expect(result).toBe(resolve("/custom/iris", "config.json"));
    });

    it("should return default config path when IRIS_HOME not set", () => {
      delete process.env.IRIS_HOME;
      vi.mocked(homedir).mockReturnValue("/home/user");

      const result = getConfigPath();

      expect(result).toBe(resolve("/home/user/.iris", "config.json"));
    });
  });

  describe("getDataDir", () => {
    it("should return data directory path inside IRIS_HOME", () => {
      process.env.IRIS_HOME = "/custom/iris";

      const result = getDataDir();

      expect(result).toBe(resolve("/custom/iris", "data"));
    });

    it("should return default data path when IRIS_HOME not set", () => {
      delete process.env.IRIS_HOME;
      vi.mocked(homedir).mockReturnValue("/home/user");

      const result = getDataDir();

      expect(result).toBe(resolve("/home/user/.iris", "data"));
    });
  });

  describe("getSessionDbPath", () => {
    it("should return session database path", () => {
      process.env.IRIS_HOME = "/custom/iris";

      const result = getSessionDbPath();

      expect(result).toBe(resolve("/custom/iris/data", "team-sessions.db"));
    });

    it("should return default session db path when IRIS_HOME not set", () => {
      delete process.env.IRIS_HOME;
      vi.mocked(homedir).mockReturnValue("/home/user");

      const result = getSessionDbPath();

      expect(result).toBe(
        resolve("/home/user/.iris/data", "team-sessions.db")
      );
    });
  });

  describe("ensureIrisHome", () => {
    it("should create IRIS_HOME directory if it does not exist", () => {
      process.env.IRIS_HOME = "/custom/iris";
      vi.mocked(existsSync).mockReturnValue(false);

      ensureIrisHome();

      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        resolve("/custom/iris"),
        { recursive: true }
      );
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        resolve("/custom/iris/data"),
        { recursive: true }
      );
    });

    it("should create data directory if it does not exist", () => {
      process.env.IRIS_HOME = "/custom/iris";
      vi.mocked(existsSync)
        .mockReturnValueOnce(true) // IRIS_HOME exists
        .mockReturnValueOnce(false); // data dir does not exist

      ensureIrisHome();

      expect(vi.mocked(mkdirSync)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        resolve("/custom/iris/data"),
        { recursive: true }
      );
    });

    it("should not create directories if they already exist", () => {
      process.env.IRIS_HOME = "/custom/iris";
      vi.mocked(existsSync).mockReturnValue(true);

      ensureIrisHome();

      expect(vi.mocked(mkdirSync)).not.toHaveBeenCalled();
    });

    it("should work with default paths", () => {
      delete process.env.IRIS_HOME;
      vi.mocked(homedir).mockReturnValue("/home/user");
      vi.mocked(existsSync).mockReturnValue(false);

      ensureIrisHome();

      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        resolve("/home/user/.iris"),
        { recursive: true }
      );
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        resolve("/home/user/.iris/data"),
        { recursive: true }
      );
    });
  });
});
