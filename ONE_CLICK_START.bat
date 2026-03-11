@echo off
:: =========================================================
:: Antigravity Phone V4 - Ultra Simple Launch Script
:: =========================================================
cd /d "%~dp0"

echo [系統] 啟動捷徑已被觸發，即將彈出兩個黑色視窗。

:: 使用 conhost.exe 直接繞過 Windows Terminal 劫持
start "AG-V4-Server" C:\Windows\System32\conhost.exe cmd.exe /k "title AG-V4-Server & color 0B & node server_v4.js"
timeout /t 2 /nobreak >nul
start "AG-V4-Tunnel" C:\Windows\System32\conhost.exe cmd.exe /k "title AG-V4-Tunnel & color 0D & cloudflared.exe tunnel --config cloudflared_config.yml run"

exit
