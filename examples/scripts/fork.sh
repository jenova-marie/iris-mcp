#!/bin/bash
# Iris MCP Fork Script - Opens new terminal with Claude session
# For local teams: fork.sh <sessionId> <teamPath> <claudePath>
# For remote teams: fork.sh <sessionId> <teamPath> <claudePath> <sshHost> [sshOptions]
#
# Copy this to ~/.iris/fork.sh and make it executable:
#   cp examples/config/fork.sh ~/.iris/fork.sh
#   chmod +x ~/.iris/fork.sh
#
# Arguments:
# $1 = sessionId (required)
# $2 = teamPath (required)
# $3 = claudePath (required - path to Claude CLI executable, e.g., "claude" or "~/.local/bin/claude")
# $4 = sshHost (optional - if provided, will SSH to remote)
# $5 = sshOptions (optional - SSH options like "-J jumphost")

SESSION_ID="$1"
TEAM_PATH="$2"
CLAUDE_PATH="$3"
SSH_HOST="$4"
SSH_OPTIONS="$5"

if [ -z "$SESSION_ID" ] || [ -z "$TEAM_PATH" ] || [ -z "$CLAUDE_PATH" ]; then
    echo "Error: sessionId, teamPath, and claudePath are required"
    echo "Usage: $0 <sessionId> <teamPath> <claudePath> [sshHost] [sshOptions]"
    exit 1
fi

if [ -z "$SSH_HOST" ]; then
    # Local fork - no SSH host provided
    echo "Forking local session: $SESSION_ID in $TEAM_PATH using $CLAUDE_PATH"

    # iTerm2 AppleScript to open new window and run claude --resume
    osascript <<EOF
tell application "iTerm2"
    activate
    create window with default profile
    tell current session of current window
        write text "cd \"$TEAM_PATH\" && $CLAUDE_PATH --resume $SESSION_ID --fork-session"
    end tell
end tell
EOF

else
    # Remote fork - SSH to remote host
    echo "Forking remote session: $SESSION_ID on $SSH_HOST in $TEAM_PATH"

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
        write text "$SSH_CMD 'cd \"$TEAM_PATH\" && $CLAUDE_PATH --resume $SESSION_ID --fork-session'"
    end tell
end tell
EOF
fi
