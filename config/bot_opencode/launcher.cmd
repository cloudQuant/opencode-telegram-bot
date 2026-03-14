@echo off
set "OPENCODE_TELEGRAM_HOME=D:\source_code\opencode-telegram-bot\config\bot_opencode"
cd /d "D:\source_code\opencode-telegram-bot\"
node dist/index.js >> "D:\source_code\opencode-telegram-bot\config\bot_opencode\bot.log" 2>&1
