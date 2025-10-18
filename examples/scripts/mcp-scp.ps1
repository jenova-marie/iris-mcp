# mcp-scp.ps1 - Write MCP config file to remote host via SCP (Windows PowerShell)
#
# Usage: Get-Content config.json | .\mcp-scp.ps1 <sessionId> <ssh-host> [remote-dir]
#
# Reads MCP config JSON from stdin, writes to local temp file, SCPs to remote host,
# outputs the remote file path to stdout, then cleans up local temp file.
#
# Requires: OpenSSH for Windows or pscp (PuTTY)
# Default remote directory: ~/.iris/mcp-configs/
#

param(
    [Parameter(Mandatory=$true)]
    [string]$SessionId,

    [Parameter(Mandatory=$true)]
    [string]$SshHost,

    [Parameter(Mandatory=$false)]
    [string]$RemoteDir = "~/.iris/mcp-configs"
)

$ErrorActionPreference = "Stop"

# Create local temp file
$LocalTemp = [System.IO.Path]::GetTempFileName()
$LocalTempJson = "$LocalTemp.json"
Move-Item $LocalTemp $LocalTempJson -Force

try {
    # Read JSON from stdin and write to local temp file
    $input | Out-File -FilePath $LocalTempJson -Encoding UTF8 -NoNewline

    # Ensure remote directory exists
    ssh $SshHost "mkdir -p '$RemoteDir' && chmod 700 '$RemoteDir'"

    # Build remote file path
    $RemoteFile = "$RemoteDir/iris-mcp-$SessionId.json"

    # SCP file to remote host
    scp -q $LocalTempJson "${SshHost}:${RemoteFile}"

    # Set remote file permissions (readable only by owner)
    ssh $SshHost "chmod 600 '$RemoteFile'"

    # Output the remote file path to stdout (transport will read this)
    Write-Output $RemoteFile
}
finally {
    # Cleanup local temp file
    if (Test-Path $LocalTempJson) {
        Remove-Item $LocalTempJson -Force
    }
}
