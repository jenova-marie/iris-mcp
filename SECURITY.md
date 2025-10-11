# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The Iris MCP team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via:

1. **GitHub Security Advisories**: Use the [Security Advisory](https://github.com/jenova-marie/iris-mcp/security/advisories/new) feature
2. **Email**: Send details to the project maintainer (check package.json for contact)

### What to Include

To help us better understand and resolve the issue, please include:

- Type of issue (e.g., buffer overflow, SQL injection, path traversal, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix & Disclosure**: Coordinated with reporter

## Security Considerations

### Configuration Security

**teams.json file**: Contains absolute paths to your projects. Ensure this file:
- Is not committed to version control (already in .gitignore)
- Has appropriate file permissions (read/write for owner only)
- Does not contain sensitive credentials

**skipPermissions flag**: When set to `true`, Claude automatically approves file operations. Use with caution:
- Only enable for trusted, non-production environments
- Understand that Claude can read/write files without confirmation
- Consider security implications for your specific use case

### Input Validation

Iris MCP implements multiple layers of security:

1. **Team Name Validation**: Prevents path traversal attacks
2. **Message Sanitization**: Removes null bytes, limits message length
3. **Timeout Bounds**: Prevents resource exhaustion
4. **Configuration Schema Validation**: Zod validates all config inputs

### Process Isolation

Each Claude process:
- Runs in its own project directory
- Has its own session context
- Cannot access other team's processes directly
- Communicates only through the MCP protocol

### Network Security

Phase 1 (current):
- No network endpoints exposed
- Stdio-based MCP communication only
- Local-only operation

Future phases (2-4) will include:
- HTTP/WebSocket APIs (Phase 3)
- Authentication & authorization
- Rate limiting
- CORS policies

## Known Limitations

### Current Phase 1 Limitations

1. **SQLite Database**: Session and notification databases are not encrypted
2. **Session Files**: Stored in plaintext at `~/.claude/projects/`
3. **Process Memory**: Claude processes may hold sensitive code in memory
4. **Log Files**: Logs may contain file paths and team names

### Recommendations

- Run Iris MCP on a trusted, secured system
- Use filesystem encryption for sensitive projects
- Regularly review session files for sensitive data
- Monitor process logs for suspicious activity
- Keep Node.js and dependencies updated

## Security Updates

Security updates will be:
1. Released as patch versions (e.g., 1.0.1)
2. Documented in CHANGELOG.md
3. Announced via GitHub Security Advisories
4. Published to npm immediately

## Attribution

We will credit security researchers in:
- Release notes (with permission)
- Security advisories
- CHANGELOG.md

Thank you for helping keep Iris MCP and its users safe!
