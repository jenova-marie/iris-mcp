# Git Worktrees for Parallel Claude Sessions

## Overview

Git worktrees enable **multiple working directories** from a single repository, allowing multiple Claude Code instances to operate simultaneously on different branches, features, or contexts **without conflicts**.

This document explores how git worktrees can enhance Iris MCP's multi-team coordination capabilities, enabling true parallel development workflows.

## What Are Git Worktrees?

Git worktrees allow you to check out multiple branches of the same repository into separate directories simultaneously.

### Traditional Git Model
```
my-project/
├── .git/           # Repository metadata
├── src/            # Working directory (one branch at a time)
├── tests/
└── package.json
```

### Git Worktrees Model
```
my-project/
├── .git/                    # Main repository metadata
├── main/                    # Main branch worktree
│   ├── src/
│   └── package.json
├── feature-auth/            # feature/auth branch worktree
│   ├── src/
│   └── package.json
└── hotfix-bug-123/          # hotfix/bug-123 branch worktree
    ├── src/
    └── package.json
```

**Key Benefits:**
- Each worktree is an independent working directory
- All worktrees share the same `.git` database (efficient storage)
- Can run builds, tests, or Claude sessions in parallel
- No context switching via `git checkout`

## Iris MCP Integration Scenarios

### Scenario 1: Parallel Feature Development

**Setup:**
```bash
# Main repository with Iris MCP team structure
iris-mcp/
├── .git/
├── teams.json
└── src/

# Create worktrees for parallel development
git worktree add ../iris-mcp-frontend feature/frontend-dashboard
git worktree add ../iris-mcp-backend feature/api-endpoints
git worktree add ../iris-mcp-cli feature/ink-cli
```

**teams.json Configuration:**
```json
{
  "teams": {
    "frontend-team": {
      "path": "/Users/jenova/projects/iris-mcp-frontend",
      "description": "Frontend dashboard development team",
      "branch": "feature/frontend-dashboard"
    },
    "backend-team": {
      "path": "/Users/jenova/projects/iris-mcp-backend",
      "description": "API endpoints development team",
      "branch": "feature/api-endpoints"
    },
    "cli-team": {
      "path": "/Users/jenova/projects/iris-mcp-cli",
      "description": "CLI interface development team",
      "branch": "feature/ink-cli"
    }
  }
}
```

**Workflow:**
1. Each team works in its dedicated worktree
2. Teams can communicate via Iris MCP tools (`teams_ask`, `teams_send_message`)
3. Frontend team asks backend team about API schema changes
4. Backend team notifies CLI team when new endpoints are ready
5. All changes exist in separate branches, no merge conflicts during development

**Advantages:**
- **True Parallel Development**: No blocking on `git checkout`
- **Branch Isolation**: Each team has full control of their branch
- **Shared Git History**: All teams see commits in real-time
- **Independent Build Processes**: Run `npm build` in each worktree simultaneously

### Scenario 2: Review + Development Workflow

**Setup:**
```bash
# Main development continues in main worktree
cd /Users/jenova/projects/iris-mcp

# Create review worktree for PR inspection
git worktree add ../iris-mcp-review pr/345
```

**teams.json:**
```json
{
  "teams": {
    "dev-team": {
      "path": "/Users/jenova/projects/iris-mcp",
      "description": "Active development on main/feature branches"
    },
    "review-team": {
      "path": "/Users/jenova/projects/iris-mcp-review",
      "description": "Code review and testing team",
      "readonly": true
    }
  }
}
```

**Workflow:**
1. **dev-team** continues active development on `feature/new-tool`
2. **review-team** inspects PR #345 in separate worktree
3. Review team can:
   - Run full test suite without affecting dev environment
   - Ask dev team questions via `teams_ask("dev-team", "Why did you choose this approach?")`
   - Leave review comments and request changes
4. Dev team receives feedback and makes changes in parallel
5. No interruption to either team's workflow

### Scenario 3: Multi-Environment Testing

**Setup:**
```bash
# Create worktrees for different test scenarios
git worktree add ../iris-mcp-node-18 main
git worktree add ../iris-mcp-node-20 main
git worktree add ../iris-mcp-node-22 main
```

**teams.json:**
```json
{
  "teams": {
    "test-node-18": {
      "path": "/Users/jenova/projects/iris-mcp-node-18",
      "description": "Testing with Node 18.x",
      "environment": "node18"
    },
    "test-node-20": {
      "path": "/Users/jenova/projects/iris-mcp-node-20",
      "description": "Testing with Node 20.x",
      "environment": "node20"
    },
    "test-node-22": {
      "path": "/Users/jenova/projects/iris-mcp-node-22",
      "description": "Testing with Node 22.x",
      "environment": "node22"
    }
  }
}
```

**Workflow:**
1. Each test team runs CI pipeline in their worktree with different Node versions
2. Teams report results to coordination team:
   ```typescript
   await teams_notify("coordinator", `Node 18 tests: 245/250 passed, 5 failed`);
   ```
3. Coordinator aggregates results and makes decisions
4. All tests run in parallel, dramatically reducing CI time

### Scenario 4: Monorepo Package Development

**Setup:**
```bash
# Monorepo with multiple packages
my-monorepo/
├── packages/
│   ├── core/
│   ├── ui/
│   ├── api/
│   └── cli/

# Create worktrees for each package team
git worktree add ../monorepo-core-team feature/core-refactor
git worktree add ../monorepo-ui-team feature/new-components
git worktree add ../monorepo-api-team feature/v2-endpoints
```

**teams.json:**
```json
{
  "teams": {
    "core-team": {
      "path": "/Users/jenova/projects/monorepo-core-team",
      "description": "Core library team",
      "focus": "packages/core"
    },
    "ui-team": {
      "path": "/Users/jenova/projects/monorepo-ui-team",
      "description": "UI components team",
      "focus": "packages/ui"
    },
    "api-team": {
      "path": "/Users/jenova/projects/monorepo-api-team",
      "description": "API server team",
      "focus": "packages/api"
    }
  }
}
```

**Workflow:**
1. UI team asks core team: "What's the new API for the data fetching hook?"
2. Core team responds with documentation and examples
3. API team notifies all teams: "Breaking change in v2 endpoints - migration guide attached"
4. Teams coordinate changes across packages
5. Integration testing team validates changes in separate worktree

## Technical Implementation

### Worktree Management in Iris MCP

**New Configuration Properties:**

```typescript
interface TeamConfig {
  path: string;                    // Absolute path to worktree
  description: string;
  branch?: string;                 // Branch checked out in worktree
  worktree?: boolean;              // Is this a worktree? (vs main repo)
  mainRepo?: string;               // Path to main .git repository
  readonly?: boolean;              // Prevent writes (for review teams)
  autoSync?: boolean;              // Auto-fetch from origin
  environment?: Record<string, string>; // Custom env vars per worktree
}
```

**Worktree Discovery:**

```typescript
import { execSync } from 'child_process';

class WorktreeManager {
  /**
   * Detect if a path is a git worktree
   */
  static isWorktree(projectPath: string): boolean {
    try {
      const gitDir = execSync('git rev-parse --git-dir', {
        cwd: projectPath,
        encoding: 'utf8'
      }).trim();

      // Worktrees have .git file pointing to main repo
      // Main repos have .git directory
      return gitDir.endsWith('.git/worktrees/' + path.basename(projectPath));
    } catch {
      return false;
    }
  }

  /**
   * Get main repository path for a worktree
   */
  static getMainRepo(worktreePath: string): string {
    const gitDir = execSync('git rev-parse --git-common-dir', {
      cwd: worktreePath,
      encoding: 'utf8'
    }).trim();

    return path.dirname(gitDir);
  }

  /**
   * List all worktrees in repository
   */
  static listWorktrees(repoPath: string): Array<{
    path: string;
    branch: string;
    commit: string;
  }> {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf8'
    });

    // Parse output...
    return parsed;
  }

  /**
   * Create worktree for team
   */
  static async createWorktree(
    mainRepo: string,
    branch: string,
    targetPath: string
  ): Promise<void> {
    execSync(`git worktree add "${targetPath}" "${branch}"`, {
      cwd: mainRepo,
      encoding: 'utf8'
    });
  }

  /**
   * Remove worktree
   */
  static async removeWorktree(worktreePath: string): Promise<void> {
    const mainRepo = this.getMainRepo(worktreePath);

    execSync(`git worktree remove "${worktreePath}"`, {
      cwd: mainRepo,
      encoding: 'utf8'
    });
  }
}
```

### Session Management with Worktrees

Each worktree gets its own Claude session directory:

```
~/.claude/projects/
├── -Users-jenova-projects-iris-mcp/              # Main repo sessions
│   └── abc123.jsonl
├── -Users-jenova-projects-iris-mcp-frontend/     # Frontend worktree sessions
│   └── def456.jsonl
└── -Users-jenova-projects-iris-mcp-backend/      # Backend worktree sessions
    └── ghi789.jsonl
```

**Benefits:**
- Complete session isolation per worktree
- No context pollution between teams
- Each team maintains conversation history independently
- Session cleanup is per-worktree (won't affect other teams)

### Process Pool Integration

```typescript
interface ProcessPoolStatus {
  totalProcesses: number;
  processes: {
    [key: string]: {
      status: ProcessStatus;
      worktree?: {
        branch: string;
        mainRepo: string;
        isWorktree: boolean;
      };
    };
  };
}
```

Process keys include worktree info:
- `frontend-team@feature/dashboard->backend-team@feature/api`
- Enables routing messages between teams on different branches

## Advanced Worktree Patterns

### Pattern 1: Ephemeral Review Worktrees

**Concept:** Automatically create and destroy worktrees for PR reviews.

```typescript
// In tools/teams-review-pr.ts
export async function reviewPR(prNumber: number): Promise<string> {
  const mainRepo = process.cwd();
  const reviewPath = `/tmp/iris-review-${prNumber}`;

  // Create temporary worktree
  await WorktreeManager.createWorktree(
    mainRepo,
    `pr/${prNumber}`,
    reviewPath
  );

  // Spawn review team in worktree
  const reviewTeam = await pool.getOrCreateProcess("review-team");

  // Ask review team to analyze PR
  const analysis = await reviewTeam.sendMessage(
    `Review PR #${prNumber}. Focus on security, performance, and test coverage.`
  );

  // Cleanup worktree after review
  await WorktreeManager.removeWorktree(reviewPath);

  return analysis;
}
```

### Pattern 2: Branch-Based Team Routing

**Concept:** Route messages based on branch ownership.

```typescript
// teams.json with branch mapping
{
  "teams": {
    "auth-team": {
      "path": "/path/to/worktree-auth",
      "branches": ["feature/auth-*", "fix/auth-*"]
    },
    "api-team": {
      "path": "/path/to/worktree-api",
      "branches": ["feature/api-*", "fix/api-*"]
    }
  }
}

// Intelligent routing
async function routeQuestion(question: string): Promise<string> {
  // Determine which files/modules are referenced
  const mentionedFiles = extractFilePaths(question);

  // Find which branch owns those files
  const branch = findBranchForFiles(mentionedFiles);

  // Find team responsible for that branch
  const team = findTeamForBranch(branch);

  // Route question to appropriate team
  return await teams_ask(team, question);
}
```

### Pattern 3: Merge Conflict Resolution Teams

**Concept:** Dedicated team for resolving merge conflicts.

```bash
# Create conflict resolution worktree
git worktree add ../iris-merge-conflicts feature/complex-merge

cd ../iris-merge-conflicts
git merge main  # Triggers conflicts
```

```typescript
// Spawn conflict resolution team
const conflictTeam = await pool.getOrCreateProcess("conflict-resolver");

// Ask team to resolve conflicts
const resolution = await conflictTeam.sendMessage(`
  We have merge conflicts in the following files:
  - src/process-pool/pool-manager.ts
  - src/session/session-manager.ts

  Please analyze both versions and propose a resolution strategy.
`);
```

## Benefits for Iris MCP

### 1. **True Parallel Execution**
- Multiple Claude instances working simultaneously
- No blocking on git operations
- Fully isolated file systems per team

### 2. **Branch Isolation**
- Teams can't accidentally interfere with each other's branches
- Experimental features developed in isolation
- Safe rollback without affecting other teams

### 3. **Enhanced Testing**
- Run test suites in parallel across multiple worktrees
- Test different configurations simultaneously
- CI pipeline parallelization

### 4. **Reduced Context Switching**
- No need to `git checkout` between branches
- Each team maintains persistent environment
- Faster response times (no rebuild needed)

### 5. **Improved Session Management**
- Session history isolated per worktree
- No context pollution between branches
- Clear separation of concerns

### 6. **Monorepo Benefits**
- Different teams working on different packages
- Package-specific sessions and context
- Coordinated releases via inter-team communication

## Limitations and Considerations

### 1. **Disk Space**
Working directories are duplicated (though `.git` is shared):

```bash
# Main repo: 500MB
# Each worktree: ~400MB (duplicated working files)
# 5 worktrees = ~2.5GB disk usage

# Shared .git remains single copy (~100MB)
```

**Mitigation:**
- Use ephemeral worktrees for temporary tasks
- Clean up unused worktrees regularly
- Consider using sparse checkouts for large repos

### 2. **Cognitive Overhead**
Managing multiple worktrees requires understanding:
- Which team is in which worktree
- Current branch per worktree
- How to route messages between worktrees

**Mitigation:**
- Dashboard showing worktree status
- Automatic team discovery from worktrees
- Clear naming conventions

### 3. **Build Tool Complications**
Some build tools may struggle with multiple simultaneous builds:
- Port conflicts (dev servers)
- Lock file conflicts (npm/pnpm)
- Cache invalidation issues

**Mitigation:**
- Configure unique ports per worktree
- Use separate `node_modules` per worktree
- Implement build coordination via Iris MCP

### 4. **Git Operations**
Certain git operations affect all worktrees:
- `git fetch` updates refs for all worktrees
- Can't check out same branch in multiple worktrees
- Deleting branches requires coordination

**Mitigation:**
- Use unique branch names per worktree
- Implement WorktreeManager to coordinate operations
- Document worktree ownership in teams.json

## Implementation Roadmap

### Phase 1: Detection and Reporting
- [ ] Detect if team path is a worktree
- [ ] Report worktree info in `teams_get_status`
- [ ] Add worktree metadata to process status
- [ ] Document current branch per team

### Phase 2: Worktree Management
- [ ] Implement WorktreeManager class
- [ ] Add `teams_create_worktree` MCP tool
- [ ] Add `teams_remove_worktree` MCP tool
- [ ] Add `teams_list_worktrees` MCP tool

### Phase 3: Advanced Routing
- [ ] Branch-based team routing
- [ ] Automatic team discovery from worktrees
- [ ] Worktree status in dashboard (Phase 2 web UI)
- [ ] Conflict resolution workflows

### Phase 4: Intelligence Layer Integration (Phase 5)
- [ ] Autonomous worktree creation for tasks
- [ ] Smart branch assignment based on task type
- [ ] Automatic cleanup of ephemeral worktrees
- [ ] Meta-cognitive worktree orchestration

## Example Use Cases

### Use Case 1: Feature Branch Coordination

```typescript
// Create worktrees for new feature
const featureTeams = await createFeatureWorktrees("payment-integration", [
  { team: "frontend", branch: "feature/payment-ui" },
  { team: "backend", branch: "feature/payment-api" },
  { team: "testing", branch: "feature/payment-tests" }
]);

// Kick off parallel development
await Promise.all([
  teams_send_message("frontend", "Implement payment form UI"),
  teams_send_message("backend", "Create Stripe integration API"),
  teams_send_message("testing", "Write E2E payment flow tests")
]);

// Coordinate between teams
await teams_send_message(
  "backend",
  "Ask frontend team what payment methods they need supported"
);
```

### Use Case 2: Release Management

```typescript
// Create release worktree
await createWorktree("main", "../iris-mcp-release", "release/v2.0");

// Release team coordinates all activities
const releaseTeam = await pool.getOrCreateProcess("release-team");

await releaseTeam.sendMessage(`
  Coordinate v2.0 release:
  1. Update CHANGELOG.md
  2. Bump package.json version
  3. Run full test suite
  4. Ask all teams for approval
  5. Create git tag
  6. Publish to npm
`);
```

### Use Case 3: Hotfix Workflow

```typescript
// Critical bug in production
const hotfixWorktree = await createWorktree(
  "main",
  "../iris-mcp-hotfix",
  "hotfix/session-leak"
);

// Spawn dedicated hotfix team
const hotfixTeam = await pool.getOrCreateProcess("hotfix-team");

// Isolate hotfix work from main development
await hotfixTeam.sendMessage(`
  Critical: Session memory leak in production.
  1. Reproduce issue in this worktree
  2. Identify root cause
  3. Implement minimal fix
  4. Run regression tests
  5. Notify release team when ready
`);

// Main development continues uninterrupted in main worktree
```

## Conclusion

Git worktrees provide a powerful foundation for parallel Claude Code sessions in Iris MCP. By combining worktrees with Iris's team coordination capabilities, we enable:

- **True concurrent development** across multiple branches
- **Isolated experimentation** without affecting main development
- **Efficient resource usage** (shared git database)
- **Enhanced session management** (one session per worktree)
- **Scalable team coordination** (branch-based routing)

The worktree pattern aligns perfectly with Iris MCP's vision of autonomous, coordinated Claude instances working together across complex, multi-context software projects.

**Next Steps:**
1. Implement WorktreeManager in Phase 2 (Dashboard phase)
2. Add worktree-aware routing to process pool
3. Extend MCP tools to support worktree operations
4. Document best practices for worktree workflows

---

**Related Documentation:**
- [SESSION.md](./SESSION.md) - Session management architecture
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system design
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
