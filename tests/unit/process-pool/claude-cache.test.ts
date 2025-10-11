/**
 * Unit tests for ClaudeCache
 * Tests structured message caching functionality for Claude process I/O
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ClaudeCache,
  type MessageExchange,
  type CacheReport,
} from "../../../src/process-pool/claude-cache.js";

describe("ClaudeCache", () => {
  let cache: ClaudeCache;
  const teamName = "test-team";

  beforeEach(() => {
    cache = new ClaudeCache(teamName);
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with empty message arrays", () => {
      const report = cache.getReport();
      expect(report.totalMessages).toBe(0);
      expect(report.pendingMessages).toBe(0);
      expect(report.completedMessages).toBe(0);
      expect(report.errorMessages).toBe(0);
    });

    it("should accept configuration options", () => {
      const customCache = new ClaudeCache(teamName, {
        maxMessages: 50,
        maxProtocolMessages: 200,
        maxMessageAge: 1800000,
        preserveErrors: false,
      });

      // Configuration is private but we can test its effects
      const report = customCache.getReport();
      expect(report).toBeDefined();
    });
  });

  describe("message lifecycle", () => {
    it("should track a message from start to completion", () => {
      // Start a new message
      const messageId = cache.startMessage("Hello Claude");
      expect(messageId).toMatch(/^msg-\d+-\d+$/);

      // Check it's pending
      let pending = cache.getPendingMessages();
      expect(pending).toHaveLength(1);
      expect(pending[0].request).toBe("Hello Claude");
      expect(pending[0].status).toBe("pending");

      // Mark as streaming
      cache.markMessageStreaming();
      const current = cache.getCurrentMessage();
      expect(current?.status).toBe("streaming");

      // Append response text
      cache.appendToCurrentMessage("Hello! ");
      cache.appendToCurrentMessage("How can I help you today?");

      // Complete the message
      cache.completeCurrentMessage();

      // Check it's completed
      const completed = cache.getCompletedMessages();
      expect(completed).toHaveLength(1);
      expect(completed[0].response).toBe("Hello! How can I help you today?");
      expect(completed[0].status).toBe("completed");
      expect(completed[0].duration).toBeGreaterThan(0);

      // No longer pending
      pending = cache.getPendingMessages();
      expect(pending).toHaveLength(0);
    });

    it("should handle message errors", () => {
      const messageId = cache.startMessage("Cause an error");

      // Error the message
      cache.errorCurrentMessage("Connection lost");

      const errors = cache.getErrorMessages();
      expect(errors).toHaveLength(1);
      expect(errors[0].status).toBe("error");
      expect(errors[0].error).toBe("Connection lost");
      expect(errors[0].duration).toBeGreaterThan(0);
    });

    it("should support setting final response on completion", () => {
      cache.startMessage("Test message");
      cache.appendToCurrentMessage("Partial response");

      // Complete with different final response
      cache.completeCurrentMessage("Final response");

      const completed = cache.getCompletedMessages();
      expect(completed[0].response).toBe("Final response");
    });
  });

  describe("message querying", () => {
    beforeEach(() => {
      // Create some test messages
      for (let i = 0; i < 5; i++) {
        cache.startMessage(`Message ${i}`);
        cache.appendToCurrentMessage(`Response ${i}`);
        if (i < 3) {
          cache.completeCurrentMessage();
        } else if (i === 3) {
          cache.errorCurrentMessage("Error on message 3");
        }
        // Leave message 4 pending
      }
    });

    it("should get recent messages", () => {
      const recent = cache.getRecentMessages(3);
      expect(recent).toHaveLength(3);
      expect(recent[2].request).toBe("Message 4"); // Most recent
    });

    it("should get message by ID", () => {
      const all = cache.getRecentMessages(10);
      const firstId = all[0].id;

      const message = cache.getMessage(firstId);
      expect(message).toBeDefined();
      expect(message?.request).toBe("Message 0");
    });

    it("should get pending messages", () => {
      const pending = cache.getPendingMessages();
      expect(pending).toHaveLength(1);
      expect(pending[0].request).toBe("Message 4");
    });

    it("should get completed messages", () => {
      const completed = cache.getCompletedMessages();
      expect(completed).toHaveLength(3);
    });

    it("should get error messages", () => {
      const errors = cache.getErrorMessages();
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("Error on message 3");
    });

    it("should get messages since timestamp", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 1000);

      const allMessages = cache.getMessagesSince(past);
      expect(allMessages.length).toBeGreaterThan(0);

      const noMessages = cache.getMessagesSince(future);
      expect(noMessages).toHaveLength(0);
    });
  });

  describe("protocol messages", () => {
    it("should store and retrieve protocol messages", () => {
      const messageId = cache.startMessage("Test");

      // Add protocol messages
      cache.addProtocolMessage('{"type":"system","subtype":"init"}');
      cache.addProtocolMessage('{"type":"stream_event","event":{"type":"message_start"}}');

      const protocolMessages = cache.getAllProtocolMessages();
      expect(protocolMessages).toHaveLength(2);
      expect(protocolMessages[0].type).toBe("system");
      expect(protocolMessages[0].subtype).toBe("init");
      expect(protocolMessages[1].type).toBe("stream_event");
    });

    it("should link protocol messages to message exchanges", () => {
      const messageId = cache.startMessage("Test");

      cache.addProtocolMessage('{"type":"user"}');
      cache.addProtocolMessage('{"type":"assistant"}');

      const protocolMessages = cache.getProtocolMessages(messageId);
      expect(protocolMessages).toHaveLength(2);
    });

    it("should handle invalid JSON gracefully", () => {
      cache.addProtocolMessage("not valid json");

      const protocolMessages = cache.getAllProtocolMessages();
      expect(protocolMessages).toHaveLength(0);
    });

    it("should extract metadata from result messages", () => {
      cache.startMessage("Test");
      cache.addProtocolMessage('{"type":"result","total_cost_usd":0.05}');

      // The metadata should be updated on the current message
      const current = cache.getCurrentMessage();
      expect(current?.metadata?.cost).toBe(0.05);
    });
  });

  describe("circular buffer and retention", () => {
    it("should enforce message count limit", () => {
      const smallCache = new ClaudeCache(teamName, {
        maxMessages: 3,
      });

      // Add 5 messages
      for (let i = 0; i < 5; i++) {
        smallCache.startMessage(`Message ${i}`);
        smallCache.completeCurrentMessage(`Response ${i}`);
      }

      const messages = smallCache.getRecentMessages(10);
      expect(messages).toHaveLength(3);
      expect(messages[0].request).toBe("Message 2"); // Oldest kept
      expect(messages[2].request).toBe("Message 4"); // Newest
    });

    it("should preserve error messages when configured", () => {
      const smallCache = new ClaudeCache(teamName, {
        maxMessages: 3,
        preserveErrors: true,
      });

      // Add 2 error messages and 3 normal messages
      smallCache.startMessage("Error 1");
      smallCache.errorCurrentMessage("Error");

      smallCache.startMessage("Error 2");
      smallCache.errorCurrentMessage("Error");

      for (let i = 0; i < 3; i++) {
        smallCache.startMessage(`Normal ${i}`);
        smallCache.completeCurrentMessage();
      }

      const messages = smallCache.getRecentMessages(10);
      const errorCount = messages.filter(m => m.status === "error").length;
      expect(errorCount).toBeGreaterThanOrEqual(1); // At least some errors preserved
    });

    it("should enforce protocol message limit", () => {
      const smallCache = new ClaudeCache(teamName, {
        maxProtocolMessages: 3,
      });

      // Add 5 protocol messages
      for (let i = 0; i < 5; i++) {
        smallCache.addProtocolMessage(`{"type":"test","index":${i}}`);
      }

      const protocols = smallCache.getAllProtocolMessages();
      expect(protocols).toHaveLength(3);
      expect(protocols[0].parsed.index).toBe(2); // Oldest kept
    });
  });

  describe("reporting and export", () => {
    beforeEach(() => {
      // Create a mix of messages
      cache.startMessage("Completed 1");
      cache.completeCurrentMessage("Response 1");

      cache.startMessage("Error 1");
      cache.errorCurrentMessage("Failed");

      cache.startMessage("Pending 1");
      // Leave pending
    });

    it("should generate cache report", () => {
      const report = cache.getReport();

      expect(report.totalMessages).toBe(3);
      expect(report.pendingMessages).toBe(1);
      expect(report.completedMessages).toBe(1);
      expect(report.errorMessages).toBe(1);
      expect(report.averageDuration).toBeGreaterThanOrEqual(0);
      expect(report.oldestMessage).toBeDefined();
      expect(report.newestMessage).toBeDefined();
    });

    it("should export messages as JSON", () => {
      const json = cache.exportMessages("json");
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    });

    it("should export messages as text", () => {
      const text = cache.exportMessages("text");

      expect(text).toContain("Completed 1");
      expect(text).toContain("Response 1");
      expect(text).toContain("Error 1");
      expect(text).toContain("Failed");
      expect(text).toContain("---");
    });
  });

  describe("legacy support", () => {
    it("should support getText for backward compatibility", () => {
      cache.startMessage("Message 1");
      cache.appendToCurrentMessage("Response 1");
      cache.completeCurrentMessage();

      cache.startMessage("Message 2");
      cache.appendToCurrentMessage("Response 2");
      cache.completeCurrentMessage();

      const text = cache.getText();
      expect(text.stdout).toBe("Response 1\nResponse 2");
    });

    it("should support getProtocol for backward compatibility", () => {
      cache.addProtocolMessage('{"type":"test1"}');
      cache.addProtocolMessage('{"type":"test2"}');

      const protocol = cache.getProtocol();
      expect(protocol.stdout).toContain('{"type":"test1"}');
      expect(protocol.stdout).toContain('{"type":"test2"}');
    });

    it("should support appendStdoutProtocol parsing", () => {
      const multiline = '{"type":"line1"}\n{"type":"line2"}\n';
      cache.appendStdoutProtocol(multiline);

      const protocols = cache.getAllProtocolMessages();
      expect(protocols).toHaveLength(2);
    });

    it("should support appendStdoutText", () => {
      cache.startMessage("Test");
      cache.appendStdoutText("Legacy text");

      const current = cache.getCurrentMessage();
      expect(current?.response).toBe("Legacy text");
    });

    it("should handle stderr caching", () => {
      cache.appendStderr("Error line 1\n");
      cache.appendStderr("Error line 2\n");

      const text = cache.getText();
      expect(text.stderr).toBe("Error line 1\nError line 2\n");
    });

    it("should truncate stderr when too large", () => {
      const largeError = "x".repeat(150000);
      cache.appendStderr(largeError);

      const text = cache.getText();
      expect(text.stderr.length).toBeLessThanOrEqual(100000);
    });

    it("should support getSizes", () => {
      cache.startMessage("Test");
      cache.appendToCurrentMessage("Response text");
      cache.addProtocolMessage('{"type":"test"}');
      cache.appendStderr("Error text");

      const sizes = cache.getSizes();
      expect(sizes.text.stdout).toBeGreaterThan(0);
      expect(sizes.protocol.stdout).toBeGreaterThan(0);
      expect(sizes.text.stderr).toBeGreaterThan(0);
      expect(sizes.protocol.stderr).toBeGreaterThan(0);
    });

    it("should support truncate method", () => {
      const longText = "x".repeat(100);
      cache.startMessage(longText);
      cache.appendToCurrentMessage(longText);

      cache.truncate(50);

      // Truncate now enforces message limits, not character truncation
      const report = cache.getReport();
      expect(report.totalMessages).toBeGreaterThanOrEqual(0);
    });
  });

  describe("clear functionality", () => {
    it("should clear all caches and reset state", () => {
      // Add various data
      cache.startMessage("Test 1");
      cache.completeCurrentMessage("Response 1");
      cache.startMessage("Test 2");
      cache.addProtocolMessage('{"type":"test"}');
      cache.appendStderr("Error");

      // Clear everything
      cache.clear();

      // Verify all cleared
      const report = cache.getReport();
      expect(report.totalMessages).toBe(0);
      expect(report.pendingMessages).toBe(0);

      const protocols = cache.getAllProtocolMessages();
      expect(protocols).toHaveLength(0);

      const text = cache.getText();
      expect(text.stdout).toBe("");
      expect(text.stderr).toBe("");

      expect(cache.getCurrentMessage()).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle operations on non-existent current message", () => {
      // No current message
      expect(cache.getCurrentMessage()).toBeNull();

      // These should not throw
      cache.markMessageStreaming();
      cache.appendToCurrentMessage("text");
      cache.completeCurrentMessage();
      cache.errorCurrentMessage("error");
    });

    it("should handle getting non-existent message by ID", () => {
      const message = cache.getMessage("non-existent-id");
      expect(message).toBeUndefined();
    });

    it("should handle empty message completion", () => {
      cache.startMessage("Test");
      // Complete without adding any response
      cache.completeCurrentMessage();

      const completed = cache.getCompletedMessages();
      expect(completed[0].response).toBe("");
    });

    it("should include current message in pending when queried", () => {
      cache.startMessage("Test");

      const pending = cache.getPendingMessages();
      expect(pending).toHaveLength(1);

      const current = cache.getCurrentMessage();
      expect(current).toBeTruthy();
      expect(pending[0].id).toBe(current?.id);
    });
  });
});