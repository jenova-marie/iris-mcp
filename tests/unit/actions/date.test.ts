import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { date } from "../../../src/actions/date.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("date", () => {
  beforeEach(() => {
    // Reset any Date mocks
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should return current date/time", async () => {
      const before = Date.now();
      const result = await date({});
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it("should return ISO 8601 formatted string", async () => {
      const result = await date({});

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(result.iso).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it("should return UTC string", async () => {
      const result = await date({});

      // UTC string format: "Day, DD Mon YYYY HH:MM:SS GMT"
      expect(result.utc).toMatch(
        /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
      );
    });

    it("should return Unix timestamp in seconds", async () => {
      const result = await date({});

      // Unix timestamp should be roughly current time / 1000
      const expectedUnix = Math.floor(Date.now() / 1000);
      expect(result.unix).toBeGreaterThanOrEqual(expectedUnix - 1);
      expect(result.unix).toBeLessThanOrEqual(expectedUnix + 1);
    });

    it("should return valid date components", async () => {
      const result = await date({});

      expect(result.components.year).toBeGreaterThan(2020);
      expect(result.components.month).toBeGreaterThanOrEqual(1);
      expect(result.components.month).toBeLessThanOrEqual(12);
      expect(result.components.day).toBeGreaterThanOrEqual(1);
      expect(result.components.day).toBeLessThanOrEqual(31);
      expect(result.components.hours).toBeGreaterThanOrEqual(0);
      expect(result.components.hours).toBeLessThanOrEqual(23);
      expect(result.components.minutes).toBeGreaterThanOrEqual(0);
      expect(result.components.minutes).toBeLessThanOrEqual(59);
      expect(result.components.seconds).toBeGreaterThanOrEqual(0);
      expect(result.components.seconds).toBeLessThanOrEqual(59);
      expect(result.components.milliseconds).toBeGreaterThanOrEqual(0);
      expect(result.components.milliseconds).toBeLessThanOrEqual(999);
    });

    it("should return valid day of week", async () => {
      const result = await date({});

      // 0 = Sunday, 6 = Saturday
      expect(result.components.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(result.components.dayOfWeek).toBeLessThanOrEqual(6);
    });

    it("should return valid day of year", async () => {
      const result = await date({});

      // 1-366 (accounting for leap years)
      expect(result.components.dayOfYear).toBeGreaterThanOrEqual(1);
      expect(result.components.dayOfYear).toBeLessThanOrEqual(366);
    });
  });

  describe("consistency", () => {
    it("should have consistent timestamp and ISO representation", async () => {
      const result = await date({});

      const parsedIso = new Date(result.iso).getTime();
      expect(parsedIso).toBe(result.timestamp);
    });

    it("should have consistent timestamp and UTC representation", async () => {
      const result = await date({});

      const parsedUtc = new Date(result.utc).getTime();
      // UTC string doesn't preserve milliseconds, so we compare seconds
      expect(Math.floor(parsedUtc / 1000)).toBe(
        Math.floor(result.timestamp / 1000),
      );
    });

    it("should have consistent timestamp and unix timestamp", async () => {
      const result = await date({});

      const timestampInSeconds = Math.floor(result.timestamp / 1000);
      expect(timestampInSeconds).toBe(result.unix);
    });

    it("should have consistent components with ISO string", async () => {
      const result = await date({});

      const parsed = new Date(result.iso);
      expect(result.components.year).toBe(parsed.getUTCFullYear());
      expect(result.components.month).toBe(parsed.getUTCMonth() + 1);
      expect(result.components.day).toBe(parsed.getUTCDate());
      expect(result.components.hours).toBe(parsed.getUTCHours());
      expect(result.components.minutes).toBe(parsed.getUTCMinutes());
      expect(result.components.seconds).toBe(parsed.getUTCSeconds());
      expect(result.components.milliseconds).toBe(parsed.getUTCMilliseconds());
      expect(result.components.dayOfWeek).toBe(parsed.getUTCDay());
    });
  });

  describe("output format", () => {
    it("should include all required top-level fields", async () => {
      const result = await date({});

      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("iso");
      expect(result).toHaveProperty("utc");
      expect(result).toHaveProperty("unix");
      expect(result).toHaveProperty("components");
    });

    it("should include all required component fields", async () => {
      const result = await date({});

      expect(result.components).toHaveProperty("year");
      expect(result.components).toHaveProperty("month");
      expect(result.components).toHaveProperty("day");
      expect(result.components).toHaveProperty("hours");
      expect(result.components).toHaveProperty("minutes");
      expect(result.components).toHaveProperty("seconds");
      expect(result.components).toHaveProperty("milliseconds");
      expect(result.components).toHaveProperty("dayOfWeek");
      expect(result.components).toHaveProperty("dayOfYear");
    });
  });

  describe("specific date validation", () => {
    it("should correctly calculate day of year for known date", async () => {
      // Mock Date to return a specific date: 2025-01-15 (15th day of year)
      const mockDate = new Date("2025-01-15T12:00:00.000Z");
      const RealDate = Date;
      vi.spyOn(global, "Date").mockImplementation(((...args: any[]) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new RealDate(...args);
      }) as any);

      const result = await date({});

      expect(result.components.year).toBe(2025);
      expect(result.components.month).toBe(1);
      expect(result.components.day).toBe(15);
      expect(result.components.dayOfYear).toBe(15);

      vi.restoreAllMocks();
    });

    it("should correctly calculate day of year for leap year", async () => {
      // Mock Date to return a specific date: 2024-03-01 (61st day of leap year)
      const mockDate = new Date("2024-03-01T12:00:00.000Z");
      const RealDate = Date;
      vi.spyOn(global, "Date").mockImplementation(((...args: any[]) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new RealDate(...args);
      }) as any);

      const result = await date({});

      expect(result.components.year).toBe(2024);
      expect(result.components.month).toBe(3);
      expect(result.components.day).toBe(1);
      expect(result.components.dayOfYear).toBe(61);

      vi.restoreAllMocks();
    });

    it("should correctly handle New Year's Day", async () => {
      // Mock Date to return January 1st
      const mockDate = new Date("2025-01-01T00:00:00.000Z");
      const RealDate = Date;
      vi.spyOn(global, "Date").mockImplementation(((...args: any[]) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new RealDate(...args);
      }) as any);

      const result = await date({});

      expect(result.components.year).toBe(2025);
      expect(result.components.month).toBe(1);
      expect(result.components.day).toBe(1);
      expect(result.components.dayOfYear).toBe(1);

      vi.restoreAllMocks();
    });

    it("should correctly handle last day of year", async () => {
      // Mock Date to return December 31st
      const mockDate = new Date("2025-12-31T23:59:59.999Z");
      const RealDate = Date;
      vi.spyOn(global, "Date").mockImplementation(((...args: any[]) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new RealDate(...args);
      }) as any);

      const result = await date({});

      expect(result.components.year).toBe(2025);
      expect(result.components.month).toBe(12);
      expect(result.components.day).toBe(31);
      expect(result.components.dayOfYear).toBe(365);

      vi.restoreAllMocks();
    });
  });

  describe("UTC compliance", () => {
    it("should return UTC time regardless of system timezone", async () => {
      const result = await date({});

      // ISO string should end with 'Z' indicating UTC
      expect(result.iso).toMatch(/Z$/);

      // UTC string should contain 'GMT'
      expect(result.utc).toMatch(/GMT$/);
    });

    it("should have components in UTC", async () => {
      const result = await date({});

      // Create a Date object and verify components match UTC methods
      const now = new Date(result.timestamp);
      expect(result.components.year).toBe(now.getUTCFullYear());
      expect(result.components.month).toBe(now.getUTCMonth() + 1);
      expect(result.components.day).toBe(now.getUTCDate());
      expect(result.components.hours).toBe(now.getUTCHours());
      expect(result.components.minutes).toBe(now.getUTCMinutes());
      expect(result.components.seconds).toBe(now.getUTCSeconds());
    });
  });

  describe("performance", () => {
    it("should execute quickly", async () => {
      const start = performance.now();
      await date({});
      const end = performance.now();

      // Should complete in less than 10ms
      expect(end - start).toBeLessThan(10);
    });

    it("should be consistent across multiple calls", async () => {
      const results = await Promise.all([date({}), date({}), date({})]);

      // All timestamps should be within 10ms of each other
      const timestamps = results.map((r) => r.timestamp);
      const min = Math.min(...timestamps);
      const max = Math.max(...timestamps);
      expect(max - min).toBeLessThan(10);
    });
  });
});
