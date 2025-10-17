# Documentation Changelog

All notable documentation maintenance activities performed by the tech-writer agent.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Note:** Current date/time for changelog entries can be obtained using the `iris-mcp team-date` action.

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

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