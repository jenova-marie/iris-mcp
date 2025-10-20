/**
 * Permissions Action - Thin Adapter
 * Delegates to Iris orchestrator for permission approval business logic
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
import type { IrisOrchestrator } from "../iris.js";
import { getSessionId } from "../utils/request-context.js";

const logger = getChildLogger("action:permissions");

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
 * Permission approval handler - THIN ADAPTER
 * Delegates to Iris orchestrator for business logic
 *
 * Called by Claude Code when --permission-prompt-tool is set to mcp__iris__permissions__approve
 *
 * Uses AsyncLocalStorage to get sessionId from request context (set in /mcp/:sessionId route)
 *
 * @param request - Permission request from Claude Code
 * @param iris - Iris orchestrator (contains all business logic)
 */
export async function permissionsApprove(
  request: PermissionApprovalRequest,
  iris: IrisOrchestrator,
): Promise<PermissionApprovalResponse> {
  // Get sessionId from AsyncLocalStorage context
  const sessionId = getSessionId();

  if (!sessionId) {
    // This should never happen if properly configured with --mcp-config
    logger.error("No sessionId in request context - permission denied");
    return {
      behavior: "deny",
      message: "Permission denied: No session context (server configuration error)",
    };
  }

  logger.info({
    sessionId,
    tool_name: request.tool_name,
  }, "PLACEHOLDER");

  // Delegate to Iris for business logic
  const decision = await iris.handlePermissionRequest(
    sessionId,
    request.tool_name,
    request.input,
    request.reason,
  );

  // Format MCP response
  return {
    behavior: decision.allow ? "allow" : "deny",
    message: decision.message,
    updatedInput: decision.allow ? request.input : undefined,
  };
}
