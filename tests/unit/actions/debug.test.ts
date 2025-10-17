import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { debug } from "../../../src/actions/debug.js";
import {
  getMemoryLogs,
  getAllMemoryStoreNames,
} from "@jenova-marie/wonder-logger";

// Mock wonder-logger BEFORE any imports that use it
vi.mock("@jenova-marie/wonder-logger", () => ({
  getMemoryLogs: vi.fn(),
  getAllMemoryStoreNames: vi.fn(),
}));

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("debug", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.mocked(getMemoryLogs).mockReset();
    vi.mocked(getAllMemoryStoreNames).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic log querying", () => {
    it("should query all logs from default store", async () => {
      const mockLogs = [
        { level: "info", timestamp: 1000, message: "Test log 1" },
        { level: "error", timestamp: 2000, message: "Test log 2" },
      ];
      vi.mocked(getMemoryLogs).mockReturnValue(mockLogs);

      const result = await debug({});

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("iris-mcp", {
        since: undefined,
        format: "parsed",
        level: undefined,
      });
      expect(result.logs).toEqual(mockLogs);
      expect(result.logCount).toBe(2);
      expect(result.storeName).toBe("iris-mcp");
    });

    it("should query logs since timestamp", async () => {
      const since = Date.now() - 60000; // 1 minute ago
      const mockLogs = [
        { level: "info", timestamp: since + 1000, message: "Recent log" },
      ];
      vi.mocked(getMemoryLogs).mockReturnValue(mockLogs);

      const result = await debug({ logs_since: since });

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("iris-mcp", {
        since,
        format: "parsed",
        level: undefined,
      });
      expect(result.query.since).toBe(since);
      expect(result.logCount).toBe(1);
    });

    it("should query logs from custom store", async () => {
      const mockLogs = [{ level: "warn", timestamp: 3000, message: "Warning" }];
      vi.mocked(getMemoryLogs).mockReturnValue(mockLogs);

      const result = await debug({ storeName: "custom-store" });

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("custom-store", {
        since: undefined,
        format: "parsed",
        level: undefined,
      });
      expect(result.storeName).toBe("custom-store");
    });
  });

  describe("format options", () => {
    it("should default to parsed format", async () => {
      vi.mocked(getMemoryLogs).mockReturnValue([]);

      const result = await debug({});

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("iris-mcp", {
        since: undefined,
        format: "parsed",
        level: undefined,
      });
      expect(result.query.format).toBe("parsed");
    });

    it("should support raw format", async () => {
      vi.mocked(getMemoryLogs).mockReturnValue([]);

      const result = await debug({ format: "raw" });

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("iris-mcp", {
        since: undefined,
        format: "raw",
        level: undefined,
      });
      expect(result.query.format).toBe("raw");
    });
  });

  describe("level filtering", () => {
    it("should filter by single level", async () => {
      const mockLogs = [{ level: "error", timestamp: 1000, message: "Error" }];
      vi.mocked(getMemoryLogs).mockReturnValue(mockLogs);

      const result = await debug({ level: "error" });

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("iris-mcp", {
        since: undefined,
        format: "parsed",
        level: "error",
      });
      expect(result.query.level).toBe("error");
    });

    it("should filter by multiple levels", async () => {
      const mockLogs = [
        { level: "error", timestamp: 1000, message: "Error" },
        { level: "warn", timestamp: 2000, message: "Warning" },
      ];
      vi.mocked(getMemoryLogs).mockReturnValue(mockLogs);

      const result = await debug({ level: ["error", "warn"] });

      expect(vi.mocked(getMemoryLogs)).toHaveBeenCalledWith("iris-mcp", {
        since: undefined,
        format: "parsed",
        level: ["error", "warn"],
      });
      expect(result.query.level).toEqual(["error", "warn"]);
    });
  });

  describe("getAllStores mode", () => {
    it("should return available store names", async () => {
      const mockStores = ["iris-mcp", "custom-store", "test-store"];
      vi.mocked(getAllMemoryStoreNames).mockReturnValue(mockStores);

      const result = await debug({ getAllStores: true });

      expect(vi.mocked(getAllMemoryStoreNames)).toHaveBeenCalled();
      expect(vi.mocked(getMemoryLogs)).not.toHaveBeenCalled();
      expect(result.availableStores).toEqual(mockStores);
      expect(result.logCount).toBe(0);
    });
  });

  describe("validation", () => {
    it("should reject negative logs_since", async () => {
      await expect(debug({ logs_since: -1000 })).rejects.toThrow(
        "logs_since must be a positive number",
      );
    });

    it("should reject future logs_since", async () => {
      const future = Date.now() + 60000;
      await expect(debug({ logs_since: future })).rejects.toThrow(
        "cannot be in the future",
      );
    });

    it("should reject invalid format", async () => {
      await expect(debug({ format: "invalid" as any })).rejects.toThrow(
        'format must be either "raw" or "parsed"',
      );
    });

    it("should reject invalid log level", async () => {
      await expect(debug({ level: "invalid" })).rejects.toThrow(
        'Invalid level "invalid"',
      );
    });

    it("should reject invalid level in array", async () => {
      await expect(debug({ level: ["error", "invalid"] })).rejects.toThrow(
        'Invalid level "invalid"',
      );
    });
  });

  describe("output format", () => {
    it("should include all required fields", async () => {
      vi.mocked(getMemoryLogs).mockReturnValue([]);

      const result = await debug({});

      expect(result).toHaveProperty("logs");
      expect(result).toHaveProperty("logCount");
      expect(result).toHaveProperty("storeName");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("query");
    });

    it("should include query parameters in output", async () => {
      vi.mocked(getMemoryLogs).mockReturnValue([]);
      const since = Date.now() - 60000;

      const result = await debug({
        logs_since: since,
        format: "raw",
        level: "error",
      });

      expect(result.query).toEqual({
        since,
        format: "raw",
        level: "error",
      });
    });

    it("should include timestamp", async () => {
      vi.mocked(getMemoryLogs).mockReturnValue([]);

      const before = Date.now();
      const result = await debug({});
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("edge cases", () => {
    it("should handle empty logs array", async () => {
      vi.mocked(getMemoryLogs).mockReturnValue([]);

      const result = await debug({});

      expect(result.logs).toEqual([]);
      expect(result.logCount).toBe(0);
    });

    it("should handle large logs array", async () => {
      const largeLogs = Array.from({ length: 1000 }, (_, i) => ({
        level: "info",
        timestamp: i,
        message: `Log ${i}`,
      }));
      vi.mocked(getMemoryLogs).mockReturnValue(largeLogs);

      const result = await debug({});

      expect(result.logCount).toBe(1000);
      expect(result.logs).toHaveLength(1000);
    });

    it("should handle logs at exact since timestamp", async () => {
      const since = Date.now() - 60000;
      const mockLogs = [{ level: "info", timestamp: since, message: "Exact" }];
      vi.mocked(getMemoryLogs).mockReturnValue(mockLogs);

      const result = await debug({ logs_since: since });

      expect(result.logCount).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should propagate getMemoryLogs errors", async () => {
      vi.mocked(getMemoryLogs).mockImplementation(() => {
        throw new Error("Store not found");
      });

      await expect(debug({})).rejects.toThrow("Store not found");
    });

    it("should propagate getAllMemoryStoreNames errors", async () => {
      vi.mocked(getAllMemoryStoreNames).mockImplementation(() => {
        throw new Error("Registry error");
      });

      await expect(debug({ getAllStores: true })).rejects.toThrow(
        "Registry error",
      );
    });
  });
});
