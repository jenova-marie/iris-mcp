#!/bin/bash
# Iris MCP Fork Script - Opens new terminal with Claude session
# For local teams: fork.sh <sessionId> <teamPath>
# For remote teams: fork.sh <sessionId> <teamPath> <sshHost> [sshOptions]
#
# Copy this to ~/.iris/fork.sh and make it executable:
#   cp src/example.fork.sh ~/.iris/fork.sh
#   chmod +x ~/.iris/fork.sh
#
# Arguments:
# $1 = sessionId (required)
# $2 = teamPath (required)
# $3 = sshHost (optional - if provided, will SSH to remote)
# $4 = sshOptions (optional - SSH options like "-J jumphost")

SESSION_ID="$1"
TEAM_PATH="$2"
SSH_HOST="$3"
SSH_OPTIONS="$4"

if [ -z "$SESSION_ID" ] || [ -z "$TEAM_PATH" ]; then
    echo "Error: sessionId and teamPath are required"
    echo "Usage: $0 <sessionId> <teamPath> [sshHost] [sshOptions]"
    exit 1
fi

if [ -z "$SSH_HOST" ]; then
    # Local fork - no SSH host provided
    echo "Forking local session: $SESSION_ID in $TEAM_PATH"

    # iTerm2 AppleScript to open new window and run claude --resume
    osascript <<EOF
tell application "iTerm2"
    activate
    create window with default profile
    tell current session of current window
        write text "cd \"$TEAM_PATH\" && claude --resume $SESSION_ID"
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
        write text "$SSH_CMD 'cd \"$TEAM_PATH\" && claude --resume $SESSION_ID'"
    end tell
end tell
EOF
fi