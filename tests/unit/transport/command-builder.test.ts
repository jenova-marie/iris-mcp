/**
 * Unit tests for ClaudeCommandBuilder
 *
 * Tests command building logic for Claude CLI invocation with various configurations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ClaudeCommandBuilder } from "../../../src/transport/command-builder.js";
import type { IrisConfig } from "../../../src/process-pool/types.js";

describe("ClaudeCommandBuilder", () => {
  const baseConfig: IrisConfig = {
    path: "/path/to/project",
    description: "Test team",
  };

  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    delete process.env.DEBUG;
    delete process.env.IRIS_TEST_REMOTE;
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    delete process.env.DEBUG;
    delete process.env.IRIS_TEST_REMOTE;
  });

  describe("build()", () => {
    it("should build basic command with default settings", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.executable).toBe("claude");
      expect(result.cwd).toBe("/path/to/project");
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("session-123");
      expect(result.args).toContain("--print");
      expect(result.args).toContain("--verbose");
      expect(result.args).toContain("--input-format");
      expect(result.args).toContain("stream-json");
      expect(result.args).toContain("--output-format");
      expect(result.args).toContain("stream-json");
      expect(result.args).toContain("--mcp-config");
    });

    it("should use custom claudePath when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        claudePath: "/custom/path/to/claude",
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.executable).toBe("/custom/path/to/claude");
    });

    it("should add --dangerously-skip-permissions when skipPermissions is true", () => {
      const config: IrisConfig = {
        ...baseConfig,
        skipPermissions: true,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.args).toContain("--dangerously-skip-permissions");
    });

    it("should not add --dangerously-skip-permissions when skipPermissions is false", () => {
      const config: IrisConfig = {
        ...baseConfig,
        skipPermissions: false,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.args).not.toContain("--dangerously-skip-permissions");
    });

    it("should add --allowed-tools when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        allowedTools: "tool1,tool2,tool3",
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.args).toContain("--allowed-tools");
      expect(result.args).toContain("tool1,tool2,tool3");
    });

    it("should add --disallowed-tools when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        disallowedTools: "bad-tool1,bad-tool2",
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.args).toContain("--disallowed-tools");
      expect(result.args).toContain("bad-tool1,bad-tool2");
    });

    it("should add --permission-prompt-tool when enableReverseMcp is true", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.args).toContain("--permission-prompt-tool");
      expect(result.args).toContain("mcp__iris__permissions__approve");
    });

    it("should not add --permission-prompt-tool when enableReverseMcp is false", () => {
      const config: IrisConfig = {
        ...baseConfig,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.args).not.toContain("--permission-prompt-tool");
    });
  });

  describe("test mode behavior", () => {
    it("should skip --resume in test mode (NODE_ENV=test)", () => {
      process.env.NODE_ENV = "test";

      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args).not.toContain("--resume");
      expect(result.args).not.toContain("session-123");
    });

    it("should skip --resume when IRIS_TEST_REMOTE=1", () => {
      process.env.IRIS_TEST_REMOTE = "1";

      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args).not.toContain("--resume");
      expect(result.args).not.toContain("session-123");
    });

    it("should add --debug in test mode", () => {
      process.env.NODE_ENV = "test";

      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args).toContain("--debug");
    });

    it("should add --debug when DEBUG env var is set", () => {
      process.env.DEBUG = "1";

      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args).toContain("--debug");
    });
  });

  describe("MCP configuration", () => {
    it("should build MCP config with HTTP localhost URL for local teams", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      // Extract MCP config from args
      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      expect(mcpConfigIndex).toBeGreaterThan(-1);

      const mcpConfigJson = result.args[mcpConfigIndex + 1];
      const mcpConfig = JSON.parse(mcpConfigJson);

      expect(mcpConfig.mcpServers.iris.type).toBe("http");
      expect(mcpConfig.mcpServers.iris.url).toMatch(/^http:\/\/localhost:\d+\/mcp\/session-123$/);
    });

    it("should use HTTPS for remote teams by default", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      const mcpConfigJson = result.args[mcpConfigIndex + 1];
      const mcpConfig = JSON.parse(mcpConfigJson);

      expect(mcpConfig.mcpServers.iris.url).toMatch(/^https:\/\/localhost:\d+\/mcp\/session-123$/);
    });

    it("should use HTTP for remote teams when allowHttp is true", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
        allowHttp: true,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      const mcpConfigJson = result.args[mcpConfigIndex + 1];
      const mcpConfig = JSON.parse(mcpConfigJson);

      expect(mcpConfig.mcpServers.iris.url).toMatch(/^http:\/\/localhost:\d+\/mcp\/session-123$/);
    });

    it("should use custom reverseMcpPort when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
        reverseMcpPort: 8080,
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      const mcpConfigJson = result.args[mcpConfigIndex + 1];
      const mcpConfig = JSON.parse(mcpConfigJson);

      expect(mcpConfig.mcpServers.iris.url).toBe("https://localhost:8080/mcp/session-123");
    });

    it("should use IRIS_HTTP_PORT env var when available", () => {
      process.env.IRIS_HTTP_PORT = "9999";

      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      const mcpConfigJson = result.args[mcpConfigIndex + 1];
      const mcpConfig = JSON.parse(mcpConfigJson);

      expect(mcpConfig.mcpServers.iris.url).toBe("http://localhost:9999/mcp/session-123");

      delete process.env.IRIS_HTTP_PORT;
    });
  });

  describe("command structure consistency", () => {
    it("should maintain consistent arg order", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      // Session management should come first (if not in test mode)
      const resumeIndex = result.args.indexOf("--resume");
      const printIndex = result.args.indexOf("--print");

      if (resumeIndex !== -1) {
        expect(resumeIndex).toBeLessThan(printIndex);
      }

      // Print and verbose should be together
      const verboseIndex = result.args.indexOf("--verbose");
      expect(Math.abs(printIndex - verboseIndex)).toBeLessThanOrEqual(1);

      // MCP config should be near the end
      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      expect(mcpConfigIndex).toBeGreaterThan(printIndex);
    });

    it("should produce args array without undefined values", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args.every((arg) => arg !== undefined)).toBe(true);
    });

    it("should produce serializable CommandInfo", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      // Should be serializable to JSON and back
      const serialized = JSON.stringify(result);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.executable).toBe(result.executable);
      expect(deserialized.args).toEqual(result.args);
      expect(deserialized.cwd).toBe(result.cwd);
    });
  });

  describe("edge cases", () => {
    it("should handle empty path gracefully", () => {
      const config: IrisConfig = {
        ...baseConfig,
        path: "",
      };

      const result = ClaudeCommandBuilder.build("team-test", config, "session-123");

      expect(result.cwd).toBe("");
    });

    it("should handle special characters in session ID", () => {
      const sessionId = "session-123-abc_def.xyz";

      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        sessionId,
      );

      expect(result.args).toContain(sessionId);

      // MCP URL should also contain the session ID
      const mcpConfigIndex = result.args.indexOf("--mcp-config");
      const mcpConfigJson = result.args[mcpConfigIndex + 1];
      const mcpConfig = JSON.parse(mcpConfigJson);

      expect(mcpConfig.mcpServers.iris.url).toContain(sessionId);
    });

    it("should handle all optional IrisConfig fields", () => {
      const fullConfig: IrisConfig = {
        path: "/full/path",
        description: "Full config test",
        idleTimeout: 300000,
        sessionInitTimeout: 30000,
        skipPermissions: true,
        color: "#FF6B9D",
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
        reverseMcpPort: 8080,
        allowHttp: true,
        grantPermission: "ask",
        allowedTools: "tool1,tool2",
        disallowedTools: "bad-tool",
        appendSystemPrompt: "Custom prompt",
      };

      const result = ClaudeCommandBuilder.build("team-full", fullConfig, "session-123");

      expect(result.executable).toBe("/usr/bin/claude");
      expect(result.cwd).toBe("/full/path");
      expect(result.args).toContain("--dangerously-skip-permissions");
      expect(result.args).toContain("--allowed-tools");
      expect(result.args).toContain("--disallowed-tools");
      expect(result.args).toContain("--permission-prompt-tool");
    });
  });
});
