/**
 * Template Utilities
 * Helper functions for template management and git integration
 */

import { execSync } from "child_process";
import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("agents:template-utils");

/**
 * Get git diff for a project
 */
export async function getGitDiff(projectPath: string): Promise<string | undefined> {
  try {
    logger.debug({ projectPath }, "Getting git diff");

    const diff = execSync("git diff HEAD", {
      cwd: projectPath,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 5, // 5MB max
    });

    if (diff.trim()) {
      logger.info({ diffLength: diff.length }, "Git diff retrieved");
      return diff;
    }

    logger.debug("No git diff (working directory clean)");
    return undefined;
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        projectPath,
      },
      "Failed to get git diff (not a git repo or git not available)",
    );
    return undefined;
  }
}

/**
 * Find template file with hierarchy lookup
 *
 * Lookup order:
 * 1. <project>/.iris/templates/{agentType}.hbs (project-specific)
 * 2. ~/.iris/templates/custom/{agentType}.hbs (user custom)
 * 3. ~/.iris/templates/base/{agentType}.hbs (user override of bundled)
 * 4. <bundled>/templates/base/{agentType}.hbs (bundled default)
 */
export async function findTemplate(
  agentType: string,
  projectPath: string | undefined,
  bundledTemplatesDir: string,
): Promise<string> {
  const locations: string[] = [];

  // 1. Project-specific template
  if (projectPath) {
    locations.push(join(projectPath, ".iris", "templates", `${agentType}.hbs`));
  }

  // 2. User custom template
  locations.push(join(homedir(), ".iris", "templates", "custom", `${agentType}.hbs`));

  // 3. User override of bundled template
  locations.push(join(homedir(), ".iris", "templates", "base", `${agentType}.hbs`));

  // 4. Bundled default template (always exists)
  locations.push(join(bundledTemplatesDir, `${agentType}.hbs`));

  // Find first existing template
  for (const location of locations) {
    try {
      await access(location);
      logger.debug({ location, agentType }, "Template found");
      return location;
    } catch {
      // Template doesn't exist, continue to next
      continue;
    }
  }

  // Should never reach here since bundled template should always exist
  throw new Error(
    `No template found for agent type "${agentType}" (checked ${locations.length} locations)`,
  );
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
