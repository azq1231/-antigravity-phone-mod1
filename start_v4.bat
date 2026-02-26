@echo off
title Antigravity Phone Connect V4 (Stable Hybrid)
echo ===================================================
echo   Antigravity Phone Connect - V4 STABLE
echo ===================================================
echo.

echo [INFO] Checking Port 3004...
set "PID="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3004 ^| findstr LISTENING') do set PID=%%a

if defined PID (
    echo [WARN] Port 3004 is occupied by PID %PID%. Cleaning up...
    taskkill /F /PID %PID% >nul 2>&1
    timeout /t 1 >nul
) else (
    echo [INFO] Port 3004 is clear.
)

echo [INFO] Running Sanity Check...
node scripts/sanity_check_v4.js
if %errorlevel% neq 0 (
    echo.
    echo ❌ [FATAL] Integrity check failed! Please fix the errors above.
    pause
    exit /b %errorlevel%
)

echo [INFO] Starting V4 Server...
node server_v4.js
echo.
echo [INFO] Server stopped. Press any key to exit.
pause >nul
