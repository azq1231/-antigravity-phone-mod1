@echo off
setlocal enabledelayedexpansion
title Antigravity Phone Connect - WEB MODE

:: Navigate to script directory
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Phone Connect - WEB ACCESS MODE
echo ===================================================
echo.

:: 0. Aggressive Cleanup (Clear any stuck processes from previous runs)
echo [0/2] Cleaning up orphans...
taskkill /f /im node.exe /fi "WINDOWTITLE eq AG_SERVER_PROC*" >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

:: 1. Ensure dependencies are installed
if not exist "node_modules" (
    echo [INFO] Installing Node.js dependencies...
    call npm install
)

:: 2. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js missing.
    pause
    exit /b
)

:: 3. Check Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python missing. Required for the web tunnel.
    pause
    exit /b
)

:: 4. Check for .env file
if exist ".env" goto ENV_FOUND
if exist "%~dp0.env" goto ENV_FOUND

echo [WARNING] .env file not found. This is required for Web Access.
echo.
echo To use Web Access, you need an ngrok authtoken:
echo 1. Sign up for free at https://ngrok.com
echo 2. Get your 'Your Authtoken' from the ngrok dashboard.
echo.
set /p "create_env=Would you like to create a template .env file now? (y/n): "
if /i "!create_env!"=="y" (
    echo # Antigravity Phone Connect Configuration > .env
    echo # Get your token from https://dashboard.ngrok.com/get-started/your-authtoken >> .env
    echo NGROK_AUTHTOKEN=your_token_here >> .env
    echo # Set a custom password for remote access (optional, defaults to 6-digit passcode) >> .env
    echo APP_PASSWORD=antigravity >> .env
    echo PORT=3000 >> .env
    echo.
    echo [SUCCESS] .env template created! 
    echo [ACTION] Please open .env and replace 'your_token_here' with your real token.
    pause
    exit /b
)

echo [ERROR] Cannot proceed without .env configuration.
pause
exit /b

:ENV_FOUND
echo [INFO] .env configuration found.

:: 5. Launch everything via Python
echo [1/1] Launching Antigravity Phone Connect...
echo (This will start both the server and the web tunnel)
python launcher.py --mode web

:: 6. Auto-close when done
exit
