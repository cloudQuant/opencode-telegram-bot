@echo off
set "OPENCODE_TELEGRAM_HOME=D:\source_code\opencode-telegram-bot\config\bot_bt_api_py"
cd /d "D:\source_code\opencode-telegram-bot\"
node dist/index.js >> "D:\source_code\opencode-telegram-bot\config\bot_bt_api_py\bot.log" 2>&1
