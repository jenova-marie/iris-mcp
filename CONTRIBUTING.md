# Contributing to Iris MCP

First off, thank you for considering contributing to Iris MCP! It's people like you that make Iris MCP such a great tool for the Claude Code community.

## Code of Conduct

This project and everyone participating in it is governed by the [Iris MCP Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps which reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include logs if relevant** (check stderr output)
- **Include your teams.json configuration** (sanitized)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and explain which behavior you expected to see instead**
- **Explain why this enhancement would be useful**

### Your First Code Contribution

Unsure where to begin contributing? You can start by looking through these issues:

- Issues labeled `good first issue` - issues which should only require a few lines of code
- Issues labeled `help wanted` - issues which need extra attention

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes (`pnpm test`)
5. Make sure your code follows the existing style
6. Issue that pull request!

## Development Process

### Setup

```bash
# Clone your fork
git clone https://github.com/your-username/iris-mcp
cd iris-mcp

# Install dependencies
pnpm install

# Create a teams.json from the example
cp src/config/teams.example.json teams.json
# Edit teams.json with your project paths

# Build the project
pnpm build

# Run tests
pnpm test
```

### Project Structure

```
iris-mcp/
├── src/                  # Source code
│   ├── index.ts         # MCP server entry point
│   ├── iris.ts          # Business logic orchestrator
│   ├── config/          # Configuration management
│   ├── process-pool/    # Process pool management
│   ├── session/         # Session management
│   ├── tools/           # MCP tool implementations
│   └── utils/           # Utility functions
├── tests/               # Test files
│   ├── unit/           # Unit tests
│   └── integration/    # Integration tests
├── docs/               # Documentation
└── dist/              # Built files (gitignored)
```

### Testing

We use Vitest for testing. Tests are divided into:

- **Unit tests** (`tests/unit/`) - Fast, isolated tests
- **Integration tests** (`tests/integration/`) - Tests that spawn real processes

```bash
# Run all tests
pnpm test

# Run only unit tests
pnpm test:unit

# Run only integration tests
pnpm test:integration

# Run tests in watch mode
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

### Code Style

- We use TypeScript with strict mode enabled
- Follow existing code conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line
- Consider starting the commit message with an applicable emoji:
  - 🎨 `:art:` - Improving structure/format of the code
  - ⚡ `:zap:` - Improving performance
  - 🔥 `:fire:` - Removing code or files
  - 🐛 `:bug:` - Fixing a bug
  - 🚑 `:ambulance:` - Critical hotfix
  - ✨ `:sparkles:` - Introducing new features
  - 📝 `:memo:` - Writing docs
  - 🚀 `:rocket:` - Deploying stuff
  - 💄 `:lipstick:` - Updating the UI and style files
  - 🎉 `:tada:` - Initial commit
  - ✅ `:white_check_mark:` - Adding tests
  - 🔒 `:lock:` - Fixing security issues
  - 🔖 `:bookmark:` - Releasing/Version tags
  - 🚨 `:rotating_light:` - Removing linter warnings
  - 🚧 `:construction:` - Work in progress
  - ⬆️ `:arrow_up:` - Upgrading dependencies
  - 👷 `:construction_worker:` - Adding CI build system
  - 📈 `:chart_with_upwards_trend:` - Adding analytics or tracking code
  - ♻️ `:recycle:` - Refactoring code
  - 🐳 `:whale:` - Work about Docker
  - ➕ `:heavy_plus_sign:` - Adding a dependency
  - ➖ `:heavy_minus_sign:` - Removing a dependency
  - 🔧 `:wrench:` - Changing configuration files

### Documentation

- Update README.md with any new features or changes
- Add JSDoc comments to new functions/classes
- Update the architectural docs if you change core components
- Include examples in your documentation

## Architecture Decisions

Iris MCP follows a five-phase architecture plan:

1. **Phase 1 (Current)**: Core MCP server with process pooling
2. **Phase 2**: Web dashboard for monitoring
3. **Phase 3**: HTTP/WebSocket API
4. **Phase 4**: CLI interface
5. **Phase 5**: Intelligence layer

When contributing, consider which phase your contribution targets and ensure it aligns with the overall architecture.

## Financial Contributions

We don't currently accept financial contributions, but you can support the project by:

- Starring the repository
- Sharing it with others
- Contributing code or documentation
- Reporting bugs and suggesting features

## Questions?

Feel free to open an issue with the label `question` if you need help or clarification.

Thank you for contributing to Iris MCP! 🌈