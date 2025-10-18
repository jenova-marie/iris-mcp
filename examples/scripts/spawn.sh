#!/bin/bash
# Iris MCP Fork Script - Opens new terminal with Claude session
# For local teams: spawn.sh <teamPath> <fullClaudeCommand>
# For remote teams: spawn.sh <teamPath> <fullClaudeCommand> <sshHost> [sshOptions]
#
# Copy this to ~/.iris/spawn.sh and make it executable:
#   cp examples/scripts/spawn.sh ~/.iris/spawn.sh
#   chmod +x ~/.iris/spawn.sh
#
# Arguments:
# $1 = teamPath (required - project directory path)
# $2 = fullClaudeCommand (required - complete Claude CLI command with all args including --fork-session)
# $3 = sshHost (optional - if provided, will SSH to remote)
# $4 = sshOptions (optional - SSH options like "-J jumphost")

TEAM_PATH="$1"
FULL_CLAUDE_CMD="$2"
SSH_HOST="$3"
SSH_OPTIONS="$4"

if [ -z "$TEAM_PATH" ] || [ -z "$FULL_CLAUDE_CMD" ]; then
    echo "Error: teamPath and fullClaudeCommand are required"
    echo "Usage: $0 <teamPath> <fullClaudeCommand> [sshHost] [sshOptions]"
    exit 1
fi

if [ -z "$SSH_HOST" ]; then
    # Local fork - no SSH host provided
    echo "Forking local session in $TEAM_PATH"

    # iTerm2 AppleScript to open new window and run claude command
    osascript <<EOF
tell application "iTerm2"
    activate
    create window with default profile
    tell current session of current window
        write text "cd \"$TEAM_PATH\" && $FULL_CLAUDE_CMD"
    end tell
end tell
EOF

else
    # Remote fork - SSH to remote host
    echo "Forking remote session on $SSH_HOST in $TEAM_PATH"

    # Build SSH command with optional options
    if [ -n "$SSH_OPTIONS" ]; then
        SSH_CMD="ssh -t $SSH_OPTIONS $SSH_HOST"
    else
        SSH_CMD="ssh -t $SSH_HOST"
    fi

    # iTerm2 AppleScript to open new window and run SSH + claude
    osascript <<EOF
tell application "iTerm2"
    activate
    create window with default profile
    tell current session of current window
        write text "$SSH_CMD 'cd \"$TEAM_PATH\" && $FULL_CLAUDE_CMD'"
    end tell
end tell
EOF
fi
