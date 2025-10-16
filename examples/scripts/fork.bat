@echo off
REM Iris MCP Fork Script for Windows - Opens new terminal with Claude session
REM For local teams: fork.bat <sessionId> <teamPath>
REM For remote teams: fork.bat <sessionId> <teamPath> <sshHost> [sshOptions]
REM
REM Copy this to %IRIS_HOME%\fork.bat:
REM   copy src\example.fork.bat %USERPROFILE%\.iris\fork.bat
REM
REM Arguments:
REM %1 = sessionId (required)
REM %2 = teamPath (required)
REM %3 = sshHost (optional - if provided, will SSH to remote)
REM %4 = sshOptions (optional - SSH options like "-J jumphost")

set SESSION_ID=%1
set TEAM_PATH=%2
set SSH_HOST=%3
set SSH_OPTIONS=%4

if "%SESSION_ID%"=="" (
    echo Error: sessionId is required
    echo Usage: %0 ^<sessionId^> ^<teamPath^> [sshHost] [sshOptions]
    exit /b 1
)

if "%TEAM_PATH%"=="" (
    echo Error: teamPath is required
    echo Usage: %0 ^<sessionId^> ^<teamPath^> [sshHost] [sshOptions]
    exit /b 1
)

if "%SSH_HOST%"=="" (
    REM Local fork - no SSH host provided
    echo Forking local session: %SESSION_ID% in %TEAM_PATH%

    REM Windows Terminal
    if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe" (
        start wt.exe -w 0 -d "%TEAM_PATH%" cmd /k "claude --resume %SESSION_ID%"
    ) else (
        REM Fall back to regular cmd
        start cmd /k "cd /d %TEAM_PATH% && claude --resume %SESSION_ID%"
    )
) else (
    REM Remote fork - SSH to remote host
    echo Forking remote session: %SESSION_ID% on %SSH_HOST% in %TEAM_PATH%

    REM Build SSH command
    if "%SSH_OPTIONS%"=="" (
        set SSH_CMD=ssh -t %SSH_HOST%
    ) else (
        set SSH_CMD=ssh -t %SSH_OPTIONS% %SSH_HOST%
    )

    REM Windows Terminal
    if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe" (
        start wt.exe -w 0 cmd /k "%SSH_CMD% \"cd %TEAM_PATH% && claude --resume %SESSION_ID%\""
    ) else (
        REM Fall back to regular cmd
        start cmd /k "%SSH_CMD% \"cd %TEAM_PATH% && claude --resume %SESSION_ID%\""
    )
)