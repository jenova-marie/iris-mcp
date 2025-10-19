/**
 * Context Discovery
 * Automatically detect project context and configuration
 */

import { readFile, access } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("agents:context-discovery");

export interface ProjectContext {
  /** Project name from package.json or directory name */
  projectName: string;

  /** TypeScript detected in project */
  hasTypeScript: boolean;

  /** Detected framework (React, Vue, Express, etc.) */
  framework?: string;

  /** Detected testing framework (Vitest, Jest, pytest, etc.) */
  testingFramework: string;

  /** Production dependencies */
  dependencies: Record<string, string>;

  /** Development dependencies */
  devDependencies: Record<string, string>;

  /** File patterns the agent can modify */
  writePatterns: string[];

  /** File patterns the agent can read but not modify */
  readOnlyPatterns: string[];

  /** Contents of CLAUDE.md if exists */
  claudeMd?: string;

  /** Custom variables from .iris/context.yaml */
  customVars?: Record<string, any>;
}

export class ContextDiscovery {
  constructor(private projectPath: string) {}

  /**
   * Discover all project context
   */
  async discover(): Promise<ProjectContext> {
    logger.info({ projectPath: this.projectPath }, "Discovering project context");

    const context: ProjectContext = {
      projectName: await this.getProjectName(),
      hasTypeScript: await this.hasTypeScript(),
      framework: await this.detectFramework(),
      testingFramework: await this.detectTestingFramework(),
      dependencies: await this.getDependencies(),
      devDependencies: await this.getDevDependencies(),
      writePatterns: [],
      readOnlyPatterns: [],
      claudeMd: await this.getClaudeMd(),
      customVars: await this.getCustomVars(),
    };

    // Get patterns from custom config or use defaults
    const customContext = await this.loadCustomContext();
    context.writePatterns =
      customContext.writePatterns || this.getDefaultWritePatterns();
    context.readOnlyPatterns =
      customContext.readOnlyPatterns || this.getDefaultReadOnlyPatterns();

    logger.info(
      {
        projectName: context.projectName,
        framework: context.framework,
        hasTypeScript: context.hasTypeScript,
        testingFramework: context.testingFramework,
        depCount: Object.keys(context.dependencies).length,
        hasClaudeMd: !!context.claudeMd,
        hasCustomVars: !!context.customVars,
      },
      "Context discovery complete",
    );

    return context;
  }

  /**
   * Get project name from package.json or directory name
   */
  private async getProjectName(): Promise<string> {
    try {
      const pkg = await this.readPackageJson();
      return pkg.name || this.projectPath.split("/").pop() || "unknown";
    } catch {
      return this.projectPath.split("/").pop() || "unknown";
    }
  }

  /**
   * Check if TypeScript is used in the project
   */
  private async hasTypeScript(): Promise<boolean> {
    try {
      // Check for tsconfig.json
      if (await this.fileExists("tsconfig.json")) {
        return true;
      }

      // Check for TypeScript in dependencies
      const pkg = await this.readPackageJson();
      return !!(
        pkg.dependencies?.typescript || pkg.devDependencies?.typescript
      );
    } catch {
      return false;
    }
  }

  /**
   * Detect framework from dependencies
   */
  private async detectFramework(): Promise<string | undefined> {
    try {
      const pkg = await this.readPackageJson();
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Frontend frameworks
      if (deps.react) return "React";
      if (deps.vue) return "Vue";
      if (deps["@angular/core"]) return "Angular";
      if (deps.svelte) return "Svelte";
      if (deps.next) return "Next.js";
      if (deps.nuxt) return "Nuxt";

      // Backend frameworks
      if (deps.express) return "Express";
      if (deps.fastify) return "Fastify";
      if (deps["@nestjs/core"]) return "NestJS";
      if (deps.koa) return "Koa";
      if (deps.hapi) return "Hapi";

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Detect testing framework
   */
  private async detectTestingFramework(): Promise<string> {
    try {
      const pkg = await this.readPackageJson();
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check for Vitest
      if (deps.vitest || (await this.fileExists("vitest.config.ts"))) {
        return "Vitest";
      }

      // Check for Jest
      if (
        deps.jest ||
        (await this.fileExists("jest.config.js")) ||
        (await this.fileExists("jest.config.ts"))
      ) {
        return "Jest";
      }

      // Other frameworks
      if (deps.mocha) return "Mocha";
      if (deps.jasmine) return "Jasmine";
      if (deps.ava) return "Ava";
      if (deps.tape) return "Tape";

      // Python
      if (await this.fileExists("pytest.ini")) return "pytest";
      if (await this.fileExists("setup.py")) return "unittest";

      // Default assumption for Node projects
      return "Jest";
    } catch {
      return "Jest";
    }
  }

  /**
   * Get production dependencies
   */
  private async getDependencies(): Promise<Record<string, string>> {
    try {
      const pkg = await this.readPackageJson();
      return pkg.dependencies || {};
    } catch {
      return {};
    }
  }

  /**
   * Get development dependencies
   */
  private async getDevDependencies(): Promise<Record<string, string>> {
    try {
      const pkg = await this.readPackageJson();
      return pkg.devDependencies || {};
    } catch {
      return {};
    }
  }

  /**
   * Get CLAUDE.md contents if exists
   */
  private async getClaudeMd(): Promise<string | undefined> {
    try {
      const claudeMdPath = join(this.projectPath, "CLAUDE.md");
      return await readFile(claudeMdPath, "utf-8");
    } catch {
      return undefined;
    }
  }

  /**
   * Get custom variables from .iris/context.yaml
   */
  private async getCustomVars(): Promise<Record<string, any> | undefined> {
    try {
      const customContext = await this.loadCustomContext();
      return customContext.customVars;
    } catch {
      return undefined;
    }
  }

  /**
   * Load custom context from .iris/context.yaml
   */
  private async loadCustomContext(): Promise<any> {
    try {
      const contextPath = join(this.projectPath, ".iris", "context.yaml");
      const contextYaml = await readFile(contextPath, "utf-8");
      return parseYaml(contextYaml) || {};
    } catch {
      return {};
    }
  }

  /**
   * Get default write patterns (files agent can modify)
   */
  private getDefaultWritePatterns(): string[] {
    return [
      "**/*.md",
      "docs/**/*",
      "**/*.mdx",
    ];
  }

  /**
   * Get default read-only patterns
   */
  private getDefaultReadOnlyPatterns(): string[] {
    return [
      "src/**/*",
      "lib/**/*",
      "package.json",
      "tsconfig.json",
      "node_modules/**/*",
    ];
  }

  /**
   * Read package.json
   */
  private async readPackageJson(): Promise<any> {
    const pkgPath = join(this.projectPath, "package.json");
    const content = await readFile(pkgPath, "utf-8");
    return JSON.parse(content);
  }

  /**
   * Check if file exists
   */
  private async fileExists(filename: string): Promise<boolean> {
    try {
      await access(join(this.projectPath, filename));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get default file patterns for specific agent types
 */
export function getAgentPatterns(agentType: string): {
  writePatterns: string[];
  readOnlyPatterns: string[];
} {
  const patterns: Record<
    string,
    { writePatterns: string[]; readOnlyPatterns: string[] }
  > = {
    "tech-writer": {
      writePatterns: ["**/*.md", "docs/**/*", "**/*.mdx", "README*"],
      readOnlyPatterns: ["src/**/*", "lib/**/*", "package.json"],
    },

    "unit-tester": {
      writePatterns: [
        "**/*.test.ts",
        "**/*.test.js",
        "**/*.spec.ts",
        "**/*.spec.js",
        "tests/unit/**/*",
        "test/unit/**/*",
      ],
      readOnlyPatterns: ["src/**/*.ts", "src/**/*.js", "lib/**/*"],
    },

    "integration-tester": {
      writePatterns: [
        "**/*.integration.test.ts",
        "**/*.integration.test.js",
        "tests/integration/**/*",
        "test/integration/**/*",
      ],
      readOnlyPatterns: ["src/**/*", "lib/**/*", "dist/**/*"],
    },

    "code-reviewer": {
      writePatterns: [], // Read-only agent
      readOnlyPatterns: ["**/*"],
    },

    debugger: {
      writePatterns: [
        "src/**/*.ts",
        "src/**/*.js",
        "lib/**/*.ts",
        "lib/**/*.js",
      ],
      readOnlyPatterns: ["node_modules/**/*", "dist/**/*"],
    },

    refactorer: {
      writePatterns: [
        "src/**/*.ts",
        "src/**/*.js",
        "lib/**/*.ts",
        "lib/**/*.js",
      ],
      readOnlyPatterns: [
        "tests/**/*",
        "node_modules/**/*",
        "package.json",
        "tsconfig.json",
      ],
    },

    changeloger: {
      writePatterns: ["CHANGELOG.md", "CHANGELOG*", "docs/CHANGELOG*"],
      readOnlyPatterns: ["**/*"],
    },

    "error-handler": {
      writePatterns: [
        "src/errors/**/*",
        "src/utils/errors.ts",
        "src/utils/errors.js",
        "src/**/*.ts",
        "src/**/*.js",
      ],
      readOnlyPatterns: ["tests/**/*", "node_modules/**/*"],
    },

    "example-writer": {
      writePatterns: [
        "examples/**/*",
        "docs/examples/**/*",
        "**/*.example.ts",
        "**/*.example.js",
      ],
      readOnlyPatterns: ["src/**/*", "lib/**/*"],
    },

    logger: {
      writePatterns: [
        "src/**/*.ts",
        "src/**/*.js",
        "lib/**/*.ts",
        "lib/**/*.js",
      ],
      readOnlyPatterns: ["tests/**/*", "node_modules/**/*"],
    },
  };

  return (
    patterns[agentType] || {
      writePatterns: ["**/*.md"],
      readOnlyPatterns: ["**/*"],
    }
  );
}
