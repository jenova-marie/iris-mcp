# Agent Prompt System Implementation Guide

## Overview

The Iris MCP agent prompt system provides specialized, context-aware prompts for different agent roles. The system uses Handlebars templates to enable powerful, flexible prompt generation with automatic project context detection.

**NEW**: As of this implementation, agent prompts are exposed via the **native MCP prompts protocol** (`prompts/list` and `prompts/get`), making them first-class citizens in the MCP ecosystem alongside tools and resources.

## MCP Prompts Integration

### Native Protocol Support

The agent system is accessible through two interfaces:

1. **MCP Prompts** (Recommended) - Native MCP protocol
   - `prompts/list` - Discover all 10 available agent prompts
   - `prompts/get` - Request a specific agent prompt with arguments
   - Better integration with MCP clients (Claude Code, etc.)
   - More idiomatic to the MCP specification

2. **MCP Tool** (Legacy) - `get_agent` tool
   - Returns JSON with the prompt text
   - Requires manual execution by the caller
   - Kept for backward compatibility

### Using MCP Prompts

**List Available Prompts:**
```typescript
// MCP Client
const result = await client.listPrompts();
// Returns: { prompts: [{ name: "tech-writer", description: "...", arguments: [...] }, ...] }
```

**Get a Specific Prompt:**
```typescript
// MCP Client
const prompt = await client.getPrompt({
  name: "tech-writer",
  arguments: {
    projectPath: "/path/to/project",
    includeGitDiff: "true"
  }
});

// Returns:
// {
//   description: "Specialized tech writer agent prompt with project context and git diff",
//   messages: [
//     {
//       role: "user",
//       content: {
//         type: "text",
//         text: "# Technical Documentation Writer Agent\n\n..."
//       }
//     }
//   ]
// }
```

### Server Capabilities

The Iris MCP server now advertises:
```json
{
  "capabilities": {
    "tools": {},
    "prompts": {},    // ← NEW
    "resources": {}   // Future
  }
}
```

### Available Agent Prompts

All 10 agent types are exposed as MCP prompts:

1. `tech-writer` - Technical documentation specialist
2. `unit-tester` - Unit testing expert
3. `integration-tester` - Integration testing specialist
4. `code-reviewer` - Code review expert
5. `debugger` - Debugging specialist
6. `refactorer` - Code refactoring expert
7. `changeloger` - Changelog writer
8. `error-handler` - Error handling specialist
9. `example-writer` - Code examples writer
10. `logger` - Logging enhancement specialist

Each prompt accepts optional arguments:
- `projectPath` (string) - Path to project for context discovery
- `includeGitDiff` (string: "true"/"false") - Include uncommitted changes

### Why Handlebars?

- **Simple Syntax**: `{{variable}}` interpolation familiar to developers
- **Conditionals & Loops**: Support for `{{#if}}`, `{{#each}}`, and other helpers
- **Safe**: No arbitrary code execution vulnerabilities
- **Well-Documented**: Mature, stable library with excellent documentation
- **Small**: ~50kb dependency, minimal overhead

### Architecture

The system is built in three phases:

1. **Phase 1 ✅**: Handlebars foundation with basic templates
2. **Phase 2 ✅**: Auto-detection of project context
3. **Phase 3 ✅**: Template hierarchy and advanced features

---

## Phase 1: Handlebars Foundation ✅ IMPLEMENTED

### Current Status: COMPLETE

Phase 1 provides the foundational template system with Handlebars support.

### Components

#### 1. Template Renderer (`src/agents/template-renderer.ts`)

The `TemplateRenderer` class wraps Handlebars and provides:

```typescript
class TemplateRenderer {
  // Render template from file path
  render(templatePath: string, context: Record<string, any>): string

  // Render template from string
  renderFromString(templateString: string, context: Record<string, any>): string
}
```

**Built-in Handlebars Helpers:**
- `eq` - Equality comparison: `{{#if (eq framework "React")}}...{{/if}}`
- `includes` - Array membership: `{{#if (includes deps "typescript")}}...{{/if}}`
- `upper` - Uppercase: `{{upper framework}}` → `REACT`
- `lower` - Lowercase: `{{lower framework}}` → `react`
- `json` - JSON stringify for debugging: `{{{json context}}}`

#### 2. Agent Action (`src/actions/agent.ts`)

Manages agent template loading and rendering.

**Agent Types Available:**
1. `tech-writer` - Technical documentation specialist
2. `unit-tester` - Unit testing expert
3. `integration-tester` - Integration testing specialist
4. `code-reviewer` - Code review expert
5. `debugger` - Debugging specialist
6. `refactorer` - Code refactoring expert
7. `changeloger` - Changelog writer
8. `error-handler` - Error handling specialist
9. `example-writer` - Code examples writer
10. `logger` - Logging enhancement specialist

**API:**
```typescript
interface AgentInput {
  agentType: string              // e.g., "tech-writer"
  context?: Record<string, any>  // Optional variables for template
}

interface AgentOutput {
  agentType: string
  prompt: string                 // Rendered prompt text
  valid: boolean
  availableAgents: readonly string[]
}
```

#### 3. Templates (`templates/base/*.hbs`)

All agent templates are stored as Handlebars templates in `templates/base/`:

```
templates/base/
├── changeloger.hbs
├── code-reviewer.hbs
├── debugger.hbs
├── error-handler.hbs
├── example-writer.hbs
├── integration-tester.hbs
├── logger.hbs
├── refactorer.hbs
├── tech-writer.hbs
└── unit-tester.hbs
```

### Using the Agent System

#### From MCP Tool

```typescript
// Call via MCP tool "get_agent"
{
  "agentType": "tech-writer",
  "context": {
    "projectName": "iris-mcp",
    "version": "1.0.0"
  }
}

// Returns:
{
  "agentType": "tech-writer",
  "prompt": "# Technical Documentation Writer Agent\n\nYou are a technical documentation specialist for the iris-mcp project...",
  "valid": true,
  "availableAgents": ["tech-writer", "unit-tester", ...]
}
```

#### Programmatically

```typescript
import { agent } from './actions/agent.js';

const result = await agent({
  agentType: 'unit-tester',
  context: {
    testingFramework: 'Vitest',
    projectName: 'my-app'
  }
});

console.log(result.prompt);
```

### Template Format (Phase 1)

Templates use basic Handlebars syntax:

```handlebars
# {{agentType}} Agent

You are working on project: {{projectName}}

{{#if version}}
Version: {{version}}
{{/if}}

Your responsibilities:
- Task 1
- Task 2
```

### Build Process

The build script copies templates to dist:

```bash
pnpm build:server
# Runs: tsc && cp src/default.config.yaml dist/ && cp -r templates dist/
```

**Result:**
```
dist/
├── templates/
│   └── base/
│       ├── tech-writer.hbs
│       ├── unit-tester.hbs
│       └── ...
```

### Testing

All 10 agents are tested and verified working:

```bash
✅ tech-writer: OK (1336 chars)
✅ unit-tester: OK (1515 chars)
✅ integration-tester: OK (1919 chars)
✅ code-reviewer: OK (1627 chars)
✅ debugger: OK (2022 chars)
✅ refactorer: OK (2658 chars)
✅ changeloger: OK (2316 chars)
✅ error-handler: OK (3193 chars)
✅ example-writer: OK (3489 chars)
✅ logger: OK (4202 chars)
```

---

## Phase 2: Context Discovery ✅ IMPLEMENTED

### Status: COMPLETE

Phase 2 provides automatic project context detection and template enrichment.

### Goal

Automatically detect project context and enrich templates with environment-specific information.

### Components

#### 1. Context Discovery (`src/agents/context-discovery.ts`)

```typescript
interface ProjectContext {
  projectName: string
  hasTypeScript: boolean
  framework?: string          // React, Vue, Express, etc.
  testingFramework: string    // Vitest, Jest, pytest
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  writePatterns: string[]     // Files agent can modify
  readOnlyPatterns: string[]  // Files agent can read only
  claudeMd?: string           // CLAUDE.md contents
  customVars?: Record<string, any>  // From .iris/context.yaml
}
```

**Auto-Detection:**
- Project name from `package.json` or directory
- TypeScript detection from `tsconfig.json` or dependencies
- Framework detection from dependencies (React, Vue, Express, etc.)
- Testing framework from configs and dependencies
- All dependencies for version-aware prompts

#### 2. Project Configuration (`.iris/context.yaml`)

Users can override detected values:

```yaml
# .iris/context.yaml
docStyle: "Google Developer Documentation Style Guide"

writePatterns:
  - "**/*.md"
  - "docs/**/*"
  - "src/**/*.stories.tsx"  # Project-specific additions

readOnlyPatterns:
  - "src/**/*.tsx"
  - "src/**/*.ts"

customVars:
  componentLibrary: "Radix UI"
  stateManagement: "Zustand"
  apiPattern: "React Query"
```

#### 3. Enhanced Templates

Templates will use context variables:

```handlebars
# Technical Documentation Writer

Project: {{projectName}}

{{#if hasTypeScript}}
**TypeScript Project**
- Use TypeScript syntax in examples
- Document types and interfaces
{{else}}
**JavaScript Project**
- Use JavaScript syntax in examples
{{/if}}

{{#if framework}}
**Framework: {{framework}}**
{{#if (eq framework "React")}}
- Follow React component documentation patterns
- Document props, hooks, and component APIs
{{/if}}
{{/if}}

**Testing Framework: {{testingFramework}}**

## File Permissions

You may ONLY modify:
{{#each writePatterns}}
- {{this}}
{{/each}}

You may read but NOT modify:
{{#each readOnlyPatterns}}
- {{this}}
{{/each}}

{{#if claudeMd}}
## Project-Specific Guidelines

{{{claudeMd}}}
{{/if}}
```

#### 4. Default Patterns Per Agent

Different agents get different file permissions:

**tech-writer:**
```typescript
writePatterns: ['**/*.md', 'docs/**/*', '**/*.mdx']
readOnlyPatterns: ['src/**/*', 'lib/**/*', 'package.json']
```

**unit-tester:**
```typescript
writePatterns: ['**/*.test.ts', '**/*.spec.ts', 'tests/unit/**/*']
readOnlyPatterns: ['src/**/*.ts']
```

**logger:**
```typescript
writePatterns: ['src/**/*.ts', 'src/**/*.js']  // Can modify source
readOnlyPatterns: ['tests/**/*', 'node_modules/**/*']
```

### Integration

Update `src/actions/agent.ts`:

```typescript
import { ContextDiscovery } from '../agents/context-discovery.js';

export async function agent(input: AgentInput): Promise<AgentOutput> {
  // Get team config to find project path
  const teamConfig = getTeamConfig(input.team);

  // Discover project context
  const discovery = new ContextDiscovery(teamConfig.path);
  const projectContext = await discovery.discover();

  // Merge with user-provided context
  const context = { ...projectContext, ...input.context };

  // Render template with enriched context
  const renderer = new TemplateRenderer();
  const prompt = renderer.render(templatePath, context);

  return { agentType, prompt, valid: true, availableAgents: AGENT_TYPES };
}
```

### Testing & Validation

Phase 2 has been tested and validated:

**✅ Context Discovery Tested:**
- Correctly detects project name from package.json
- Identifies TypeScript projects
- Detects frameworks (React, Vue, Express, NestJS, etc.)
- Identifies testing frameworks (Vitest, Jest, Mocha, etc.)
- Reads CLAUDE.md contents
- Loads custom variables from .iris/context.yaml
- Provides default file patterns per agent type

**✅ Template Rendering Tested:**
- All 10 agent templates render with context
- Handlebars conditionals work correctly (`{{#if hasTypeScript}}`)
- Framework-specific sections appear appropriately
- File permissions listed in prompts
- Custom variables interpolate correctly
- Project guidelines from CLAUDE.md included

**✅ Backward Compatibility:**
- Phase 1 mode still works (without projectPath parameter)
- Manual context still supported
- No breaking changes to existing API

**Test Results (on iris-mcp itself):**
- Project detected: @jenova-marie/iris-mcp
- TypeScript: ✅ Detected
- Framework: React ✅ Detected
- Testing: Vitest ✅ Detected
- All 10 agents: ✅ Rendering successfully
- Prompt lengths: 10-13KB (context-enriched)

---

## Phase 3: Advanced Features ✅ IMPLEMENTED

### Current Status: COMPLETE

Phase 3 adds template hierarchy, git diff integration, partials, and advanced customization.

### Goal

Enable template hierarchy, git diff integration, partials, and advanced customization.

### Features

#### 1. Template Hierarchy

**Lookup Order:**
1. `<project>/.iris/templates/{agentType}.hbs` (highest priority)
2. `~/.iris/templates/custom/{agentType}.hbs`
3. `~/.iris/templates/base/{agentType}.hbs`
4. `dist/templates/base/{agentType}.hbs` (bundled, lowest)

```typescript
async function findTemplate(role: string, projectPath: string): Promise<string> {
  const locations = [
    join(projectPath, '.iris', 'templates', `${role}.hbs`),
    join(os.homedir(), '.iris', 'templates', 'custom', `${role}.hbs`),
    join(os.homedir(), '.iris', 'templates', 'base', `${role}.hbs`),
    join(__dirname, '../templates/base', `${role}.hbs`)
  ];

  for (const location of locations) {
    if (await fileExists(location)) {
      return location;
    }
  }

  throw new Error(`Template not found: ${role}`);
}
```

#### 2. Git Diff Integration

Include recent changes in context:

```typescript
// Add includeGitDiff parameter
interface AgentInput {
  agentType: string
  context?: Record<string, any>
  includeGitDiff?: boolean  // NEW
}

// In agent function:
if (input.includeGitDiff) {
  context.gitDiff = await getGitDiff(projectPath);
}

// In template:
{{#if gitDiff}}
**Recent Changes:**
```
{{{gitDiff}}}
```

Update documentation to reflect these changes.
{{/if}}
```

#### 3. Template Partials

Support template inheritance:

```handlebars
{{!-- project/.iris/templates/tech-writer.hbs --}}
{{> base/tech-writer}}

{{!-- Project-specific additions --}}

**Component Library: {{customVars.componentLibrary}}**
- Reference {{customVars.componentLibrary}} patterns
- Link to official documentation

**Additional Guidelines:**
{{{techWriterAdditions}}}
```

**Implementation:**
```typescript
class TemplateRenderer {
  constructor() {
    this.handlebars = Handlebars.create();

    // Register partials directory
    this.handlebars.registerPartial('base/tech-writer',
      readFileSync('templates/base/tech-writer.hbs', 'utf-8')
    );
  }
}
```

#### 4. Custom Helpers

Add specialized Handlebars helpers:

```typescript
// Check if package is installed
this.handlebars.registerHelper('hasPackage', (pkgName, deps) => {
  return deps[pkgName] !== undefined;
});

// Version comparison
this.handlebars.registerHelper('minVersion', (pkg, version, deps) => {
  const installed = deps[pkg];
  return installed && semver.gte(installed, version);
});

// Usage in templates:
{{#if (hasPackage "react" dependencies)}}
React detected: {{dependencies.react}}
{{/if}}

{{#if (minVersion "react" "18.0.0" dependencies)}}
Using React 18+ features
{{/if}}
```

### Implementation Details

**Files Created/Modified:**

1. **`src/agents/template-utils.ts`** - Template hierarchy and git integration
   - `getGitDiff(projectPath)` - Executes `git diff HEAD` with 5MB limit
   - `findTemplate(agentType, projectPath, bundledDir)` - 4-level hierarchy lookup
   - Handles git errors gracefully (returns undefined if not a repo)

2. **`src/agents/template-renderer.ts`** - Enhanced with advanced helpers
   - `hasPackage(pkgName, deps)` - Check if package exists in dependencies
   - `not(value)` - Boolean negation
   - `or(...args)` - Logical OR across multiple values
   - `and(...args)` - Logical AND across multiple values
   - `registerPartial(name, template)` - Register template partials

3. **`src/actions/agent.ts`** - Updated with Phase 3 integration
   - Added `includeGitDiff?: boolean` to `AgentInput` interface
   - Integrated `getGitDiff()` when `includeGitDiff` is true
   - Replaced direct template path with `findTemplate()` hierarchy
   - Registers all bundled templates as `base/{agentType}` partials

4. **`.iris/templates/tech-writer.hbs`** - Example project override
   - Demonstrates partial inheritance: `{{> base/tech-writer}}`
   - Shows project-specific additions after base template
   - Iris MCP-specific documentation guidelines
   - Custom variable usage examples

**Updated API:**

```typescript
export interface AgentInput {
  agentType: string;
  context?: Record<string, any>;
  projectPath?: string;
  includeGitDiff?: boolean;  // Phase 3: NEW
}
```

### Testing Phase 3

**Test Script:** `test-phase3.ts`

```bash
npx tsx test-phase3.ts
```

**Test Results:**

```
================================================================================
PHASE 3 TEST - Advanced Features
================================================================================

1️⃣  Test: Git Diff Integration
--------------------------------------------------------------------------------
✅ Git diff successfully included in prompt
   Prompt length: 22932 characters

2️⃣  Test: Template Hierarchy (Project Override)
--------------------------------------------------------------------------------
✅ Project-specific template override working!
   Found: 'Iris MCP Project-Specific Guidelines' section
✅ Partial inheritance working (base template included)

3️⃣  Test: Advanced Handlebars Helpers
--------------------------------------------------------------------------------
✅ Custom variables interpolation working

4️⃣  Test: Template Hierarchy Priority
--------------------------------------------------------------------------------
   Lookup order tested:
   1. Project-specific (.iris/templates/) ← FOUND
   2. User custom (~/.iris/templates/custom/)
   3. User override (~/.iris/templates/base/)
   4. Bundled (dist/templates/base/)

5️⃣  Test: Git Diff with Custom Context
--------------------------------------------------------------------------------
   Git diff included: ✅
   Custom variables: ✅
   Project override: ✅

6️⃣  Test: Fallback to Bundled Template
--------------------------------------------------------------------------------
✅ Fallback to bundled template working
   (debugger has no project override, used bundled)

================================================================================
✅ PHASE 3 TEST COMPLETE - All features validated!
================================================================================

Phase 3 Features Implemented:
  ✓ Git diff integration via includeGitDiff parameter
  ✓ Template hierarchy with 4-level lookup
  ✓ Partial inheritance using {{> base/agent-name}}
  ✓ Advanced helpers: hasPackage, not, or, and
  ✓ Context merging (discovered + custom + git diff)
  ✓ Project-specific template overrides
```

**Metrics:**
- Template hierarchy: 4 levels of lookup
- Git diff: Up to 5MB max buffer
- Advanced helpers: 9 total (5 Phase 1 + 4 Phase 3)
- Project override example: 2510 bytes → 22932 bytes (with diff)
- Partials: All 10 agent types registered as `base/{agentType}`

---

## Template Authoring Guide

### Basic Syntax

```handlebars
{{!-- Variables --}}
Project: {{projectName}}
Version: {{version}}

{{!-- Conditionals --}}
{{#if hasTypeScript}}
  TypeScript enabled
{{else}}
  JavaScript project
{{/if}}

{{!-- Loops --}}
{{#each dependencies}}
  - {{@key}}: {{this}}
{{/each}}

{{!-- Triple braces for unescaped HTML/Markdown --}}
{{{claudeMd}}}
```

### Best Practices

1. **Provide Defaults**: Always handle missing variables gracefully
   ```handlebars
   Framework: {{framework}} {{!-- or --}} {{#if framework}}{{framework}}{{else}}Unknown{{/if}}
   ```

2. **Structure Clearly**: Use markdown headers and formatting
   ```handlebars
   # {{agentType}} Agent

   ## Responsibilities

   ## Context

   ## Guidelines
   ```

3. **Document Variables**: Add comments for template authors
   ```handlebars
   {{!-- @param projectName - Name of the project --}}
   {{!-- @param framework - Detected framework (React, Vue, etc.) --}}
   ```

4. **Test All Paths**: Test with and without optional variables
   ```handlebars
   {{#if customVars}}
     {{#if customVars.apiPattern}}
       API: {{customVars.apiPattern}}
     {{/if}}
   {{/if}}
   ```

---

## Context Variables Reference

### Core Variables (Phase 1)

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `projectName` | string | `"iris-mcp"` | Project name |
| `version` | string | `"1.0.0"` | Version number |
| *(any custom)* | any | - | User-provided context |

### Auto-Detected (Phase 2)

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `hasTypeScript` | boolean | `true` | TypeScript detected |
| `framework` | string? | `"React"` | Detected framework |
| `testingFramework` | string | `"Vitest"` | Testing framework |
| `dependencies` | object | `{"react": "^18.0.0"}` | All dependencies |
| `writePatterns` | string[] | `["**/*.md"]` | Modifiable files |
| `readOnlyPatterns` | string[] | `["src/**/*"]` | Read-only files |
| `claudeMd` | string? | `"# Project..."` | CLAUDE.md content |

### Advanced (Phase 3)

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `gitDiff` | string? | `"diff --git..."` | Recent git changes |
| `customVars.*` | any | `{apiPattern: "REST"}` | User custom variables |

---

## Migration Guide

### From Simple Text to Handlebars

**Before (Phase 0 - .txt):**
```
# Technical Documentation Writer Agent

You are a technical documentation specialist.
```

**After (Phase 1 - .hbs):**
```handlebars
# Technical Documentation Writer Agent

You are a technical documentation specialist for the {{projectName}} project.

{{#if version}}
Version: {{version}}
{{/if}}
```

**Future (Phase 2 - Context-aware):**
```handlebars
# Technical Documentation Writer Agent

Project: {{projectName}} ({{#if hasTypeScript}}TypeScript{{else}}JavaScript{{/if}})

{{#if framework}}
Framework: {{framework}}
{{/if}}

Testing: {{testingFramework}}

## File Permissions
{{#each writePatterns}}
- ✅ {{this}}
{{/each}}
```

---

## Troubleshooting

### Template Not Found

**Error:** `Failed to load template for agent type "tech-writer"`

**Solutions:**
1. Verify template exists: `ls templates/base/tech-writer.hbs`
2. Check build copied templates: `ls dist/templates/base/tech-writer.hbs`
3. Rebuild: `pnpm build:server`

### Handlebars Syntax Error

**Error:** `Parse error on line X`

**Common Issues:**
1. Unclosed blocks: `{{#if ...}}` needs `{{/if}}`
2. Typo in helper: `{{#iff ...}}` should be `{{#if ...}}`
3. Missing closing braces: `{{variable` should be `{{variable}}`

### Context Variables Not Interpolating

**Problem:** `{{projectName}}` appears literally in output

**Solutions:**
1. Ensure context is passed: `agent({ agentType, context: { projectName: 'foo' } })`
2. Check variable name spelling
3. Use `{{{json context}}}` to debug available variables

---

## Future Roadmap

### Phase 4: Intelligence Layer

- **Context Learning**: Remember project preferences across sessions
- **Prompt Optimization**: A/B test prompts for effectiveness
- **Dynamic Templates**: Generate templates based on codebase analysis

### Phase 5: Multi-Agent Coordination

- **Agent Handoffs**: Tech-writer → example-writer → unit-tester workflow
- **Conflict Resolution**: Multiple agents modifying same files
- **Shared Context**: Agents share discovered context

---

## Examples

### Example 1: Basic Usage

```typescript
const result = await agent({
  agentType: 'tech-writer',
  context: {
    projectName: 'my-app',
    version: '2.1.0'
  }
});

console.log(result.prompt);
// "# Technical Documentation Writer Agent
//  You are a technical documentation specialist for the my-app project.
//  Version: 2.1.0 ..."
```

### Example 2: Custom Agent Template

Create `~/.iris/templates/custom/api-tester.hbs`:

```handlebars
# API Testing Specialist

You test REST APIs for the {{projectName}} project.

{{#if customVars.apiBaseUrl}}
Base URL: {{customVars.apiBaseUrl}}
{{/if}}

{{#if customVars.authType}}
Authentication: {{customVars.authType}}
{{/if}}

Test all endpoints for:
- 200 OK responses
- Error handling
- Input validation
- Rate limiting
```

Usage:
```typescript
const result = await agent({
  agentType: 'api-tester',
  context: {
    projectName: 'my-api',
    customVars: {
      apiBaseUrl: 'https://api.example.com',
      authType: 'Bearer Token'
    }
  }
});
```

---

## Contributing

### Adding a New Agent Type

1. Add to `AGENT_TYPES` in `src/actions/agent.ts`:
   ```typescript
   export const AGENT_TYPES = [
     // ...
     "new-agent",
   ] as const;
   ```

2. Create template `templates/base/new-agent.hbs`:
   ```handlebars
   # New Agent Specialist

   You are a specialist in XYZ for the {{projectName}} project.
   ```

3. Register in MCP tools (if needed)

4. Test:
   ```bash
   pnpm build:server
   # Test via MCP or programmatically
   ```

---

## License

This agent prompt system is part of Iris MCP. See LICENSE file for details.
