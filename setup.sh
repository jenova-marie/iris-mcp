#!/usr/bin/env bash
set -e

# Iris MCP Setup Script
# One-command installation: curl -fsSL https://raw.githubusercontent.com/jenova-marie/iris-mcp/main/setup.sh | bash

# Colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Rainbow banner
print_banner() {
  echo -e "${CYAN}"
  cat << "EOF"
  ___      _        __  __  ___ ___
 |_ _|_ _ (_)___   |  \/  |/ __| _ \
  | || '_|| (_-<   | |\/| | (__|  _/
 |___|_|  |_/__/   |_|  |_|\___|_|

 Bridge Your AI Teams 🌈
EOF
  echo -e "${NC}"
}

# Helper functions
print_step() {
  echo -e "\n${BLUE}==>${NC} ${BOLD}$1${NC}"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_info() {
  echo -e "${CYAN}ℹ${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

prompt_input() {
  echo -ne "${CYAN}?${NC} ${BOLD}$1${NC}: "
}

# Check prerequisites
check_prerequisites() {
  print_step "Checking prerequisites"

  # Check Node.js
  if ! command -v node &> /dev/null; then
    print_error "Node.js not found"
    echo "  Please install Node.js 18+ from https://nodejs.org"
    exit 1
  fi

  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js 18+ required (found v$NODE_VERSION)"
    exit 1
  fi
  print_success "Node.js v$(node -v | cut -d'v' -f2) detected"

  # Check npm
  if ! command -v npm &> /dev/null; then
    print_error "npm not found"
    exit 1
  fi
  print_success "npm v$(npm -v) detected"

  # Check Claude Code (optional but recommended)
  if command -v claude &> /dev/null; then
    print_success "Claude Code detected"
  else
    print_warning "Claude Code not found (install with: npm install -g @claude/code)"
  fi
}

# Install Iris MCP
install_iris() {
  print_step "Installing Iris MCP"

  if npm list -g @jenova-marie/iris-mcp &> /dev/null; then
    print_info "Iris MCP already installed"
    prompt_input "Reinstall? (y/N)"
    read -r REINSTALL
    if [[ ! "$REINSTALL" =~ ^[Yy]$ ]]; then
      print_success "Skipping installation"
      return
    fi
  fi

  echo -e "${CYAN}Installing @jenova-marie/iris-mcp...${NC}"
  if npm install -g @jenova-marie/iris-mcp; then
    print_success "Iris MCP installed successfully"
  else
    print_error "Installation failed"
    exit 1
  fi

  # Verify installation
  if command -v iris-mcp &> /dev/null; then
    VERSION=$(iris-mcp --version 2>/dev/null || echo "unknown")
    print_success "iris-mcp CLI available (v$VERSION)"
  else
    print_error "iris-mcp command not found after installation"
    print_info "Try adding npm global bin to PATH: export PATH=\"\$(npm bin -g):\$PATH\""
    exit 1
  fi
}

# Add teams interactively
add_teams() {
  print_step "Configure Teams"
  echo ""
  echo -e "${CYAN}Teams are your project directories where Claude Code runs.${NC}"
  echo -e "${CYAN}You need at least 2 teams to coordinate.${NC}"
  echo ""

  TEAM_COUNT=0

  while true; do
    echo ""
    if [ $TEAM_COUNT -eq 0 ]; then
      echo -e "${BOLD}Add your first team${NC}"
    else
      echo -e "${BOLD}Add another team, or type 'q' to continue${NC}"
    fi

    # Get team name
    prompt_input "Team name (e.g., frontend, backend, api)"
    read -r TEAM_NAME

    # Check for quit
    if [[ "$TEAM_NAME" == "q" ]] || [[ "$TEAM_NAME" == "Q" ]]; then
      if [ $TEAM_COUNT -lt 2 ]; then
        print_warning "You need at least 2 teams to use Iris MCP"
        continue
      else
        break
      fi
    fi

    # Validate team name
    if [[ -z "$TEAM_NAME" ]]; then
      print_warning "Team name cannot be empty"
      continue
    fi

    if [[ "$TEAM_NAME" =~ [^a-zA-Z0-9_-] ]]; then
      print_warning "Team name can only contain letters, numbers, dashes, and underscores"
      continue
    fi

    # Get team path
    prompt_input "Project path (absolute or relative)"
    read -r TEAM_PATH

    # Expand tilde and resolve path
    TEAM_PATH="${TEAM_PATH/#\~/$HOME}"
    TEAM_PATH=$(realpath -m "$TEAM_PATH" 2>/dev/null || echo "$TEAM_PATH")

    # Validate path exists
    if [ ! -d "$TEAM_PATH" ]; then
      print_warning "Directory does not exist: $TEAM_PATH"
      prompt_input "Create it? (y/N)"
      read -r CREATE_DIR
      if [[ "$CREATE_DIR" =~ ^[Yy]$ ]]; then
        mkdir -p "$TEAM_PATH"
        print_success "Created directory: $TEAM_PATH"
      else
        continue
      fi
    fi

    # Add the team
    if iris-mcp add-team "$TEAM_NAME" "$TEAM_PATH"; then
      print_success "Added team: $TEAM_NAME → $TEAM_PATH"
      ((TEAM_COUNT++))
    else
      print_error "Failed to add team"
    fi
  done

  echo ""
  print_success "Configured $TEAM_COUNT teams"
}

# Install to Claude Code
install_to_claude() {
  print_step "Connect to Claude Code"

  if [ ! -f "$HOME/.claude.json" ]; then
    print_warning "~/.claude.json not found"
    prompt_input "Create it now? (Y/n)"
    read -r CREATE_CONFIG
    if [[ ! "$CREATE_CONFIG" =~ ^[Nn]$ ]]; then
      echo "{}" > "$HOME/.claude.json"
      print_success "Created ~/.claude.json"
    else
      print_info "Skipping Claude Code integration"
      print_info "Run 'iris-mcp install' manually when ready"
      return
    fi
  fi

  echo -e "${CYAN}Installing Iris MCP to Claude Code config...${NC}"
  if iris-mcp install; then
    print_success "Iris MCP added to ~/.claude.json"
    print_info "Restart any running Claude Code instances to load Iris tools"
  else
    print_error "Failed to install to Claude Code"
    print_info "Run 'iris-mcp install' manually later"
  fi
}

# Offer to start the server
start_server() {
  print_step "Start Iris MCP Server"
  echo ""
  echo -e "${CYAN}Iris MCP is ready to coordinate your teams!${NC}"
  echo ""
  prompt_input "Start the server now? (Y/n)"
  read -r START_NOW

  if [[ "$START_NOW" =~ ^[Nn]$ ]]; then
    echo ""
    print_info "To start later, run: ${BOLD}iris-mcp${NC}"
    print_info "Server will run on: ${BOLD}http://localhost:1615${NC}"
    echo ""
    print_success "Setup complete! 🌈"
    exit 0
  fi

  echo ""
  print_success "Starting Iris MCP server..."
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Start the server (this will run indefinitely)
  iris-mcp
}

# Print usage instructions
print_usage() {
  echo ""
  echo -e "${GREEN}${BOLD}✓ Setup Complete!${NC}"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo -e "  1. Open Claude Code in one of your team directories"
  echo -e "  2. Use Iris MCP tools to coordinate:"
  echo -e "     ${BOLD}team_wake${NC} - Wake up a team"
  echo -e "     ${BOLD}team_tell${NC} - Send a message"
  echo -e "     ${BOLD}team_report${NC} - Get team response"
  echo ""
  echo -e "${CYAN}Server URLs:${NC}"
  echo -e "  MCP: ${BOLD}http://localhost:1615${NC}"
  echo -e "  Dashboard: ${BOLD}http://localhost:3100${NC} (if enabled)"
  echo ""
  echo -e "${CYAN}Documentation:${NC}"
  echo -e "  https://github.com/jenova-marie/iris-mcp"
  echo ""
}

# Main setup flow
main() {
  print_banner

  print_info "This script will:"
  echo "  • Check prerequisites"
  echo "  • Install Iris MCP globally"
  echo "  • Configure your teams"
  echo "  • Connect to Claude Code"
  echo "  • Start the server"
  echo ""

  prompt_input "Continue? (Y/n)"
  read -r CONTINUE
  if [[ "$CONTINUE" =~ ^[Nn]$ ]]; then
    echo "Setup cancelled."
    exit 0
  fi

  check_prerequisites
  install_iris
  add_teams
  install_to_claude
  start_server
}

# Run main function
main
