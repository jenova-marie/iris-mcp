/**
 * Template Renderer
 * Handlebars-based template rendering for agent prompts
 */

import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("agents:template-renderer");

export class TemplateRenderer {
  private handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
    logger.debug("TemplateRenderer initialized");
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Equality helper
    this.handlebars.registerHelper("eq", (a, b) => a === b);

    // Includes helper (array contains value)
    this.handlebars.registerHelper(
      "includes",
      (array, value) => Array.isArray(array) && array.includes(value),
    );

    // Upper case transformation
    this.handlebars.registerHelper("upper", (str) => str?.toUpperCase());

    // Lower case transformation
    this.handlebars.registerHelper("lower", (str) => str?.toLowerCase());

    // JSON stringify (useful for debugging context)
    this.handlebars.registerHelper("json", (obj) =>
      JSON.stringify(obj, null, 2),
    );

    // Check if package exists in dependencies
    this.handlebars.registerHelper("hasPackage", (pkgName, deps) => {
      return deps && typeof deps === "object" && deps[pkgName] !== undefined;
    });

    // Not helper
    this.handlebars.registerHelper("not", (value) => !value);

    // Or helper
    this.handlebars.registerHelper("or", (...args) => {
      // Last arg is Handlebars options object, exclude it
      const values = args.slice(0, -1);
      return values.some((v) => !!v);
    });

    // And helper
    this.handlebars.registerHelper("and", (...args) => {
      // Last arg is Handlebars options object, exclude it
      const values = args.slice(0, -1);
      return values.every((v) => !!v);
    });

    logger.debug("Handlebars helpers registered", {
      helpers: ["eq", "includes", "upper", "lower", "json", "hasPackage", "not", "or", "and"],
    });
  }

  /**
   * Register a partial template
   */
  registerPartial(name: string, template: string): void {
    this.handlebars.registerPartial(name, template);
    logger.debug({ name }, "Partial registered");
  }

  /**
   * Render a template from a file path
   */
  render(templatePath: string, context: Record<string, any> = {}): string {
    try {
      logger.debug({ templatePath, contextKeys: Object.keys(context) }, "Rendering template from file");

      const templateContent = readFileSync(templatePath, "utf-8");
      const template = this.handlebars.compile(templateContent);
      const result = template(context);

      logger.debug(
        {
          templatePath,
          inputLength: templateContent.length,
          outputLength: result.length,
        },
        "Template rendered successfully",
      );

      return result;
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          templatePath,
        },
        "Failed to render template from file",
      );
      throw new Error(
        `Failed to render template "${templatePath}": ${error}`,
      );
    }
  }

  /**
   * Render a template from a string
   */
  renderFromString(
    templateString: string,
    context: Record<string, any> = {},
  ): string {
    try {
      logger.debug({ templateLength: templateString.length, contextKeys: Object.keys(context) }, "Rendering template from string");

      const template = this.handlebars.compile(templateString);
      const result = template(context);

      logger.debug(
        {
          inputLength: templateString.length,
          outputLength: result.length,
        },
        "Template string rendered successfully",
      );

      return result;
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "Failed to render template from string",
      );
      throw new Error(`Failed to render template string: ${error}`);
    }
  }
}
