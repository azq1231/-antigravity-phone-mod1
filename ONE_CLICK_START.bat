@echo off
:: 強制切換至 UTF-8 編碼以支援中文顯示
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: 檢查是否帶有分頁參數啟動
if "%1"=="--server" goto :run_server
if "%1"=="--tunnel" goto :run_tunnel

:: 偵測是否有 Windows Terminal (wt.exe)
where wt >nul 2>&1
if %errorlevel% equ 0 (
    echo [系統] 偵測到 Windows Terminal，正在開啟分頁模式...
    :: 使用 wt 啟動兩個分頁，注意cmd /c 後面也要帶 chcp 65001 確保分頁內不亂碼
    wt -p "Command Prompt" -d "%CD%" cmd /k "chcp 65001 >nul & %~f0 --server" ; nt -p "Command Prompt" -d "%CD%" cmd /k "chcp 65001 >nul & %~f0 --tunnel"
    exit /b
)

:: ---------------------------------------------------------
:: 如果沒有 Windows Terminal，採用舊版模式
:: ---------------------------------------------------------
echo [警告] 未偵測到 Windows Terminal，將以傳統模式啟動。
start "AG-V4-Tunnel" /min cmd /c "chcp 65001 >nul & %~f0 --tunnel"
goto :run_server

:: ---------------------------------------------------------
:: Server 執行區
:: ---------------------------------------------------------
:run_server
title AG-V4-Server
color 0B
echo.
echo ===================================================
echo [1/2] 正在啟動 V4 核心伺服器...
echo ===================================================

:: 清理埠號
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3004 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

node scripts/sanity_check_v4.js
if %errorlevel% neq 0 (
    echo.
    echo ❌ [錯誤] 完整性檢查失敗！請確認代碼後再重試。
    pause
    exit /b 1
)

echo ---------------------------------------
echo   🏠 本地訪問: http://localhost:3004
echo   🌐 外網訪問: https://ag.monyangood.com
echo ---------------------------------------
node server_v4.js
echo.
echo [注意] 伺服器已停止。正在清理穿透程序...
taskkill /F /IM cloudflared.exe >nul 2>&1
pause
exit /b

:: ---------------------------------------------------------
:: Tunnel 執行區
:: ---------------------------------------------------------
:run_tunnel
title AG-V4-Tunnel
color 0D
echo.
echo ===================================================
echo [2/2] 正在啟動外網穿透 (Cloudflare Tunnel)...
echo ===================================================
if exist "cloudflared.exe" (
    .\cloudflared.exe tunnel --config .\cloudflared_config.yml run
) else (
    echo.
    echo ❌ [錯誤] 找不到 cloudflared.exe，請確認檔案路徑。
    pause
)
exit /b
