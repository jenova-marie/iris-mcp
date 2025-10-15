/**
 * Iris MCP Module: quick_tell
 * Convenience wrapper for tell with timeout=-1 (async)
 */

import type { IrisOrchestrator } from "../iris.js";
import { tell, type TellOutput } from "./tell.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:quick_tell");

export interface QuickTellInput {
  /** Team to send message to */
  toTeam: string;

  /** Message content */
  message: string;

  /** Team sending the message */
  fromTeam: string;
}

/**
 * Send a message with timeout=-1 (async)
 * Returns immediately after queuing the message
 */
export async function quickTell(
  input: QuickTellInput,
  iris: IrisOrchestrator,
): Promise<TellOutput> {
  const { fromTeam, toTeam, message } = input;

  logger.info(
    {
      from: fromTeam,
      to: toTeam,
      messageLength: message.length,
    },
    "Quick tell (async mode, timeout=-1)",
  );

  // Call tell with hardcoded timeout=-1
  return tell(
    {
      fromTeam,
      toTeam,
      message,
      timeout: -1,
    },
    iris,
  );
}
