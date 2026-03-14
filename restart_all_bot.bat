@echo off
setlocal EnableDelayedExpansion

echo Stopping all bots...
call "%~dp0stop_all_bot.bat"

echo.
echo Waiting 2 seconds...
timeout /t 2 /nobreak >nul

echo.
echo Starting all bots...
call "%~dp0start_all_bot.bat"
