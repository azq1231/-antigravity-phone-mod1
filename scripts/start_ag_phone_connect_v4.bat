@echo off
setlocal enabledelayedexpansion
title Antigravity Phone Connect V4 (Stable Hybrid)

:: Navigate to the script's directory
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Phone Connect - V4 STABLE
echo ===================================================
echo.
echo [INFO] Isolated V4 Environment
echo [INFO] Running on Port 3004
echo.

:: Direct Node Execution for isolation
node server_v4.js

:: Keep window open if server crashes
echo.
echo [INFO] Server stopped. Press any key to exit.
pause >nul
