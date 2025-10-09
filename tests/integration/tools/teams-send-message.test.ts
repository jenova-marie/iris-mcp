/**
 * Integration tests for teams_send_message tool
 * Tests mechanism without validating response content
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { teamsSendMessage } from "../../../src/tools/teams-send-message.js";
import {
  createTestFixture,
  cleanupTestFixture,
  type TestFixture,
} from "./utils/test-helpers.js";

describe("teams_send_message Integration", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture("teams-send-message");
  });

  afterEach(async () => {
    await cleanupTestFixture(fixture);
  });

  describe("synchronous messaging (waitForResponse=true)", () => {
    it("should send message and wait for response", async () => {
      const result = await teamsSendMessage(
        {
          toTeam: "backend",
          message: "Test message",
          waitForResponse: true,
        },
        fixture.pool,
      );

      expect(result).toBeDefined();
      expect(result.to).toBe("backend");
      expect(result.message).toBe("Test message");
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe("string");
      expect(result.async).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should include fromTeam in result", async () => {
      const result = await teamsSendMessage(
        {
          fromTeam: "mobile",
          toTeam: "backend",
          message: "Test from mobile",
          waitForResponse: true,
        },
        fixture.pool,
      );

      expect(result.from).toBe("mobile");
      expect(result.to).toBe("backend");
      expect(result.response).toBeDefined();
    });
  });

  describe("asynchronous messaging (waitForResponse=false)", () => {
    it("should send message without waiting for response", async () => {
      const result = await teamsSendMessage(
        {
          toTeam: "backend",
          message: "Background task",
          waitForResponse: false,
        },
        fixture.pool,
      );

      expect(result).toBeDefined();
      expect(result.to).toBe("backend");
      expect(result.message).toBe("Background task");
      expect(result.async).toBe(true);
      expect(result.response).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should return quickly for async messages", async () => {
      const startTime = Date.now();

      await teamsSendMessage(
        {
          toTeam: "backend",
          message: "Async message",
          waitForResponse: false,
        },
        fixture.pool,
      );

      const duration = Date.now() - startTime;

      // Async should return much faster than typical Claude response (< 8s)
      expect(duration).toBeLessThan(8000);
    });
  });

  describe("default behavior", () => {
    it("should default to waitForResponse=true", async () => {
      const result = await teamsSendMessage(
        {
          toTeam: "mobile",
          message: "Default behavior test",
        },
        fixture.pool,
      );

      expect(result.async).toBe(false);
      expect(result.response).toBeDefined();
    });
  });

  describe("validation errors", () => {
    it("should throw error for invalid team name", async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: "../invalid",
            message: "test",
          },
          fixture.pool,
        ),
      ).rejects.toThrow("Team name contains invalid characters");
    });

    it("should throw error for empty message", async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: "backend",
            message: "",
          },
          fixture.pool,
        ),
      ).rejects.toThrow("Message is required");
    });

    it("should throw error for non-existent team", async () => {
      await expect(
        teamsSendMessage(
          {
            toTeam: "nonexistent",
            message: "test",
          },
          fixture.pool,
        ),
      ).rejects.toThrow('Team "nonexistent" not found');
    });
  });
});
