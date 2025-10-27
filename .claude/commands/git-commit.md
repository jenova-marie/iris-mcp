# Git Commit Command for Codex7

Create well-organized, properly attributed git commits for the Codex7 project.

## Instructions

You are helping create git commits for the Codex7 monorepo. Follow these guidelines:

### Commit Organization

1. **Group related changes logically** - Don't commit everything at once
   - Documentation changes together
   - Infrastructure/config changes together
   - Feature implementation by package
   - Tests with the code they test
   - Bug fixes isolated from features

2. **Commit frequently** - Smaller, focused commits are better than large ones
   - Each commit should represent one logical change
   - Commits should be atomic (can be reverted independently)
   - Prefer multiple small commits over one large commit

### Commit Message Format

Use conventional commit format with emojis:

```
<emoji> <type>(<scope>): <subject>

<body>

<footer>
```

#### Emoji Prefixes

- ✨ `feat:` - New features
- 🐛 `fix:` - Bug fixes
- 📝 `docs:` - Documentation only
- 🎨 `style:` - Code style/formatting (no logic change)
- ♻️ `refactor:` - Code refactoring
- 🧪 `test:` - Adding or updating tests
- 🔥 `perf:` - Performance improvements
- 🏗️ `chore:` - Build process, tooling, dependencies
- 🔒 `security:` - Security improvements
- 🐳 `docker:` - Docker-related changes
- 📦 `deps:` - Dependency updates
- 🚀 `deploy:` - Deployment configuration
- 🔧 `config:` - Configuration changes

#### Scopes (optional but encouraged)

- `shared` - @codex7/shared package
- `mcp-server` - @codex7/mcp-server package
- `api` - @codex7/api package
- `web` - @codex7/web package
- `indexer` - @codex7/indexer package
- `storage-postgres` - @codex7/storage-postgres package
- `storage-sqlite` - @codex7/storage-sqlite package
- `storage-qdrant` - @codex7/storage-qdrant package
- `monorepo` - Root-level monorepo changes
- `ci` - CI/CD workflows
- `docker` - Docker configurations

#### Subject Line

- Use imperative mood ("add" not "added" or "adds")
- Don't capitalize first letter after type
- No period at the end
- Keep under 72 characters
- Be descriptive but concise

#### Body

- Separate from subject with blank line
- Use bullet points (- or •) for multiple changes
- Explain WHAT and WHY, not HOW
- Wrap at 72 characters
- Include motivation and context
- Reference issues/PRs if applicable

#### Footer

Always include:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

### Git Configuration

Use the currently configured git user settings:
- **Name**: Retrieved from `git config user.name`
- **Email**: Retrieved from `git config user.email`

The commit author will be the configured git user, with co-authorship attributed to both Claude and Jenova Marie.

### Examples

#### Feature Implementation

```
✨ feat(mcp-server): implement resolve-library-id tool

Add MCP tool for resolving library names to Context7-compatible IDs:

- Parse library name with fuzzy matching
- Query database for matching libraries
- Return ranked results with trust scores
- Include metadata (repository URL, description, versions)
- Full error handling with Result types

Implements Context7 API compatibility while adding extensions
for better search ranking and metadata.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

#### Bug Fix

```
🐛 fix(storage-postgres): correct vector similarity search ordering

Fix issue where search results were returned in ascending order
instead of descending (highest similarity first).

- Change ORDER BY clause from ASC to DESC
- Add regression test to prevent future issues
- Update search result validation

Fixes #42

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

#### Documentation

```
📝 docs: add API endpoint documentation

Add comprehensive REST API documentation:

- Endpoint descriptions with request/response examples
- Authentication requirements
- Rate limiting details
- Error response formats
- cURL examples for all endpoints

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

#### Test Addition

```
🧪 test(indexer): add integration tests for GitHub scraper

Add comprehensive integration tests for GitHub repository scraping:

- Test successful repo fetch with mock GitHub API
- Test rate limit handling and backoff
- Test error cases (404, auth failures, network errors)
- Test markdown file discovery and parsing
- Mock external dependencies for reliable testing

Achieves 95% coverage for GitHub scraper module.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

#### Refactoring

```
♻️ refactor(shared): extract error factories to separate module

Reorganize error handling utilities for better maintainability:

- Move error factory functions to errors/factories.ts
- Group by domain (storage, indexer, api, mcp)
- Add type exports for each error category
- Update imports across all packages
- No functional changes, pure code organization

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

#### Dependency Update

```
📦 deps: upgrade TypeScript to 5.4.2

Update TypeScript to latest stable version:

- Upgrade from 5.3.3 to 5.4.2
- Update @typescript-eslint packages to match
- Fix new type errors from stricter checking
- All tests pass with new version

Benefits improved type inference and performance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

### Workflow

1. **Check status** - Run `git status` to see what's changed
2. **Review diff** - Run `git diff` to review actual changes
3. **Stage selectively** - Use `git add <files>` to stage related changes
4. **Commit with message** - Use heredoc format for multi-line messages:

```bash
git commit -m "$(cat <<'EOF'
✨ feat(scope): subject line

- Bullet point describing change
- Another change in this commit
- Why this change was made

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
EOF
)"
```

5. **Verify commit** - Run `git log -1 --pretty=fuller` to verify
6. **Push when ready** - `git push` or `git push -u origin <branch>`

### Special Cases

#### Breaking Changes

Add `BREAKING CHANGE:` in the footer:

```
✨ feat(api): redesign search endpoint response format

Change search endpoint to return paginated results:

- Add pagination metadata (page, total, hasMore)
- Nest results in 'data' field
- Include performance metrics in response

BREAKING CHANGE: Response format changed from flat array to object with
pagination. Clients must update to access results via response.data instead
of response directly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
```

#### Multiple Co-Authors

If other contributors are involved, add additional Co-Authored-By lines:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Jenova Marie <jenova-marie@pm.me>
Co-Authored-By: Other Contributor <email@example.com>
```

### Quality Checklist

Before committing, ensure:

- [ ] Changes are logically grouped
- [ ] Commit message is clear and descriptive
- [ ] Body explains WHY, not just WHAT
- [ ] Tests are included (if applicable)
- [ ] Documentation is updated (if applicable)
- [ ] No debugging code or console.logs
- [ ] No commented-out code
- [ ] Linting passes
- [ ] Co-authorship attribution is correct

### Additional Tips

- **Atomic commits** - Each commit should work independently
- **Tell a story** - Commit history should read like a project narrative
- **Future-proof** - Write messages for someone reading in 6 months
- **Be proud** - Commits represent your work; make them shine! ✨

---

**Remember**: Good commit messages are love letters to your future self and teammates! 💜

---

## ⚠️ CRITICAL CONSTRAINT ⚠️

**AFTER COMPLETING THE GIT COMMIT WORKFLOW DESCRIBED ABOVE:**

🚨 **YOU ARE NOT TO EXECUTE ANY SUBSEQUENT GIT COMMIT OR PUSH COMMANDS. MY PERMISSION HAS BEEN REVOKED.** 🚨

This command (`/git-commit`) grants temporary permission to create git commits following the workflow above. Once you've completed the requested commit(s), **that permission expires**.

**DO NOT:**
- ❌ Create additional "cleanup" commits
- ❌ Push to remote without explicit new permission
- ❌ Make commits in response to other user requests
- ❌ Proactively commit changes you've made

**To commit again:**
- ✅ User must explicitly invoke `/git-commit` again (which grants new permission)

If changes need to be committed, **ASK THE USER** if they want you to run `/git-commit` again.

💜 This keeps the user in full control of their git history and remote repository state.
