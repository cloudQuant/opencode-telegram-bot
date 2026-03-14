@echo off
setlocal EnableDelayedExpansion

set "CONFIG_DIR=%~dp0config"
set "ACTION=%~1"
set "BOT_NAME=%~2"

if "%ACTION%"=="" goto :show_help

if "%ACTION%"=="list" goto :do_list
if "%ACTION%"=="ls" goto :do_list
if "%ACTION%"=="create" goto :do_create
if "%ACTION%"=="new" goto :do_create
if "%ACTION%"=="start" goto :do_start
if "%ACTION%"=="run" goto :do_start
if "%ACTION%"=="stop" goto :do_stop
if "%ACTION%"=="kill" goto :do_stop
if "%ACTION%"=="restart" goto :do_restart
if "%ACTION%"=="reload" goto :do_restart
if "%ACTION%"=="delete" goto :do_delete
if "%ACTION%"=="remove" goto :do_delete
if "%ACTION%"=="rm" goto :do_delete
if "%ACTION%"=="edit" goto :do_edit
if "%ACTION%"=="config" goto :do_edit
if "%ACTION%"=="logs" goto :do_logs
if "%ACTION%"=="log" goto :do_logs
if "%ACTION%"=="status" goto :do_status
if "%ACTION%"=="info" goto :do_status

echo Unknown action: %ACTION%
goto :show_help

:show_help
echo.
echo OpenCode Telegram Bot Manager
echo.
echo Usage: bots.bat ^<action^> [name]
echo.
echo Actions:
echo   list, ls          List all bots and their status
echo   create ^<name^>   Create a new bot configuration
echo   start ^<name^>    Start a bot instance
echo   stop ^<name^>     Stop a bot instance
echo   restart ^<name^>  Restart a bot instance
echo   delete ^<name^>  Delete a bot configuration (stops if running)
echo   edit ^<name^>    Open bot config in notepad
echo   logs ^<name^>    Show bot log output
echo   status ^<name^>  Show bot status
echo.
echo Examples:
echo   bots.bat list
echo   bots.bat create work
echo   bots.bat start work
echo   bots.bat logs work
echo   bots.bat stop work
exit /b 1

:do_list
echo.
echo Available Bots:
echo ================
if not exist "%CONFIG_DIR%" (
    echo No bots configured yet.
    echo.
    echo Run: bots.bat create ^<name^>
    exit /b 0
)
set "found=0"
for /d %%d in ("%CONFIG_DIR%\bot_*") do (
    set "found=0"
    set "name=%%~nxd"
    set "botname=!name:bot_=!"
    set "env_file=%%d\.env"
    set "pid_file=%%d\bot.pid"
    set "log_file=%%d\bot.log"
    
    if exist "!pid_file!" (
        set /p PID=<"!pid_file!"
        tasklist /FI "PID !PID!" 2>nul | find "!PID!" >nul
        if !errorlevel! equ 0 (
            echo [RUNNING] !botname! (PID: !PID!)
        ) else (
            echo [STOPPED] !botname! (stale PID)
            del "!pid_file!" 2>nul
        )
    ) else (
        echo [STOPPED] !botname!
    )
)
if "!found!"=="1" (
    echo.
    echo No bots configured yet.
    echo Run: bots.bat create ^<name^>
)
exit /b 0

:do_create
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat create ^<name^>
    exit /b 1
)
set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"

if exist "%BOT_DIR%\.env" (
    echo Error: Bot '%BOT_NAME%' already exists
    exit /b 1
)

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
if not exist "%BOT_DIR%" mkdir "%BOT_DIR%"

if exist "%~dp0.env.example" (
    copy "%~dp0.env.example" "%BOT_DIR%\.env" >nul
) else (
    echo # OpenCode Telegram Bot Configuration > "%BOT_DIR%\.env"
    echo TELEGRAM_BOT_TOKEN= >> "%BOT_DIR%\.env"
    echo TELEGRAM_ALLOWED_USER_ID= >> "%BOT_DIR%\.env"
    echo OPENCODE_MODEL_PROVIDER=zai-coding-plan >> "%BOT_DIR%\.env"
    echo OPENCODE_MODEL_ID=glm-5 >> "%BOT_DIR%\.env"
)

echo {} > "%BOT_DIR%\settings.json"

echo.
echo Bot '%BOT_NAME%' created successfully!
echo.
echo Config directory: %BOT_DIR%
echo.
echo Next steps:
echo 1. Edit configuration: bots.bat edit %BOT_NAME%
echo 2. Set your TELEGRAM_BOT_TOKEN (from @BotFather)
echo 3. Set your TELEGRAM_ALLOWED_USER_ID (from @userinfobot)
echo 4. Start the bot: bots.bat start %BOT_NAME%
echo.
echo Opening config file in notepad...
notepad "%BOT_DIR%\.env"
exit /b 0

:do_start
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat start ^<name^>
    echo.
    goto :do_list_short
)

set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"
set "PID_FILE=%BOT_DIR%\bot.pid"
set "LOG_FILE=%BOT_DIR%\bot.log"

if not exist "%BOT_DIR%\.env" (
    echo Error: Bot '%BOT_NAME%' not found
    echo Run: bots.bat create %BOT_NAME%
    exit /b 1
)

if exist "%PID_FILE%" (
    set /p PID=<"%PID_FILE%"
    tasklist /FI "PID !PID!" 2>nul | find "!PID!" >nul
    if !errorlevel! equ 0 (
        echo Bot '%BOT_NAME%' is already running (PID: !PID!)
        exit /b 1
    )
    del "%PID_FILE%" 2>nul
)

if not exist "%~dp0dist\index.js" (
    echo Building...
    call npm run build
    if errorlevel 1 exit /b 1
)

echo Starting bot '%BOT_NAME%'...

cd /d "%~dp0"

REM Create a launcher script for clean env var handling
set "LAUNCHER=%BOT_DIR%\launcher.cmd"
> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo set "OPENCODE_TELEGRAM_HOME=%BOT_DIR%"
>> "%LAUNCHER%" echo cd /d "%~dp0"
>> "%LAUNCHER%" echo node dist/index.js ^>^> "%LOG_FILE%" 2^>^&1

REM Start hidden and capture PID
powershell -Command "Start-Process -FilePath '%LAUNCHER%' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id | Out-File -Encoding ascii -NoNewline '%PID_FILE%'"

timeout /t 3 /nobreak >nul

if exist "%PID_FILE%" (
    set /p PID=<"%PID_FILE%"
    tasklist /FI "PID eq !PID!" 2>nul | find "!PID!" >nul
    if !errorlevel! equ 0 (
        echo Started bot '%BOT_NAME%' ^(PID: !PID!^)
        echo Log file: %LOG_FILE%
    ) else (
        echo Failed to start bot '%BOT_NAME%' - process exited immediately
        echo Check log: %LOG_FILE%
        del "%PID_FILE%" 2>nul
        exit /b 1
    )
) else (
    echo Failed to start bot '%BOT_NAME%'
    exit /b 1
)
exit /b 0

:do_stop
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat stop ^<name^>
    echo.
    goto :do_list_short
)

set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"
set "PID_FILE=%BOT_DIR%\bot.pid"

if not exist "%PID_FILE%" (
    echo Bot '%BOT_NAME%' is not running
    exit /b 1
)

set /p PID=<"%PID_FILE%"
taskkill /PID %PID% /T /F >nul 2>&1
del "%PID_FILE%" 2>nul

echo Stopped bot '%BOT_NAME%' (PID: %PID%)
exit /b 0

:do_restart
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat restart ^<name^>
    exit /b 1
)

call :do_stop_quiet
timeout /t 2 /nobreak >nul
call :do_start
exit /b 0

:do_stop_quiet
set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"
set "PID_FILE=%BOT_DIR%\bot.pid"
if exist "%PID_FILE%" (
    set /p PID=<"%PID_FILE%"
    taskkill /PID !PID! /T /F >nul 2>&1
    del "%PID_FILE%" 2>nul
)
exit /b 0

:do_delete
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat delete ^<name^>
    echo.
    goto :do_list_short
)

set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"

if not exist "%BOT_DIR%\.env" (
    echo Error: Bot '%BOT_NAME%' not found
    exit /b 1
)

echo Warning: This will delete all configuration for '%BOT_NAME%'
set /p CONFIRM="Type 'yes' to confirm: "
if /i "%CONFIRM%" neq "yes" goto :delete_cancelled

call :do_stop_quiet

rd /s /q "%BOT_DIR%"
echo Deleted bot '%BOT_NAME%'
exit /b 0

:delete_cancelled
echo Cancelled.
exit /b 0

:do_edit
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat edit ^<name^>
    echo.
    goto :do_list_short
)

set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"

if not exist "%BOT_DIR%\.env" (
    echo Error: Bot '%BOT_NAME%' not found
    exit /b 1
)

echo Opening %BOT_DIR%\.env
notepad "%BOT_DIR%\.env"
exit /b 0

:do_logs
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat logs ^<name^>
    echo.
    goto :do_list_short
)

set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"
set "LOG_FILE=%BOT_DIR%\bot.log"

if not exist "%LOG_FILE%" (
    echo No log file found for '%BOT_NAME%'
    exit /b 1
)

echo Last 50 lines of %LOG_FILE%:
echo ========================================
type "%LOG_FILE%" | more
exit /b 0

:do_status
if "%BOT_NAME%"=="" (
    echo Error: Bot name required
    echo Usage: bots.bat status ^<name^>
    echo.
    goto :do_list_short
)

set "BOT_DIR=%CONFIG_DIR%\bot_%BOT_NAME%"
set "PID_FILE=%BOT_DIR%\bot.pid"
set "LOG_FILE=%BOT_DIR%\bot.log"

if not exist "%BOT_DIR%\.env" (
    echo Error: Bot '%BOT_NAME%' not found
    exit /b 1
)

echo Bot: %BOT_NAME%
echo ================
if exist "%PID_FILE%" (
    set /p PID=<"%PID_FILE%"
    tasklist /FI "PID !PID!" 2>nul | find "!PID!" >nul
    if !errorlevel! equ 0 (
        echo Status: RUNNING (PID: !PID!)
    ) else (
        echo Status: STOPPED (stale PID file)
        del "%PID_FILE%" 2>nul
    )
) else (
    echo Status: STOPPED
)
echo Config: %BOT_DIR%\.env
if exist "%LOG_FILE%" (
    echo Log: %LOG_FILE%
    for %%F in ("%LOG_FILE%") do set "size=%%~zF"
    echo Log size: !size! bytes
)
exit /b 0

:do_list_short
echo Available bots:
for /d %%d in ("%CONFIG_DIR%\bot_*") do (
    set "name=%%~nxd"
    echo   !name:bot_=!
)
exit /b 1
