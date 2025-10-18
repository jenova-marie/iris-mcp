#!/usr/bin/env bash
#
# mcp-cp.sh - Write MCP config file locally
#
# Usage: echo '{"mcpServers": {...}}' | mcp-cp.sh <sessionId> [destination-dir]
#
# Reads MCP config JSON from stdin, writes to file, outputs the file path to stdout.
# Default destination: /tmp/iris-mcp-<sessionId>.json
#

set -euo pipefail

# Get session ID from first argument
SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Session ID required" >&2
  echo "Usage: $0 <sessionId> [destination-dir]" >&2
  exit 1
fi

# Get destination directory (default: /tmp)
DEST_DIR="${2:-/tmp}"

# Build file path
FILE_PATH="${DEST_DIR}/iris-mcp-${SESSION_ID}.json"

# Read JSON from stdin and write to file
cat > "$FILE_PATH"

# Set permissions (readable only by owner)
chmod 600 "$FILE_PATH"

# Output the file path to stdout (transport will read this)
echo "$FILE_PATH"
