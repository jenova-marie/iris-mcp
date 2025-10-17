/**
 * Request Context - AsyncLocalStorage for passing sessionId through MCP SDK
 *
 * The MCP SDK doesn't provide a way to pass custom context through tool calls.
 * We use Node.js AsyncLocalStorage to maintain request-scoped context that persists
 * through the entire async call chain, from Express route → MCP SDK → tool handler.
 *
 * This allows us to:
 * 1. Extract sessionId from URL params in Express route (/mcp/:sessionId)
 * 2. Store it in AsyncLocalStorage
 * 3. Retrieve it in the permissions__approve tool handler
 * 4. Pass it to Iris for team detection
 */

import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  sessionId?: string;
}

// Create AsyncLocalStorage instance
const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Run callback with request context
 * This should be called in the Express route handler
 */
export function runWithContext<T>(
  context: RequestContext,
  callback: () => Promise<T>,
): Promise<T> {
  return requestContext.run(context, callback);
}

/**
 * Get current request context
 * Returns undefined if not in a context (e.g., /mcp route without sessionId)
 */
export function getContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Get sessionId from current request context
 * Returns undefined if not in a context or no sessionId set
 */
export function getSessionId(): string | undefined {
  return getContext()?.sessionId;
}
