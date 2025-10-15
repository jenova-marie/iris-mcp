#!/bin/bash
# Example terminal script for Iris MCP - iTerm2 on macOS
# Copy this to ~/.iris/terminal.sh and make it executable:
#   cp terminal.sh.example ~/.iris/terminal.sh
#   chmod +x ~/.iris/terminal.sh

# Arguments:
# $1 = sessionId
# $2 = teamPath

SESSION_ID="$1"
TEAM_PATH="$2"

# iTerm2 AppleScript to open new window and run claude --resume
osascript <<EOF
tell application "iTerm"
    activate
    create window with default profile
    tell current session of current window
        write text "cd \"$TEAM_PATH\" && claude --resume $SESSION_ID"
    end tell
end tell
EOF
