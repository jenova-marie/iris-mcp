/**
 * Iris MCP Module: wake-all
 * Wake up all configured teams by ensuring their processes are active
 */

import type { IrisOrchestrator } from "../iris.js";
import type { ClaudeProcessPool } from "../process-pool/pool-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("mcp:wake-all");

export interface WakeAllInput {
  /** Optional: Team requesting the wake-all */
  fromTeam?: string;

  /** Wake teams in parallel (faster but more resource intensive) */
  parallel?: boolean;
}

export interface TeamWakeResult {
  /** Team name */
  team: string;

  /** Status after wake attempt */
  status: "awake" | "waking" | "failed";

  /** Process ID if successful */
  pid?: number;

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

  logger.info("🚨 Sounding the air-raid siren - waking all teams!", { fromTeam, parallel });

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
          const metrics = existingProcess.getMetrics();
          alreadyAwake++;
          return {
            team: teamName,
            status: "awake" as const,
            pid: metrics.pid,
          };
        }

        // Wake up the team
        const session = await sessionManager.getOrCreateSession(null, teamName);
        const process = await processPool.getOrCreateProcess(teamName, session.sessionId);
        const metrics = process.getMetrics();

        woken++;
        return {
          team: teamName,
          status: "waking" as const,
          pid: metrics.pid,
        };
      } catch (error) {
        failed++;
        logger.error("Failed to wake team", { team: teamName, error });
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
          const metrics = existingProcess.getMetrics();
          alreadyAwake++;
          results.push({
            team: teamName,
            status: "awake",
            pid: metrics.pid,
          });
          continue;
        }

        // Wake up the team
        const session = await sessionManager.getOrCreateSession(null, teamName);
        const process = await processPool.getOrCreateProcess(teamName, session.sessionId);
        const metrics = process.getMetrics();

        woken++;
        results.push({
          team: teamName,
          status: "waking",
          pid: metrics.pid,
        });
      } catch (error) {
        failed++;
        logger.error("Failed to wake team", { team: teamName, error });
        results.push({
          team: teamName,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const duration = Date.now() - startTime;

  logger.info("Wake-all operation complete", {
    total: teams.length,
    alreadyAwake,
    woken,
    failed,
    duration
  });

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