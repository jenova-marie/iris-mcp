#!/usr/bin/env bash
#
# mcp-scp.sh - Write MCP config file to remote host via SCP
#
# Usage: echo '{"mcpServers": {...}}' | mcp-scp.sh <sessionId> <ssh-host> <remote-team-path> [sessionMcpPath]
#
# Reads MCP config JSON from stdin, writes to local temp file, SCPs to remote host,
# outputs the remote file path to stdout, then cleans up local temp file.
#
# Destination: <remote-team-path>/<sessionMcpPath>/iris-mcp-<sessionId>.json
# Default sessionMcpPath: .claude/iris/mcp
#

set -euo pipefail

# Get required arguments
SESSION_ID="${1:-}"
SSH_HOST="${2:-}"
REMOTE_TEAM_PATH="${3:-}"

if [ -z "$SESSION_ID" ] || [ -z "$SSH_HOST" ] || [ -z "$REMOTE_TEAM_PATH" ]; then
  echo "ERROR: Session ID, SSH host, and remote team path required" >&2
  echo "Usage: $0 <sessionId> <ssh-host> <remote-team-path> [sessionMcpPath]" >&2
  exit 1
fi

# Get MCP directory path from fourth argument (default: .claude/iris/mcp)
MCP_DIR_PATH="${4:-.claude/iris/mcp}"

# Build remote MCP directory path
REMOTE_MCP_DIR="${REMOTE_TEAM_PATH}/${MCP_DIR_PATH}"

# Create local temp file
LOCAL_TEMP=$(mktemp /tmp/iris-mcp-XXXXXX.json)
trap "rm -f '$LOCAL_TEMP'" EXIT

# Read JSON from stdin and write to local temp file
cat > "$LOCAL_TEMP"

# Ensure remote MCP directory exists
ssh "$SSH_HOST" "mkdir -p '$REMOTE_MCP_DIR' && chmod 700 '$REMOTE_MCP_DIR'"

# Build remote file path
REMOTE_FILE="${REMOTE_MCP_DIR}/iris-mcp-${SESSION_ID}.json"

# SCP file to remote host
scp -q "$LOCAL_TEMP" "${SSH_HOST}:${REMOTE_FILE}"

# Set remote file permissions (readable only by owner)
ssh "$SSH_HOST" "chmod 600 '$REMOTE_FILE'"

# Output the remote file path to stdout (transport will read this)
echo "$REMOTE_FILE"

# Cleanup happens automatically via trap
