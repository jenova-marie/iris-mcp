#!/usr/bin/env bash
#
# mcp-cp.sh - Write MCP config file locally
#
# Usage: echo '{"mcpServers": {...}}' | mcp-cp.sh <sessionId> <team-path>
#
# Reads MCP config JSON from stdin, writes to file, outputs the file path to stdout.
# Destination: <team-path>/.claude/iris/mcp/iris-mcp-<sessionId>.json
#

set -euo pipefail

# Get session ID from first argument
SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Session ID required" >&2
  echo "Usage: $0 <sessionId> <team-path>" >&2
  exit 1
fi

# Get team path from second argument
TEAM_PATH="${2:-}"
if [ -z "$TEAM_PATH" ]; then
  echo "ERROR: Team path required" >&2
  echo "Usage: $0 <sessionId> <team-path>" >&2
  exit 1
fi

# Build destination directory path
MCP_DIR="${TEAM_PATH}/.claude/iris/mcp"

# Create directory if it doesn't exist
mkdir -p "$MCP_DIR"
chmod 700 "$MCP_DIR"

# Build file path
FILE_PATH="${MCP_DIR}/iris-mcp-${SESSION_ID}.json"

# Read JSON from stdin and write to file
cat > "$FILE_PATH"

# Set permissions (readable only by owner)
chmod 600 "$FILE_PATH"

# Output the file path to stdout (transport will read this)
echo "$FILE_PATH"
