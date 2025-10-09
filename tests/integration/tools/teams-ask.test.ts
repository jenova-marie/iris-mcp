/**
 * Integration tests for teams_ask tool
 * Tests mechanism without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { teamsAsk } from "../../../src/tools/teams-ask.js";
import {
  createTestFixture,
  cleanupTestFixture,
  type TestFixture,
} from "./utils/test-helpers.js";

describe("teams_ask Integration", () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture("teams-ask");
  });

  afterEach(async () => {
    await cleanupTestFixture(fixture);
  });

  describe("successful execution", () => {
    it("should send question and receive response", async () => {
      const result = await teamsAsk(
        {
          team: "frontend",
          question: "What is 2+2? Reply with just the number.",
          timeout: 8000,
        },
        fixture.pool,
      );

      expect(result).toBeDefined();
      expect(result.team).toBe("frontend");
      expect(result.question).toBe("What is 2+2? Reply with just the number.");
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe("string");
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThan(0);
    }, 8000);

    it("should handle asks to different teams", async () => {
      const result1 = await teamsAsk(
        {
          team: "frontend",
          question: "Frontend question",
          timeout: 8000,
        },
        fixture.pool,
      );

      const result2 = await teamsAsk(
        {
          team: "backend",
          question: "Backend question",
          timeout: 8000,
        },
        fixture.pool,
      );

      expect(result1.team).toBe("frontend");
      expect(result2.team).toBe("backend");
      expect(result1.response).toBeDefined();
      expect(result2.response).toBeDefined();
    }, 8000);

    it("should respect default timeout", async () => {
      const result = await teamsAsk(
        {
          team: "mobile",
          question: "Test question",
        },
        fixture.pool,
      );

      expect(result.response).toBeDefined();
    }, 8000);
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
    }, 5000);

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
    }, 5000);

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
    }, 5000);

    it("should throw error for question that is too long", async () => {
      const longQuestion = "x".repeat(100001); // Over 100k chars

      await expect(
        teamsAsk(
          {
            team: "frontend",
            question: longQuestion,
          },
          fixture.pool,
        ),
      ).rejects.toThrow("Message exceeds maximum length");
    }, 5000);

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
    }, 5000);

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
    }, 5000);
  });

  describe("timeout handling", () => {
    it("should respect custom timeout parameter", async () => {
      await expect(
        teamsAsk(
          {
            team: "frontend",
            question: "test",
            timeout: 50, // Very short timeout
          },
          fixture.pool,
        ),
      ).rejects.toThrow();
    }, 5000);
  });
});
