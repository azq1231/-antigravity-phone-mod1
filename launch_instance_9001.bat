@echo off
echo Starting Antigravity Instance 2 (Port 9001)...
mkdir ".user_data_9001" 2>nul
antigravity . --remote-debugging-port=9001 --user-data-dir=".user_data_9001"
