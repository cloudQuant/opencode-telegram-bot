@echo off
setlocal EnableDelayedExpansion

set "CONFIG_DIR=%~dp0config"

if not exist "%CONFIG_DIR%" (
    echo No bots configured yet.
    echo Run: bots.bat create ^<name^>
    exit /b 1
)

set "count=0"
set "started=0"
set "failed=0"

for /d %%d in ("%CONFIG_DIR%\bot_*") do (
    set "name=%%~nxd"
    set "botname=!name:bot_=!"
    set /a count+=1

    set "pid_file=%%d\bot.pid"
    set "already_running=0"

    if exist "!pid_file!" (
        set /p PID=<"!pid_file!"
        tasklist /FI "PID eq !PID!" 2>nul | find "!PID!" >nul
        if !errorlevel! equ 0 (
            echo [SKIP] !botname! is already running ^(PID: !PID!^)
            set "already_running=1"
        ) else (
            del "!pid_file!" 2>nul
        )
    )

    if "!already_running!"=="0" (
        echo [START] Starting !botname!...
        call "%~dp0bots.bat" start !botname!
        if !errorlevel! equ 0 (
            set /a started+=1
        ) else (
            set /a failed+=1
            echo [FAIL] Failed to start !botname!
        )
    )
)

if %count% equ 0 (
    echo No bots configured yet.
    echo Run: bots.bat create ^<name^>
    exit /b 1
)

echo.
echo ================================
echo Total: %count%, Started: %started%, Failed: %failed%
exit /b 0
