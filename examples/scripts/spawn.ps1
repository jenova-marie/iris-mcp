# Iris MCP Fork Script for Windows PowerShell - Opens new terminal with Claude session
# For local teams: spawn.ps1 <sessionId> <teamPath>
# For remote teams: spawn.ps1 <sessionId> <teamPath> <sshHost> [sshOptions]
#
# Copy this to $env:IRIS_HOME\spawn.ps1:
#   Copy-Item src\example.spawn.ps1 "$env:USERPROFILE\.iris\spawn.ps1"
#
# Arguments:
# $args[0] = sessionId (required)
# $args[1] = teamPath (required)
# $args[2] = sshHost (optional - if provided, will SSH to remote)
# $args[3] = sshOptions (optional - SSH options like "-J jumphost")

param(
    [Parameter(Mandatory=$true)]
    [string]$SessionId,

    [Parameter(Mandatory=$true)]
    [string]$TeamPath,

    [Parameter(Mandatory=$false)]
    [string]$SshHost,

    [Parameter(Mandatory=$false)]
    [string]$SshOptions
)

if (-not $SessionId -or -not $TeamPath) {
    Write-Error "Error: sessionId and teamPath are required"
    Write-Host "Usage: .\spawn.ps1 <sessionId> <teamPath> [sshHost] [sshOptions]"
    exit 1
}

if (-not $SshHost) {
    # Local fork - no SSH host provided
    Write-Host "Forking local session: $SessionId in $TeamPath"

    # Try Windows Terminal first
    $wtPath = "$env:LOCALAPPDATA\Microsoft\WindowsApps\wt.exe"
    if (Test-Path $wtPath) {
        # Windows Terminal
        Start-Process wt.exe -ArgumentList "-w", "0", "-d", "`"$TeamPath`"", "powershell", "-NoExit", "-Command", "claude --resume $SessionId"
    } else {
        # Fall back to regular PowerShell window
        Start-Process powershell -WorkingDirectory $TeamPath -ArgumentList "-NoExit", "-Command", "claude --resume $SessionId"
    }
} else {
    # Remote fork - SSH to remote host
    Write-Host "Forking remote session: $SessionId on $SshHost in $TeamPath"

    # Build SSH command
    if ($SshOptions) {
        $sshCmd = "ssh -t $SshOptions $SshHost"
    } else {
        $sshCmd = "ssh -t $SshHost"
    }

    $remoteCommand = "'cd `"$TeamPath`" && claude --resume $SessionId'"

    # Try Windows Terminal first
    $wtPath = "$env:LOCALAPPDATA\Microsoft\WindowsApps\wt.exe"
    if (Test-Path $wtPath) {
        # Windows Terminal
        Start-Process wt.exe -ArgumentList "-w", "0", "powershell", "-NoExit", "-Command", "$sshCmd $remoteCommand"
    } else {
        # Fall back to regular PowerShell window
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "$sshCmd $remoteCommand"
    }
}
