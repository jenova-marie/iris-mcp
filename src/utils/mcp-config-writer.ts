/**
 * MCP Config Writer - Executes user-controlled scripts to write MCP config files
 *
 * This module delegates all filesystem operations to external shell scripts,
 * keeping TypeScript code free of direct file I/O. Users have full control
 * over where and how MCP config files are created.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ProcessError } from "./errors.js";
import { getChildLogger } from "./logger.js";

const logger = getChildLogger("mcp-config-writer");

/**
 * Default script paths (relative to project root)
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

export const DEFAULT_LOCAL_SCRIPT =
  process.platform === "win32"
    ? join(PROJECT_ROOT, "examples/scripts/mcp-cp.ps1")
    : join(PROJECT_ROOT, "examples/scripts/mcp-cp.sh");

export const DEFAULT_REMOTE_SCRIPT =
  process.platform === "win32"
    ? join(PROJECT_ROOT, "examples/scripts/mcp-scp.ps1")
    : join(PROJECT_ROOT, "examples/scripts/mcp-scp.sh");

/**
 * Execute a script with JSON piped to stdin, return the output file path
 *
 * @param scriptPath - Absolute path to script (sh/ps1)
 * @param mcpConfig - MCP configuration object to write
 * @param scriptArgs - Arguments to pass to script
 * @returns Promise resolving to the file path where config was written
 */
export async function writeMcpConfig(
  scriptPath: string,
  mcpConfig: object,
  ...scriptArgs: string[]
): Promise<string> {
  logger.debug("Writing MCP config via script", {
    scriptPath,
    scriptArgs,
    configKeys: Object.keys(mcpConfig),
  });

  return new Promise((resolve, reject) => {
    // Determine shell/interpreter based on script extension
    const isPs1 = scriptPath.endsWith(".ps1");
    const command = isPs1 ? "powershell" : scriptPath;
    const args = isPs1 ? ["-File", scriptPath, ...scriptArgs] : scriptArgs;

    // Spawn script process
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    // Collect stdout (file path)
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    // Collect stderr (errors)
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Handle process exit
    proc.on("exit", (code, signal) => {
      if (code !== 0) {
        logger.error("MCP config script failed", {
          scriptPath,
          exitCode: code,
          signal,
          stderr: stderr.trim(),
        });

        reject(
          new ProcessError(
            `MCP config script failed (exit code ${code}): ${stderr.trim() || "Unknown error"}`,
            scriptPath,
          ),
        );
        return;
      }

      // Extract file path from stdout (last non-empty line)
      const filePath = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .pop();

      if (!filePath) {
        reject(
          new ProcessError(
            "MCP config script did not output a file path",
            scriptPath,
          ),
        );
        return;
      }

      logger.debug("MCP config written successfully", {
        scriptPath,
        filePath,
      });

      resolve(filePath);
    });

    // Handle process errors
    proc.on("error", (error) => {
      logger.error("Failed to execute MCP config script", {
        err: error,
        scriptPath,
      });

      reject(
        new ProcessError(
          `Failed to execute MCP config script: ${error.message}`,
          scriptPath,
        ),
      );
    });

    // Write MCP config JSON to stdin
    const jsonString = JSON.stringify(mcpConfig, null, 2);
    proc.stdin.write(jsonString);
    proc.stdin.end();
  });
}

/**
 * Write MCP config for local execution
 *
 * Writes to: <teamPath>/<sessionMcpPath>/iris-mcp-<sessionId>.json
 *
 * @param mcpConfig - MCP configuration object
 * @param sessionId - Session ID
 * @param teamPath - Absolute path to team's project directory
 * @param sessionMcpPath - Optional MCP directory path relative to team path (defaults to ".claude/iris/mcp")
 * @param scriptPath - Optional custom script path (defaults to bundled mcp-cp script)
 * @returns Promise resolving to the file path where config was written
 */
export async function writeMcpConfigLocal(
  mcpConfig: object,
  sessionId: string,
  teamPath: string,
  sessionMcpPath?: string,
  scriptPath?: string,
): Promise<string> {
  const script = scriptPath || DEFAULT_LOCAL_SCRIPT;
  const args = [sessionId, teamPath];

  // Add sessionMcpPath if provided (otherwise script uses default)
  if (sessionMcpPath) {
    args.push(sessionMcpPath);
  }

  return writeMcpConfig(script, mcpConfig, ...args);
}

/**
 * Write MCP config for remote execution (via SCP)
 *
 * Writes to: <remoteTeamPath>/<sessionMcpPath>/iris-mcp-<sessionId>.json
 *
 * @param mcpConfig - MCP configuration object
 * @param sessionId - Session ID
 * @param sshHost - SSH host (e.g., "user@example.com" or "remote-alias")
 * @param remoteTeamPath - Absolute path to team's project directory on remote host
 * @param sessionMcpPath - Optional MCP directory path relative to team path (defaults to ".claude/iris/mcp")
 * @param scriptPath - Optional custom script path (defaults to bundled mcp-scp script)
 * @returns Promise resolving to the remote file path where config was written
 */
export async function writeMcpConfigRemote(
  mcpConfig: object,
  sessionId: string,
  sshHost: string,
  remoteTeamPath: string,
  sessionMcpPath?: string,
  scriptPath?: string,
): Promise<string> {
  const script = scriptPath || DEFAULT_REMOTE_SCRIPT;
  const args = [sessionId, sshHost, remoteTeamPath];

  // Add sessionMcpPath if provided (otherwise script uses default)
  if (sessionMcpPath) {
    args.push(sessionMcpPath);
  }

  return writeMcpConfig(script, mcpConfig, ...args);
}
