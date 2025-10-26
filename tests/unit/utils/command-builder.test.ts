/**
 * Unit tests for ClaudeCommandBuilder
 *
 * Tests command building logic for Claude CLI invocation with various configurations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ClaudeCommandBuilder } from "../../../src/utils/command-builder.js";
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
      expect(result.args).toContain("--debug");
      expect(result.args).toContain("--print");
      expect(result.args).toContain("--verbose");
      expect(result.args).toContain("--input-format");
      expect(result.args).toContain("stream-json");
      expect(result.args).toContain("--output-format");
      expect(result.args).toContain("stream-json");

      // NOTE: --mcp-config is NO LONGER added by build()
      // Transports are responsible for writing MCP config files
      // and adding --mcp-config <filepath> to args
      expect(result.args).not.toContain("--mcp-config");
    });

    it("should use custom claudePath when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        claudePath: "/custom/path/to/claude",
      };

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

      expect(result.executable).toBe("/custom/path/to/claude");
    });

    it("should add --disallowed-tools when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        disallowedTools: "bad-tool1,bad-tool2",
      };

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

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

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

      // DEPRECATED: --permission-prompt-tool is no longer needed
      // expect(result.args).toContain("--permission-prompt-tool");
      // expect(result.args).toContain("mcp__iris__permissions__approve");
    });

    it("should add permission-prompt-tool when grantPermission is 'yes' (default)", () => {
      const config: IrisConfig = {
        ...baseConfig,
        grantPermission: "yes",
      };

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

      // Default grantPermission="yes" adds permission-prompt-tool with session-specific naming
      expect(result.args).toContain("--permission-prompt-tool");
      expect(result.args).toContain("mcp__iris-session-123__permissions__approve");
    });

    it("should add permission-prompt-tool when grantPermission is 'ask'", () => {
      const config: IrisConfig = {
        ...baseConfig,
        grantPermission: "ask",
      };

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

      // grantPermission="ask" requires approval for everything
      expect(result.args).toContain("--permission-prompt-tool");
      expect(result.args).toContain("mcp__iris-session-123__permissions__approve");

      // Should only allow the permission tool itself
    });

    it("should not add permission-prompt-tool when grantPermission is 'no'", () => {
      const config: IrisConfig = {
        ...baseConfig,
        grantPermission: "no",
      };

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

      // grantPermission="no" blocks everything
      expect(result.args).not.toContain("--permission-prompt-tool");
      expect(result.args).not.toContain("--allowed-tools");
    });

    it("should use interactive mode when interactive=true (no stream-json)", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
        true, // interactive
      );

      // Should NOT include headless mode flags
      expect(result.args).not.toContain("--print");
      expect(result.args).not.toContain("--verbose");
      expect(result.args).not.toContain("--input-format");
      expect(result.args).not.toContain("stream-json");
      expect(result.args).not.toContain("--output-format");

      // Should still include session management
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("session-123");
    });

    it("should add --fork-session when fork=true", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
        false, // not interactive (headless)
        true, // fork
      );

      expect(result.args).toContain("--fork-session");
    });

    it("should not add --fork-session when fork=false (default)", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args).not.toContain("--fork-session");
    });

    it("should support both interactive=true and fork=true together", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
        true, // interactive (no stream-json)
        true, // fork
      );

      // Should have fork flag
      expect(result.args).toContain("--fork-session");

      // Should NOT have headless flags
      expect(result.args).not.toContain("--print");
      expect(result.args).not.toContain("--verbose");
      expect(result.args).not.toContain("stream-json");

      // Should still have session management
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("session-123");
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

    it("should include --debug (always enabled)", () => {
      const result = ClaudeCommandBuilder.build(
        "team-test",
        baseConfig,
        "session-123",
      );

      expect(result.args).toContain("--debug");
    });
  });

  describe("buildMcpConfig()", () => {
    it("should build MCP config with HTTP localhost URL for local teams", () => {
      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        baseConfig,
        "session-123",
      );

      expect(mcpConfig).toHaveProperty("mcpServers");
      expect(mcpConfig.mcpServers).toHaveProperty("iris-session-123");
      expect(mcpConfig.mcpServers["iris-session-123"].type).toBe("http");
      expect(mcpConfig.mcpServers["iris-session-123"].url).toMatch(
        /^http:\/\/localhost:\d+\/mcp\/session-123$/,
      );
    });

    it("should use HTTPS for remote teams by default", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
      };

      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        config,
        "session-123",
      );

      expect(mcpConfig.mcpServers["iris-session-123"].url).toMatch(
        /^https:\/\/localhost:\d+\/mcp\/session-123$/,
      );
    });

    it("should use HTTP for remote teams when allowHttp is true", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
        allowHttp: true,
      };

      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        config,
        "session-123",
      );

      expect(mcpConfig.mcpServers["iris-session-123"].url).toMatch(
        /^http:\/\/localhost:\d+\/mcp\/session-123$/,
      );
    });

    it("should use custom reverseMcpPort when specified", () => {
      const config: IrisConfig = {
        ...baseConfig,
        remote: "user@host",
        claudePath: "/usr/bin/claude",
        enableReverseMcp: true,
        reverseMcpPort: 8080,
      };

      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        config,
        "session-123",
      );

      expect(mcpConfig.mcpServers["iris-session-123"].url).toBe(
        "https://localhost:8080/mcp/session-123",
      );
    });

    it("should use IRIS_HTTP_PORT env var when available", () => {
      process.env.IRIS_HTTP_PORT = "9999";

      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        baseConfig,
        "session-123",
      );

      expect(mcpConfig.mcpServers["iris-session-123"].url).toBe(
        "http://localhost:9999/mcp/session-123",
      );

      delete process.env.IRIS_HTTP_PORT;
    });

    it("should return serializable JSON object", () => {
      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        baseConfig,
        "session-123",
      );

      const serialized = JSON.stringify(mcpConfig);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(mcpConfig);
    });
  });

  describe("getMcpConfigPath()", () => {
    it("should return correct path in team .claude/iris/mcp directory", () => {
      const teamPath = "/Users/test/projects/team-alpha";
      const sessionId = "session-123";

      const path = ClaudeCommandBuilder.getMcpConfigPath(teamPath, sessionId);

      expect(path).toBe(
        "/Users/test/projects/team-alpha/.claude/iris/mcp/iris-mcp-session-123.json",
      );
    });

    it("should handle Windows-style paths", () => {
      const teamPath = "C:\\Users\\test\\projects\\team-alpha";
      const sessionId = "session-456";

      const path = ClaudeCommandBuilder.getMcpConfigPath(teamPath, sessionId);

      expect(path).toContain(".claude");
      expect(path).toContain("iris");
      expect(path).toContain("mcp");
      expect(path).toContain("iris-mcp-session-456.json");
    });

    it("should handle session IDs with special characters", () => {
      const teamPath = "/path/to/project";
      const sessionId = "session-abc_def.123";

      const path = ClaudeCommandBuilder.getMcpConfigPath(teamPath, sessionId);

      expect(path).toBe(
        "/path/to/project/.claude/iris/mcp/iris-mcp-session-abc_def.123.json",
      );
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

      const result = ClaudeCommandBuilder.build(
        "team-test",
        config,
        "session-123",
      );

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
      const mcpConfig = ClaudeCommandBuilder.buildMcpConfig(
        baseConfig,
        sessionId,
      );
      const serverName = `iris-${sessionId}`;
      expect(mcpConfig.mcpServers[serverName].url).toContain(sessionId);
    });

    it("should handle all optional IrisConfig fields", () => {
      const fullConfig: IrisConfig = {
        path: "/full/path",
        description: "Full config test",
        idleTimeout: 300000,
        sessionInitTimeout: 30000,
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

      const result = ClaudeCommandBuilder.build(
        "team-full",
        fullConfig,
        "session-123",
      );

      expect(result.executable).toBe("/usr/bin/claude");
      expect(result.cwd).toBe("/full/path");
      expect(result.args).toContain("--disallowed-tools");
      expect(result.args).toContain("--permission-prompt-tool");
    });
  });
});
