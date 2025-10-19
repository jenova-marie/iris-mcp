# Documentation Changelog

All notable documentation maintenance activities performed by the tech-writer agent.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Note:** Current date/time for changelog entries can be obtained using the `iris-mcp team-date` action.

## [Unreleased]

### Added
### Changed
- **14 Documentation Files**: Updated all remaining documentation files with new MCP tool names (v3.0)
  - NOMENCLATURE.md: Rewrote MCP Tools section (17 tools with new names)
  - MCP_TOOLS.md: Verified already updated with new names
  - FEATURES.md: Updated MCP Tools section and tool count (15→17 tools)
  - ARCHITECTURE.md: Updated Tool Registration section and flow diagrams
  - REVERSE_MCP.md: Updated all usage examples and approval policies
  - PERMISSIONS.md: Updated troubleshooting section (team_isAwake → team_status)
  - REMOTE.md: Updated MCP Tool Integration section and implementation checklists
  - REVERSE_MCP_IMPLEMENTATION_PLAN.md: Updated all code examples, checklists, and functional requirements
  - API_IMPLEMENTATION_PLAN.md: Rewrote complete endpoint mapping table (expanded from 10 to 16 tools)
  - REVERSE_MCP_SECURITY.md: Updated security policy examples and audit logs
  - OBSERVABILITY.md: Updated status observable flow examples
  - ENV_VARS.md: Updated forked sessions troubleshooting section
  - PRINT.md: Marked Phase 2 (team_compact) as removed/not implemented
  - future/CLAUDE_APPROVE.md: Updated all permission approval examples
  - All files: Added/updated Tech Writer Notes documenting changes and cross-references

  Tool name changes applied:
  - team_tell → send_message, ask_message
  - team_quick_tell → quick_message
  - team_isAwake → team_status
  - team_report → session_report
  - team_teams → list_teams
  - team_debug → get_logs
  - team_cancel → session_cancel
  - team_delete → session_delete
  - team_clear/team_reboot → session_reboot
  - team_fork → session_fork
  - team_compact → REMOVED (incomplete implementation)

  Added semantic aliases:
  - ask_message (semantic alias for send_message)
  - team_launch (semantic alias for team_wake)

  Added new tools:
  - get_date

### Deprecated
### Removed
### Fixed
### Security

## [2025-10-18] - MCP Tool Renaming & Session MCP Configuration

### Changed
- **ACTIONS.md**: Complete rewrite (v3.0) to reflect all MCP tool renames
  - Renamed tools: team_tell → send_message, team_quick_tell → quick_message, team_reboot → session_reboot, team_delete → session_delete, team_fork → session_fork, team_isAwake → team_status, team_report → session_report, team_teams → list_teams, team_debug → get_logs, team_cancel → session_cancel
  - Added semantic aliases: ask_message (for send_message), team_launch (for team_wake)
  - Added get_date tool documentation
  - Removed team_compact (incomplete implementation)
  - Updated all code examples, signatures, and usage patterns with new tool names
  - Updated tool catalog table with 17 tools (including new aliases)
  - Updated Tool Registration section to show new case statements
  - Updated all usage examples (cross-team review, deployment, async processing, debugging)
  - Updated Tech Writer Notes with new tool names and comprehensive keywords
- **COMPACT_IMPLEMENTATION.md**: Added deprecation notice at document start
  - Noted that compact.ts implementation has been removed as incomplete
  - Noted that team_compact tool registration is commented out in src/mcp_server.ts
  - Preserved document as reference for future implementation
  - Updated status from "Design Phase" to "Not Implemented (Design Phase)"
  - Added removal date (2025-10-18)
- **CONFIG.md**: Session MCP configuration documentation (from previous commit, included for completeness)
  - Added sessionMcpEnabled and sessionMcpPath configuration fields
  - Added comprehensive "Session MCP Configuration" section before "Permission Approval System"
  - Included global vs team-level configuration examples
  - Added file location examples for local and remote teams
  - Documented custom script interface changes
  - Added security considerations and troubleshooting guide
  - Updated Tech Writer Notes with sessionMcp keywords and cross-references

### Added
- None (documentation updates only)

### Fixed
- ACTIONS.md: Fixed all tool names to match actual implementation in src/mcp_server.ts
- ACTIONS.md: Removed references to non-existent team_compact tool
- COMPACT_IMPLEMENTATION.md: Added clear notice that implementation has been removed to prevent confusion

**Trigger**: Git commit session implementing session MCP configuration (sessionMcpEnabled, sessionMcpPath) and renaming MCP tools for semantic clarity (9 commits total, 10 src/ files modified)
**Files**: 3 documentation files updated (1 complete rewrite, 2 targeted updates)
**Key Topics**: MCP tool renaming, send_message, ask_message, quick_message, session_reboot, session_delete, session_fork, session_cancel, team_status, session_report, list_teams, get_logs, get_date, team_launch semantic alias, team_compact removal, session MCP configuration, sessionMcpEnabled, sessionMcpPath, mcp-config-writer updates

## [2025-10-17] - Permission Approval & Dashboard Enhancements

### Changed
- **PERMISSIONS.md**: Updated "ask" mode status from planned to ✅ fully implemented with dashboard UI
  - Added implementation details for PendingPermissionsManager with Promise-based blocking
  - Documented WebSocket event flow (permission:request, permission:resolved, permission:timeout)
  - Added Permission Approval Modal component documentation with timeout handling
  - Changed default permission mode from "yes" to "ask" for safer defaults
  - Added cross-references to DASHBOARD.md for UI details
- **DASHBOARD.md**: Added three major new feature sections
  - Permission Approval System section with real-time modal approval workflow
  - Log Viewer page documentation with wonder-logger streaming integration
  - Debug Info Display section for launch command and team config inspection
  - Updated WebSocket Events with permission and log events (server→client and client→server)
  - Added PermissionApprovalModal.tsx and LogViewer.tsx component documentation
  - Updated useWebSocket hook with callback refs pattern and new methods
  - Updated project structure to include new components and pages
  - Added /logs route to navigation and updated key capabilities list
- **SESSION.md**: Added debug info fields to database schema and API
  - Added launch_command and team_config_snapshot columns to team_sessions table
  - Updated schema migration code to include new debug info fields
  - Added updateDebugInfo() method to SessionManager and SessionStore APIs
  - Updated SessionInfo interface with launchCommand and teamConfigSnapshot nullable fields
  - Incremented document version from 1.0 to 1.1
- **FEATURES.md**: Updated permission approval implementation status
  - Changed "schema-only, implementation pending" to ✅ fully implemented
  - Added Permission Approval System, Log Viewer, and Debug Info Display subsections to Dashboard features
  - Updated UI Features to include /logs route, global modals, and WebSocket hooks
  - Updated Team Management to show grantPermission as implemented
  - Updated Tech Writer Notes with new cross-references to PERMISSIONS.md and DASHBOARD.md

### Added
- **PERMISSIONS.md**: Tech Writer Notes section documenting coverage areas and keywords
- **DASHBOARD.md**: Tech Writer Notes section with comprehensive coverage documentation
- **SESSION.md**: Tech Writer Notes section for session management topics
- All files: Cross-references between related documentation files for better navigation

**Trigger**: Git commit session implementing permission approval system, log viewer, and debug info features in dashboard (7 commits total, 23 src/ files modified)
**Files**: 4 documentation files updated with 200+ lines of new content
**Key Topics**: Permission approval, dashboard WebSocket integration, log streaming, debug info, PendingPermissionsManager, PermissionApprovalModal, LogViewer

## Initial Release
- Documentation changelog initialized for tech-writer agent maintenance tracking