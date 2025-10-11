# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub Actions CI/CD workflows
- npm publishing configuration
- OSS project documentation (CONTRIBUTING.md, LICENSE, etc.)
- Issue and PR templates
- Status badges in README

## [1.0.0] - 2025-01-15

### Added
- Core MCP server implementation with cross-project coordination
- Process pool management with LRU eviction
- Session persistence with SQLite database
- Notification queue system
- Four MCP tools: `teams_ask`, `teams_send_message`, `teams_notify`, `teams_get_status`
- Configuration system with hot-reload support
- Health monitoring for Claude processes
- Event-driven architecture for future Intelligence Layer
- Comprehensive test suite (unit + integration tests)
- Structured JSON logging to stderr
- Custom error hierarchy with status codes
- Security-focused input validation

### Performance
- 52%+ faster responses with process pooling
- 85% faster test suite with `beforeAll` optimization
- Warm starts: 500ms-2s (vs 8-14s cold starts)

### Documentation
- Complete README with installation and usage instructions
- Architecture documentation (ARCHITECTURE.md, SESSION.md, CLAUDE.md, POOL.md)
- Breaking changes guide
- API documentation for all MCP tools

### Infrastructure
- TypeScript with strict mode
- Vitest for testing
- Better-sqlite3 for data persistence
- Zod for configuration validation
- Express, React, Socket.io (for future phases)

## [0.1.0] - 2024-12-15

### Added
- Initial proof of concept
- Basic process spawning
- Simple message passing between teams

---

## Release Notes Format

### Added
New features and capabilities

### Changed
Changes in existing functionality

### Deprecated
Soon-to-be removed features

### Removed
Removed features

### Fixed
Bug fixes

### Security
Security improvements and vulnerability fixes

### Performance
Performance improvements

[Unreleased]: https://github.com/jenova-marie/iris-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jenova-marie/iris-mcp/releases/tag/v1.0.0
[0.1.0]: https://github.com/jenova-marie/iris-mcp/releases/tag/v0.1.0
