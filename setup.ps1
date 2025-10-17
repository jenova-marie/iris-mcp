# Iris MCP Setup Script for Windows
# One-command installation: iwr -useb https://raw.githubusercontent.com/jenova-marie/iris-mcp/main/setup.ps1 | iex

# Requires PowerShell 5.1+ (Windows 7+)
#Requires -Version 5.1

# Stop on errors
$ErrorActionPreference = "Stop"

# Banner function
function Print-Banner {
    Write-Host ""
    Write-Host "  ___      _        __  __  ___ ___" -ForegroundColor Cyan
    Write-Host " |_ _|_ _ (_)___   |  \/  |/ __| _ \" -ForegroundColor Cyan
    Write-Host "  | || '_|| (_-<   | |\/| | (__|  _/" -ForegroundColor Cyan
    Write-Host " |___|_|  |_/__/   |_|  |_|\___|_|" -ForegroundColor Cyan
    Write-Host ""
    Write-Host " Bridge Your AI Teams 🌈" -ForegroundColor Cyan
    Write-Host ""
}

# Helper functions
function Print-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> " -NoNewline -ForegroundColor Blue
    Write-Host $Message -ForegroundColor White
}

function Print-Success {
    param([string]$Message)
    Write-Host "✓ " -NoNewline -ForegroundColor Green
    Write-Host $Message
}

function Print-Error {
    param([string]$Message)
    Write-Host "✗ " -NoNewline -ForegroundColor Red
    Write-Host $Message
}

function Print-Info {
    param([string]$Message)
    Write-Host "ℹ " -NoNewline -ForegroundColor Cyan
    Write-Host $Message
}

function Print-Warning {
    param([string]$Message)
    Write-Host "⚠ " -NoNewline -ForegroundColor Yellow
    Write-Host $Message
}

function Prompt-Input {
    param([string]$Message)
    Write-Host "? " -NoNewline -ForegroundColor Cyan
    Write-Host "${Message}: " -NoNewline -ForegroundColor White
    return Read-Host
}

function Prompt-YesNo {
    param(
        [string]$Message,
        [bool]$Default = $true
    )
    $prompt = if ($Default) { "(Y/n)" } else { "(y/N)" }
    Write-Host "? " -NoNewline -ForegroundColor Cyan
    Write-Host "${Message} ${prompt}: " -NoNewline -ForegroundColor White
    $response = Read-Host

    if ([string]::IsNullOrWhiteSpace($response)) {
        return $Default
    }

    return $response -match "^[Yy]"
}

# Check prerequisites
function Test-Prerequisites {
    Print-Step "Checking prerequisites"

    # Check Node.js
    try {
        $nodeVersion = (node --version 2>$null) -replace 'v', ''
        $nodeMajor = [int]($nodeVersion -split '\.')[0]

        if ($nodeMajor -lt 18) {
            Print-Error "Node.js 18+ required (found v$nodeVersion)"
            Write-Host "  Please install Node.js 18+ from https://nodejs.org"
            exit 1
        }

        Print-Success "Node.js v$nodeVersion detected"
    }
    catch {
        Print-Error "Node.js not found"
        Write-Host "  Please install Node.js 18+ from https://nodejs.org"
        exit 1
    }

    # Check npm
    try {
        $npmVersion = (npm --version 2>$null)
        Print-Success "npm v$npmVersion detected"
    }
    catch {
        Print-Error "npm not found"
        exit 1
    }

    # Check Claude Code (optional)
    try {
        $claudeVersion = (claude --version 2>$null)
        Print-Success "Claude Code detected"
    }
    catch {
        Print-Warning "Claude Code not found (install with: npm install -g @claude/code)"
    }
}

# Install Iris MCP
function Install-Iris {
    Print-Step "Installing Iris MCP"

    # Check if already installed
    try {
        $null = npm list -g @jenova-marie/iris-mcp 2>$null
        Print-Info "Iris MCP already installed"

        if (Prompt-YesNo "Reinstall?" -Default $false) {
            # Continue to install
        }
        else {
            Print-Success "Skipping installation"
            return
        }
    }
    catch {
        # Not installed, continue
    }

    Write-Host "Installing @jenova-marie/iris-mcp..." -ForegroundColor Cyan

    try {
        npm install -g @jenova-marie/iris-mcp | Out-Host
        Print-Success "Iris MCP installed successfully"
    }
    catch {
        Print-Error "Installation failed: $_"
        exit 1
    }

    # Verify installation
    try {
        $version = (iris-mcp --version 2>$null)
        Print-Success "iris-mcp CLI available (v$version)"
    }
    catch {
        Print-Error "iris-mcp command not found after installation"
        Print-Info "Try restarting PowerShell or adding npm global bin to PATH"
        exit 1
    }
}

# Add teams interactively
function Add-Teams {
    Print-Step "Configure Teams"
    Write-Host ""
    Write-Host "Teams are your project directories where Claude Code runs." -ForegroundColor Cyan
    Write-Host "You need at least 2 teams to coordinate." -ForegroundColor Cyan
    Write-Host ""

    $teamCount = 0

    while ($true) {
        Write-Host ""
        if ($teamCount -eq 0) {
            Write-Host "Add your first team" -ForegroundColor White
        }
        else {
            Write-Host "Add another team, or type 'q' to continue" -ForegroundColor White
        }

        # Get team name
        $teamName = Prompt-Input "Team name (e.g., frontend, backend, api)"

        # Check for quit
        if ($teamName -eq "q" -or $teamName -eq "Q") {
            if ($teamCount -lt 2) {
                Print-Warning "You need at least 2 teams to use Iris MCP"
                continue
            }
            else {
                break
            }
        }

        # Validate team name
        if ([string]::IsNullOrWhiteSpace($teamName)) {
            Print-Warning "Team name cannot be empty"
            continue
        }

        if ($teamName -notmatch '^[a-zA-Z0-9_-]+$') {
            Print-Warning "Team name can only contain letters, numbers, dashes, and underscores"
            continue
        }

        # Get team path
        $teamPath = Prompt-Input "Project path (absolute or relative)"

        # Expand environment variables and resolve path
        $teamPath = [System.Environment]::ExpandEnvironmentVariables($teamPath)

        # Convert relative to absolute
        if (-not [System.IO.Path]::IsPathRooted($teamPath)) {
            $teamPath = Join-Path $PWD $teamPath
        }

        # Validate path exists
        if (-not (Test-Path $teamPath)) {
            Print-Warning "Directory does not exist: $teamPath"

            if (Prompt-YesNo "Create it?" -Default $false) {
                try {
                    New-Item -ItemType Directory -Path $teamPath -Force | Out-Null
                    Print-Success "Created directory: $teamPath"
                }
                catch {
                    Print-Error "Failed to create directory: $_"
                    continue
                }
            }
            else {
                continue
            }
        }

        # Add the team
        try {
            iris-mcp add-team $teamName $teamPath | Out-Host
            Print-Success "Added team: $teamName → $teamPath"
            $teamCount++
        }
        catch {
            Print-Error "Failed to add team: $_"
        }
    }

    Write-Host ""
    Print-Success "Configured $teamCount teams"
}

# Install to Claude Code
function Install-ToClaudeCode {
    Print-Step "Connect to Claude Code"

    $claudeConfigPath = Join-Path $env:USERPROFILE ".claude.json"

    if (-not (Test-Path $claudeConfigPath)) {
        Print-Warning "~/.claude.json not found"

        if (Prompt-YesNo "Create it now?") {
            try {
                "{}" | Out-File -FilePath $claudeConfigPath -Encoding utf8
                Print-Success "Created ~/.claude.json"
            }
            catch {
                Print-Error "Failed to create config: $_"
                Print-Info "Skipping Claude Code integration"
                Print-Info "Run 'iris-mcp install' manually when ready"
                return
            }
        }
        else {
            Print-Info "Skipping Claude Code integration"
            Print-Info "Run 'iris-mcp install' manually when ready"
            return
        }
    }

    Write-Host "Installing Iris MCP to Claude Code config..." -ForegroundColor Cyan

    try {
        iris-mcp install | Out-Host
        Print-Success "Iris MCP added to ~/.claude.json"
        Print-Info "Restart any running Claude Code instances to load Iris tools"
    }
    catch {
        Print-Error "Failed to install to Claude Code: $_"
        Print-Info "Run 'iris-mcp install' manually later"
    }
}

# Start server
function Start-IrisServer {
    Print-Step "Start Iris MCP Server"
    Write-Host ""
    Write-Host "Iris MCP is ready to coordinate your teams!" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Prompt-YesNo "Start the server now?")) {
        Write-Host ""
        Print-Info "To start later, run: iris-mcp"
        Print-Info "Server will run on: http://localhost:1615"
        Write-Host ""
        Print-Success "Setup complete! 🌈"
        exit 0
    }

    Write-Host ""
    Print-Success "Starting Iris MCP server..."
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""

    # Start the server (this will run indefinitely)
    iris-mcp
}

# Main setup flow
function Main {
    Print-Banner

    Print-Info "This script will:"
    Write-Host "  • Check prerequisites"
    Write-Host "  • Install Iris MCP globally"
    Write-Host "  • Configure your teams"
    Write-Host "  • Connect to Claude Code"
    Write-Host "  • Start the server"
    Write-Host ""

    if (-not (Prompt-YesNo "Continue?")) {
        Write-Host "Setup cancelled."
        exit 0
    }

    Test-Prerequisites
    Install-Iris
    Add-Teams
    Install-ToClaudeCode
    Start-IrisServer
}

# Run main function
try {
    Main
}
catch {
    Write-Host ""
    Print-Error "Setup failed: $_"
    Write-Host $_.ScriptStackTrace
    exit 1
}
