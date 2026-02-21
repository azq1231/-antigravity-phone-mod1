@echo off
TITLE Antigravity Cloudflare Tunnel
echo Starting Cloudflare Tunnel for ag.monyangood.com ...
cd /d "%~dp0"
.\cloudflared.exe tunnel --config .\cloudflared_config.yml run
pause
