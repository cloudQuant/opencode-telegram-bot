@echo off
setlocal EnableDelayedExpansion

set "CONFIG_DIR=%~dp0config"

if not exist "%CONFIG_DIR%" (
    echo No bots configured.
    exit /b 1
)

set "count=0"
set "stopped=0"

for /d %%d in ("%CONFIG_DIR%\bot_*") do (
    set "name=%%~nxd"
    set "botname=!name:bot_=!"
    set "pid_file=%%d\bot.pid"

    if exist "!pid_file!" (
        set /p PID=<"!pid_file!"
        tasklist /FI "PID eq !PID!" 2>nul | find "!PID!" >nul
        if !errorlevel! equ 0 (
            set /a count+=1
            echo [STOP] Stopping !botname! ^(PID: !PID!^)...
            taskkill /PID !PID! /T /F >nul 2>&1
            del "!pid_file!" 2>nul
            set /a stopped+=1
        ) else (
            echo [CLEAN] !botname! not running, removing stale PID file
            del "!pid_file!" 2>nul
        )
    ) else (
        echo [SKIP] !botname! is not running
    )
)

echo.
echo ================================
echo Stopped: %stopped% bot(s)
exit /b 0
