/**
 * Integration tests for teams_ask tool
 * Tests mechanism without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { teamsAsk } from "../../../src/tools/teams-ask.js";
import {
  createTestFixture,
  cleanupTestFixture,
  type TestFixture,
} from "./utils/test-helpers.js";

/**
 * Helper to read and output Claude debug logs on test failure
 */
async function outputDebugLogsOnFailure(
  fixture: TestFixture,
  testFn: () => Promise<void>,
) {
  try {
    await testFn();
  } catch (error) {
    // On failure, try to read debug logs from all processes
    const poolStatus = fixture.pool.getStatus();
    console.error("\n=== DEBUG LOGS ON FAILURE ===");

    for (const [poolKey, processInfo] of Object.entries(poolStatus.processes)) {
      const process = fixture.pool.getProcess(processInfo.teamName);
      if (process) {
        const debugLogPath = (process as any).getDebugLogPath?.();
        if (debugLogPath) {
          try {
            const logs = readFileSync(debugLogPath, "utf-8");
            console.error(
              `\n--- Debug logs for ${poolKey} (${debugLogPath}) ---`,
            );
            console.error(logs);
          } catch (logError) {
            console.error(
              `Failed to read debug logs from ${debugLogPath}:`,
              logError,
            );
          }
        }
      }
    }
    console.error("=== END DEBUG LOGS ===\n");
    throw error;
  }
}

describe("teams_ask Integration", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture("teams-ask");
  });

  afterEach(async () => {
    await cleanupTestFixture(fixture);
  });

  describe("successful execution", () => {
    it("should send question and receive response", async () => {
      await outputDebugLogsOnFailure(fixture, async () => {
        const result = await teamsAsk(
          {
            team: "frontend",
            question: "What is 2+2? Reply with just the number.",
          },
          fixture.pool,
        );

        expect(result).toBeDefined();
        expect(result.team).toBe("frontend");
        expect(result.question).toBe(
          "What is 2+2? Reply with just the number.",
        );
        expect(result.response).toBeDefined();
        expect(typeof result.response).toBe("string");
        expect(result.response.length).toBeGreaterThan(0);
        expect(result.duration).toBeGreaterThan(0);
        expect(result.timestamp).toBeGreaterThan(0);
      });
    });

    it(
      "should handle asks to different teams",
      async () => {
        const result1 = await teamsAsk(
          {
            team: "frontend",
            question: "Frontend question",
          },
          fixture.pool,
        );

        const result2 = await teamsAsk(
          {
            team: "backend",
            question: "Backend question",
          },
          fixture.pool,
        );

        expect(result1.team).toBe("frontend");
        expect(result2.team).toBe("backend");
        expect(result1.response).toBeDefined();
        expect(result2.response).toBeDefined();
      },
      { timeout: 40000 },
    ); // 2x testTimeout - spawns 2 Claude processes

    it("should respect default timeout", async () => {
      const result = await teamsAsk(
        {
          team: "mobile",
          question: "Test question",
        },
        fixture.pool,
      );

      expect(result.response).toBeDefined();
    });
  });

  describe("validation errors", () => {
    it("should throw error for invalid team name with path traversal", async () => {
      await expect(
        teamsAsk(
          {
            team: "../invalid",
            question: "test",
          },
          fixture.pool,
        ),
      ).rejects.toThrow("Team name contains invalid characters");
    });

    it("should throw error for empty team name", async () => {
      await expect(
        teamsAsk(
          {
            team: "",
            question: "test",
          },
          fixture.pool,
        ),
      ).rejects.toThrow();
    });

    it("should throw error for empty question", async () => {
      await expect(
        teamsAsk(
          {
            team: "frontend",
            question: "",
          },
          fixture.pool,
        ),
      ).rejects.toThrow("Message is required");
    });

    it("should throw error for non-existent team", async () => {
      await expect(
        teamsAsk(
          {
            team: "nonexistent",
            question: "test",
          },
          fixture.pool,
        ),
      ).rejects.toThrow('Team "nonexistent" not found');
    });

    it("should throw error for invalid timeout", async () => {
      await expect(
        teamsAsk(
          {
            team: "frontend",
            question: "test",
            timeout: -1,
          },
          fixture.pool,
        ),
      ).rejects.toThrow();
    });
  });

  describe("timeout handling", () => {
    it("should respect custom timeout parameter", async () => {
      await expect(
        teamsAsk(
          {
            team: "frontend",
            question: "test",
            timeout: 50, // Very short timeout to force failure
          },
          fixture.pool,
        ),
      ).rejects.toThrow();
    });
  });
});
