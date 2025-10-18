# mcp-cp.ps1 - Write MCP config file locally (Windows PowerShell)
#
# Usage: Get-Content config.json | .\mcp-cp.ps1 <sessionId> <team-path>
#
# Reads MCP config JSON from stdin, writes to file, outputs the file path to stdout.
# Destination: <team-path>\.claude\iris\mcp\iris-mcp-<sessionId>.json
#

param(
    [Parameter(Mandatory=$true)]
    [string]$SessionId,

    [Parameter(Mandatory=$true)]
    [string]$TeamPath
)

$ErrorActionPreference = "Stop"

# Build destination directory path
$McpDir = Join-Path $TeamPath ".claude\iris\mcp"

# Create directory if it doesn't exist
if (-not (Test-Path $McpDir)) {
    New-Item -ItemType Directory -Path $McpDir -Force | Out-Null
}

# Build file path
$FilePath = Join-Path $McpDir "iris-mcp-$SessionId.json"

# Read JSON from stdin and write to file
$input | Out-File -FilePath $FilePath -Encoding UTF8 -NoNewline

# Set permissions (readable only by current user)
$acl = Get-Acl $FilePath
$acl.SetAccessRuleProtection($true, $false)
$permission = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    "FullControl",
    "Allow"
)
$acl.SetAccessRule($permission)
Set-Acl $FilePath $acl

# Output the file path to stdout (transport will read this)
Write-Output $FilePath
