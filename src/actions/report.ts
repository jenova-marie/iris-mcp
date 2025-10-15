/**
 * Iris MCP Module: report
 * View the cached conversation for a team pair
 */

import type { IrisOrchestrator } from "../iris.js";
import { validateTeamName } from "../utils/validation.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:report");

export interface ReportInput {
  /** Team whose cache to view (the recipient/toTeam) */
  team: string;

  /** Team requesting the report (the sender/fromTeam) */
  fromTeam: string;
}

export interface CacheEntryReport {
  type: "spawn" | "tell";
  tellString: string;
  status: string;
  isComplete: boolean;
  messageCount: number;
  createdAt: number;
  completedAt: number | null;
  messages: Array<{
    timestamp: number;
    type: string;
    content?: string;
  }>;
}

export interface ReportOutput {
  /** Team whose cache was viewed */
  team: string;

  /** Requesting team */
  fromTeam: string;

  /** Whether a session exists */
  hasSession: boolean;

  /** Whether a process is active */
  hasProcess: boolean;

  /** Process state (if process exists): stopped, spawning, idle, processing */
  processState?: string;

  /** Session ID (if exists) */
  sessionId?: string;

  /** Whether all cache entries are complete (final responses received) */
  allComplete: boolean;

  /** Cache entries */
  entries: CacheEntryReport[];

  /** Cache statistics */
  stats: {
    totalEntries: number;
    spawnEntries: number;
    tellEntries: number;
    activeEntries: number;
    completedEntries: number;
  };

  /** Timestamp of report operation */
  timestamp: number;
}

export async function report(
  input: ReportInput,
  iris: IrisOrchestrator,
): Promise<ReportOutput> {
  const { team, fromTeam } = input;

  // Validate team names
  validateTeamName(team);
  validateTeamName(fromTeam);

  logger.info({ team, fromTeam }, "Reporting on team conversation cache");

  // Get message cache for this team pair
  const messageCache = iris.getMessageCacheForTeams(fromTeam, team);

  if (!messageCache) {
    logger.info({ team, fromTeam }, "No message cache found (no session yet)");

    return {
      team,
      fromTeam,
      hasSession: false,
      hasProcess: false,
      allComplete: true, // No entries means nothing to wait for
      entries: [],
      stats: {
        totalEntries: 0,
        spawnEntries: 0,
        tellEntries: 0,
        activeEntries: 0,
        completedEntries: 0,
      },
      timestamp: Date.now(),
    };
  }

  // Get all cache entries
  const entries = messageCache.getAllEntries();
  const stats = messageCache.getStats();

  // Format entries for output
  const formattedEntries: CacheEntryReport[] = entries.map((entry) => {
    const messages = entry.getMessages().map((msg) => {
      let content: string | undefined;

      // Extract text content from assistant messages
      if (msg.type === "assistant" && msg.data?.message?.content) {
        const textBlocks = msg.data.message.content.filter((c: any) => c.type === "text");
        if (textBlocks.length > 0) {
          content = textBlocks.map((b: any) => b.text).join("\n");
        }
      }

      return {
        timestamp: msg.timestamp,
        type: msg.type,
        content,
      };
    });

    return {
      type: entry.cacheEntryType as "spawn" | "tell",
      tellString: entry.tellString,
      status: entry.status,
      isComplete: entry.status === "completed",
      messageCount: entry.getMessages().length,
      createdAt: entry.createdAt,
      completedAt: entry.completedAt,
      messages,
    };
  });

  // Check if all entries are complete
  const allComplete = entries.every((entry) => entry.status === "completed");

  // Check if process is active
  const session = iris.getSession(messageCache.sessionId);
  const hasProcess = session ? iris.isAwake(fromTeam, team) : false;

  // Get process state if session exists
  let processState: string | undefined;
  if (session) {
    processState = session.processState;
  }

  logger.info(
    {
      team,
      fromTeam,
      sessionId: messageCache.sessionId,
      totalEntries: stats.totalEntries,
      hasProcess,
      processState,
      allComplete,
    },
    "Cache report generated",
  );

  return {
    team,
    fromTeam,
    hasSession: true,
    hasProcess,
    processState,
    sessionId: messageCache.sessionId,
    allComplete,
    entries: formattedEntries,
    stats,
    timestamp: Date.now(),
  };
}
