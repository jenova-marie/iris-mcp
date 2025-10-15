/**
 * Iris MCP Module: wake-all
 * Wake up all configured teams by ensuring their processes are active
 */

import type { IrisOrchestrator } from "../iris.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("action:wake-all");

export interface WakeAllInput {
  /** Team requesting the wake-all */
  fromTeam: string;

  /** Wake teams in parallel (NOT RECOMMENDED - parallel Claude spawning is unstable and causes timeouts) */
  parallel?: boolean;
}

export interface TeamWakeResult {
  /** Team name */
  team: string;

  /** Status after wake attempt */
  status: "awake" | "waking" | "failed";

  /** Error message if failed */
  error?: string;
}

export interface WakeAllOutput {
  /** Message describing the operation */
  message: string;

  /** Individual team results */
  teams: TeamWakeResult[];

  /** Summary statistics */
  summary: {
    total: number;
    alreadyAwake: number;
    woken: number;
    failed: number;
  };

  /** Duration of entire operation in milliseconds */
  duration: number;

  /** Timestamp of operation */
  timestamp: number;
}

export async function wakeAll(
  input: WakeAllInput,
  iris: IrisOrchestrator,
  processPool: ClaudeProcessPool,
  sessionManager: SessionManager,
): Promise<WakeAllOutput> {
  const { fromTeam, parallel = false } = input;

  logger.info(
    { fromTeam, parallel },
    "🚨 Sounding the air-raid siren - waking all teams!",
  );

  if (parallel) {
    logger.warn(
      "⚠️  Parallel mode is UNSTABLE - spawning multiple Claude instances simultaneously causes timeouts. Consider using sequential mode (parallel=false).",
    );
  }

  const startTime = Date.now();
  const config = processPool.getConfig();
  const teams = Object.keys(config.teams);
  const results: TeamWakeResult[] = [];

  let alreadyAwake = 0;
  let woken = 0;
  let failed = 0;

  if (parallel) {
    // Wake all teams in parallel
    const wakePromises = teams.map(async (teamName) => {
      try {
        // Check if already awake
        const existingProcess = processPool.getProcess(teamName);

        if (existingProcess) {
          const metrics = existingProcess.getBasicMetrics();
          alreadyAwake++;
          return {
            team: teamName,
            status: "awake" as const,
          };
        }

        // Wake up the team
        const session = await sessionManager.getOrCreateSession(
          fromTeam,
          teamName,
        );
        const process = await processPool.getOrCreateProcess(
          teamName,
          session.sessionId,
          fromTeam,
        );
        const metrics = process.getBasicMetrics();

        // Update session state to idle after spawn completes
        sessionManager.updateProcessState(session.sessionId, "idle");

        woken++;
        return {
          team: teamName,
          status: "waking" as const,
        };
      } catch (error) {
        failed++;
        logger.error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            team: teamName,
          },
          "Failed to wake team",
        );
        return {
          team: teamName,
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    // Wait for all wake operations to complete
    const parallelResults = await Promise.all(wakePromises);
    results.push(...parallelResults);
  } else {
    // Wake teams sequentially
    for (const teamName of teams) {
      try {
        // Check if already awake
        const existingProcess = processPool.getProcess(teamName);

        if (existingProcess) {
          const metrics = existingProcess.getBasicMetrics();
          alreadyAwake++;
          results.push({
            team: teamName,
            status: "awake",
          });
          continue;
        }

        // Wake up the team
        const session = await sessionManager.getOrCreateSession(
          fromTeam,
          teamName,
        );
        const process = await processPool.getOrCreateProcess(
          teamName,
          session.sessionId,
          fromTeam,
        );
        const metrics = process.getBasicMetrics();

        // Update session state to idle after spawn completes
        sessionManager.updateProcessState(session.sessionId, "idle");

        woken++;
        results.push({
          team: teamName,
          status: "waking",
        });
      } catch (error) {
        failed++;
        logger.error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            team: teamName,
          },
          "Failed to wake team",
        );
        results.push({
          team: teamName,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const duration = Date.now() - startTime;

  logger.info(
    {
      total: teams.length,
      alreadyAwake,
      woken,
      failed,
      duration,
    },
    "Wake-all operation complete",
  );

  return {
    message: "🚨 Sounding the air-raid siren! All teams are being awakened!",
    teams: results,
    summary: {
      total: teams.length,
      alreadyAwake,
      woken,
      failed,
    },
    duration,
    timestamp: Date.now(),
  };
}
