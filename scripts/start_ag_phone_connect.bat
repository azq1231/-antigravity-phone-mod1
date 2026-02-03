@echo off
setlocal enabledelayedexpansion
title Antigravity Phone Connect

:: Navigate to the script's directory
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Phone Connect Launcher
echo ===================================================
echo.

echo [STARTING] Launching via Unified Launcher...
python launcher.py --mode local

:: Keep window open if server crashes
echo.
echo [INFO] Server stopped. Press any key to exit.
pause >nul

