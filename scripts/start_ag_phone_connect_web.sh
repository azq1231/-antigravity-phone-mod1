#!/bin/bash

# Navigate to script directory
cd "$(dirname "$0")"

echo "==================================================="
echo "  Antigravity Phone Connect - WEB ACCESS MODE"
echo "==================================================="
echo

# 0. Aggressive Cleanup
echo "[0/2] Cleaning up orphans..."
pkill -f "node server.js" &> /dev/null
pkill -f "ngrok" &> /dev/null
# Cleanup by port (Linux/Mac)
if command -v lsof &> /dev/null; then
    lsof -ti:3000 | xargs kill -9 &> /dev/null
fi

# 1. Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing Node.js dependencies..."
    npm install
fi

# 2. Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    exit 1
fi

# 3. Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 is not installed."
    exit 1
fi

# 4. Check for .env file
if [ ! -f ".env" ]; then
    echo "[WARNING] .env file not found. This is required for Web Access."
    echo
    echo "To use Web Access, you need an ngrok authtoken:"
    echo "1. Sign up for free at https://ngrok.com"
    echo "2. Get your 'Your Authtoken' from the ngrok dashboard."
    echo
    read -p "Would you like to create a template .env file now? (y/n): " create_env
    if [[ $create_env == "y" || $create_env == "Y" ]]; then
        cat <<EOT > .env
# Antigravity Phone Connect Configuration
# Get your token from https://dashboard.ngrok.com/get-started/your-authtoken
NGROK_AUTHTOKEN=your_token_here
# Set a custom password for remote access (optional, defaults to 6-digit passcode)
APP_PASSWORD=antigravity
PORT=3000
EOT
        echo "[SUCCESS] .env template created!"
        echo "[ACTION] Please open .env and replace 'your_token_here' with your real token."
        exit 0
    else
        echo "[ERROR] Cannot proceed without .env configuration."
        exit 1
    fi
fi
echo "[INFO] .env configuration found."

# 5. Launch everything via Python
echo "[1/1] Launching Antigravity Phone Connect..."
echo "(This will start both the server and the web tunnel)"
python3 launcher.py --mode web

# 6. Auto-close when done
exit 0
