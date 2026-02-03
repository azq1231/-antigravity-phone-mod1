@echo off
setlocal enabledelayedexpansion
title Antigravity Phone Connect (Multi-Session)

:: Navigate to the script's directory
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Phone Connect - MULTI-SESSION
echo ===================================================
echo.
echo [INFO] This version allows each device to watch 
echo        different Antigravity instances independently.
echo.

echo [STARTING] Launching via Multi-Session Launcher...
python launcher_multi.py --mode local

:: Keep window open if server crashes
echo.
echo [INFO] Server stopped. Press any key to exit.
pause >nul
