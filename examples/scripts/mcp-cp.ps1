# mcp-cp.ps1 - Write MCP config file locally (Windows PowerShell)
#
# Usage: Get-Content config.json | .\mcp-cp.ps1 <sessionId> [destination-dir]
#
# Reads MCP config JSON from stdin, writes to file, outputs the file path to stdout.
# Default destination: $env:TEMP\iris-mcp-<sessionId>.json
#

param(
    [Parameter(Mandatory=$true)]
    [string]$SessionId,

    [Parameter(Mandatory=$false)]
    [string]$DestDir = $env:TEMP
)

$ErrorActionPreference = "Stop"

# Build file path
$FilePath = Join-Path $DestDir "iris-mcp-$SessionId.json"

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
