#!/usr/bin/env bash
#
# mcp-scp.sh - Write MCP config file to remote host via SCP
#
# Usage: echo '{"mcpServers": {...}}' | mcp-scp.sh <sessionId> <ssh-host> <remote-team-path>
#
# Reads MCP config JSON from stdin, writes to local temp file, SCPs to remote host,
# outputs the remote file path to stdout, then cleans up local temp file.
#
# Destination: <remote-team-path>/.claude/iris/mcp/iris-mcp-<sessionId>.json
#

set -euo pipefail

# Get required arguments
SESSION_ID="${1:-}"
SSH_HOST="${2:-}"
REMOTE_TEAM_PATH="${3:-}"

if [ -z "$SESSION_ID" ] || [ -z "$SSH_HOST" ] || [ -z "$REMOTE_TEAM_PATH" ]; then
  echo "ERROR: Session ID, SSH host, and remote team path required" >&2
  echo "Usage: $0 <sessionId> <ssh-host> <remote-team-path>" >&2
  exit 1
fi

# Build remote MCP directory path
REMOTE_MCP_DIR="${REMOTE_TEAM_PATH}/.claude/iris/mcp"

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
