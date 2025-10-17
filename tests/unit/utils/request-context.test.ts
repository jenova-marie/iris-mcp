/**
 * Unit tests for request-context utilities
 *
 * Tests AsyncLocalStorage integration for passing sessionId through MCP SDK
 * without explicit parameter passing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  runWithContext,
  getContext,
  getSessionId,
  type RequestContext,
} from "../../../src/utils/request-context.js";

describe("request-context", () => {
  beforeEach(() => {
    // AsyncLocalStorage is automatically cleared between tests
  });

  describe("runWithContext", () => {
    it("should run callback with context", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      const result = await runWithContext(context, async () => {
        return "test-result";
      });

      expect(result).toBe("test-result");
    });

    it("should make context available within callback", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await runWithContext(context, async () => {
        const retrievedContext = getContext();
        expect(retrievedContext).toEqual(context);
      });
    });

    it("should isolate contexts between calls", async () => {
      const context1: RequestContext = { sessionId: "session-1" };
      const context2: RequestContext = { sessionId: "session-2" };

      const promise1 = runWithContext(context1, async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getSessionId();
      });

      const promise2 = runWithContext(context2, async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getSessionId();
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe("session-1");
      expect(result2).toBe("session-2");
    });

    it("should propagate context through nested async calls", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await runWithContext(context, async () => {
        const level1SessionId = getSessionId();
        expect(level1SessionId).toBe("session-123");

        await new Promise<void>((resolve) => {
          setTimeout(() => {
            const level2SessionId = getSessionId();
            expect(level2SessionId).toBe("session-123");
            resolve();
          }, 5);
        });
      });
    });

    it("should handle errors in callback", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await expect(
        runWithContext(context, async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");
    });

    it("should handle synchronous callbacks", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      const result = await runWithContext(context, async () => {
        // Synchronous work
        return getSessionId();
      });

      expect(result).toBe("session-123");
    });
  });

  describe("getContext", () => {
    it("should return undefined outside context", () => {
      const context = getContext();
      expect(context).toBeUndefined();
    });

    it("should return context within runWithContext", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await runWithContext(context, async () => {
        const retrievedContext = getContext();
        expect(retrievedContext).toEqual({ sessionId: "session-123" });
      });
    });

    it("should return undefined after context ends", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await runWithContext(context, async () => {
        // Inside context
      });

      // Outside context now
      const contextAfter = getContext();
      expect(contextAfter).toBeUndefined();
    });
  });

  describe("getSessionId", () => {
    it("should return undefined outside context", () => {
      const sessionId = getSessionId();
      expect(sessionId).toBeUndefined();
    });

    it("should return sessionId within context", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await runWithContext(context, async () => {
        const sessionId = getSessionId();
        expect(sessionId).toBe("session-123");
      });
    });

    it("should return undefined if sessionId not set in context", async () => {
      const context: RequestContext = {}; // No sessionId

      await runWithContext(context, async () => {
        const sessionId = getSessionId();
        expect(sessionId).toBeUndefined();
      });
    });

    it("should handle multiple sequential contexts", async () => {
      const context1: RequestContext = { sessionId: "session-1" };
      const context2: RequestContext = { sessionId: "session-2" };

      await runWithContext(context1, async () => {
        expect(getSessionId()).toBe("session-1");
      });

      await runWithContext(context2, async () => {
        expect(getSessionId()).toBe("session-2");
      });
    });
  });

  describe("integration scenarios", () => {
    it("should work with nested runWithContext calls", async () => {
      const outerContext: RequestContext = { sessionId: "outer-session" };
      const innerContext: RequestContext = { sessionId: "inner-session" };

      await runWithContext(outerContext, async () => {
        expect(getSessionId()).toBe("outer-session");

        await runWithContext(innerContext, async () => {
          // Inner context overrides outer
          expect(getSessionId()).toBe("inner-session");
        });

        // Back to outer context
        expect(getSessionId()).toBe("outer-session");
      });
    });

    it("should maintain context across Promise.all", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      await runWithContext(context, async () => {
        const results = await Promise.all([
          (async () => getSessionId())(),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return getSessionId();
          })(),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return getSessionId();
          })(),
        ]);

        expect(results).toEqual([
          "session-123",
          "session-123",
          "session-123",
        ]);
      });
    });

    it("should work with async generators", async () => {
      const context: RequestContext = { sessionId: "session-123" };

      async function* generateWithContext() {
        yield getSessionId();
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield getSessionId();
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield getSessionId();
      }

      await runWithContext(context, async () => {
        const results: (string | undefined)[] = [];
        for await (const sessionId of generateWithContext()) {
          results.push(sessionId);
        }

        expect(results).toEqual([
          "session-123",
          "session-123",
          "session-123",
        ]);
      });
    });

    it("should handle rapid sequential calls", async () => {
      const promises = [];

      for (let i = 0; i < 100; i++) {
        const context: RequestContext = { sessionId: `session-${i}` };
        promises.push(
          runWithContext(context, async () => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            return getSessionId();
          }),
        );
      }

      const results = await Promise.all(promises);

      // Each context should maintain its own sessionId
      for (let i = 0; i < 100; i++) {
        expect(results[i]).toBe(`session-${i}`);
      }
    });
  });
});
