/**
 * Grant Permission Action
 * Handles permission prompts from remote teams via reverse MCP
 *
 * This implements the --permission-prompt-tool interface for Claude Code
 * See: https://github.com/mmarcen/test_permission-prompt-tool
 *
 * Interface spec:
 * - Tool name: permissions__approve (double underscore!)
 * - Parameters: tool_name: string, input: object, reason?: string
 * - Returns: { behavior: "allow" | "deny", message?: string, updatedInput?: object }
 */

import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:grant-permission");

export interface PermissionApprovalRequest {
  tool_name: string; // The tool requesting permission (e.g., "mcp__iris__team_teams")
  input: Record<string, unknown>; // The input parameters for the tool
  reason?: string; // Optional reason provided by Claude
}

export interface PermissionApprovalResponse {
  behavior: "allow" | "deny";
  message?: string;
  updatedInput?: Record<string, unknown>;
}

/**
 * Permission approval handler
 * Called by Claude Code when --permission-prompt-tool is set to mcp__iris__permissions__approve
 *
 * For now, this auto-approves all Iris MCP tools when called from remote teams
 * In the future, this could integrate with a dashboard UI or Slack for approval
 */
export async function permissionsApprove(
  request: PermissionApprovalRequest
): Promise<PermissionApprovalResponse> {
  logger.info("Permission approval request received", {
    tool_name: request.tool_name,
    input: request.input,
    reason: request.reason,
  });

  // Auto-approve all mcp__iris__ tools
  // TODO: Add dashboard integration for manual approval
  // TODO: Add configurable auto-approval rules per team
  if (request.tool_name.startsWith("mcp__iris__")) {
    logger.info("Auto-approving Iris MCP tool", {
      tool_name: request.tool_name,
    });

    return {
      behavior: "allow",
      updatedInput: request.input, // Pass through the original input
    };
  }

  // Deny all other tools by default
  logger.warn("Denying permission for non-Iris tool", {
    tool_name: request.tool_name,
  });

  return {
    behavior: "deny",
    message: `Permission denied: Only Iris MCP tools are auto-approved (requested: ${request.tool_name})`,
  };
}
