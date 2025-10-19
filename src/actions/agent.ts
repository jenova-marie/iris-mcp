/**
 * Iris MCP Module: agent
 * Returns canned prompt text for specialized agent roles
 */

import { getChildLogger } from "../utils/logger.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TemplateRenderer } from "../agents/template-renderer.js";
import { ContextDiscovery, getAgentPatterns } from "../agents/context-discovery.js";
import { getGitDiff, findTemplate } from "../agents/template-utils.js";
import { readFileSync } from "fs";

const logger = getChildLogger("action:agent");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, "..", "..", "templates", "base");

// Supported agent types
export const AGENT_TYPES = [
  "tech-writer",
  "unit-tester",
  "integration-tester",
  "code-reviewer",
  "debugger",
  "refactorer",
  "changeloger",
  "error-handler",
  "example-writer",
  "logger",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export interface AgentInput {
  /** Type of agent to get prompt for (e.g., 'tech-writer', 'unit-tester') */
  agentType: string;

  /** Optional context to interpolate into the template */
  context?: Record<string, any>;

  /** Optional project path for context discovery (Phase 2) */
  projectPath?: string;

  /** Include git diff in context (Phase 3) */
  includeGitDiff?: boolean;
}

export interface AgentOutput {
  /** The agent type requested */
  agentType: string;

  /** The canned prompt text for this agent */
  prompt: string;

  /** Whether the agent type is valid/supported */
  valid: boolean;

  /** Available agent types */
  availableAgents: readonly string[];
}

/**
 * Validates if an agent type is supported
 */
function isValidAgentType(type: string): type is AgentType {
  return AGENT_TYPES.includes(type as AgentType);
}

/**
 * Get bundled template directory
 */
function getBundledTemplatesDir(): string {
  return TEMPLATES_DIR;
}

/**
 * Register all bundled templates as partials
 */
async function registerBundledPartials(renderer: TemplateRenderer): Promise<void> {
  // Register all bundled templates as partials so they can be included
  for (const agentType of AGENT_TYPES) {
    try {
      const templatePath = join(TEMPLATES_DIR, `${agentType}.hbs`);
      const templateContent = readFileSync(templatePath, "utf-8");
      renderer.registerPartial(`base/${agentType}`, templateContent);
    } catch (error) {
      logger.warn({ agentType, error }, "Failed to register partial");
    }
  }
}

export async function agent(input: AgentInput): Promise<AgentOutput> {
  const { agentType, context = {}, projectPath, includeGitDiff = false } = input;

  logger.info(
    {
      agentType,
      hasContext: Object.keys(context).length > 0,
      hasProjectPath: !!projectPath,
      includeGitDiff,
    },
    "Getting agent prompt",
  );

  if (!isValidAgentType(agentType)) {
    logger.warn(
      {
        requestedType: agentType,
        availableTypes: AGENT_TYPES,
      },
      "Invalid agent type requested",
    );

    return {
      agentType,
      prompt: `Invalid agent type "${agentType}". Available types: ${AGENT_TYPES.join(", ")}`,
      valid: false,
      availableAgents: AGENT_TYPES,
    };
  }

  try {
    // Build context for template rendering
    let templateContext = { ...context };

    // Phase 2: Auto-discover project context if projectPath provided
    if (projectPath) {
      logger.debug({ projectPath }, "Running context discovery");

      const discovery = new ContextDiscovery(projectPath);
      const projectContext = await discovery.discover();

      // Get agent-specific file patterns
      const agentPatterns = getAgentPatterns(agentType);

      // Merge discovered context with user-provided context
      // User-provided context takes precedence
      templateContext = {
        ...projectContext,
        writePatterns: projectContext.writePatterns.length > 0
          ? projectContext.writePatterns
          : agentPatterns.writePatterns,
        readOnlyPatterns: projectContext.readOnlyPatterns.length > 0
          ? projectContext.readOnlyPatterns
          : agentPatterns.readOnlyPatterns,
        ...context, // User context overrides discovered context
      };

      logger.info(
        {
          projectName: templateContext.projectName,
          framework: templateContext.framework,
          hasTypeScript: templateContext.hasTypeScript,
        },
        "Context discovery complete",
      );

      // Phase 3: Add git diff if requested
      if (includeGitDiff) {
        logger.debug("Including git diff in context");
        const gitDiff = await getGitDiff(projectPath);
        if (gitDiff) {
          templateContext.gitDiff = gitDiff;
          logger.info({ diffLength: gitDiff.length }, "Git diff added to context");
        }
      }
    }

    // Phase 3: Template hierarchy - find template with lookup order
    const templatePath = await findTemplate(
      agentType,
      projectPath,
      getBundledTemplatesDir(),
    );

    logger.debug({ templatePath }, "Template resolved");

    // Create renderer and register partials (Phase 3)
    const renderer = new TemplateRenderer();
    await registerBundledPartials(renderer);

    // Render template with context
    const prompt = renderer.render(templatePath, templateContext);

    logger.info(
      {
        agentType,
        templatePath,
        promptLength: prompt.length,
        contextKeys: Object.keys(templateContext).length,
        hasGitDiff: !!templateContext.gitDiff,
      },
      "Agent prompt rendered successfully",
    );

    return {
      agentType,
      prompt,
      valid: true,
      availableAgents: AGENT_TYPES,
    };
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        agentType,
      },
      "Failed to get agent prompt",
    );
    throw error;
  }
}
