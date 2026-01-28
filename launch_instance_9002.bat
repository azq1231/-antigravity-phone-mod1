@echo off
echo Starting Antigravity Instance 3 (Port 9002)...
mkdir ".user_data_9002" 2>nul
antigravity . --remote-debugging-port=9002 --user-data-dir=".user_data_9002"
