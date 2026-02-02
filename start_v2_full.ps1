
# Start Antigravity on Port 9000 if not running
$port = 9000
$listening = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if (-not $listening) {
    Write-Host "🚀 Launching Antigravity on Port $port..."
    $antigravityPath = "D:\Program Files\Antigravity\Antigravity.exe"
    $userDataDir = "$PSScriptRoot\.user_data_$port"
    
    Start-Process -FilePath $antigravityPath -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=`"$userDataDir`"", "--no-first-run", "--disable-workspace-trust" -WindowStyle Minimized
    
    # Wait for it to initialize
    Start-Sleep -Seconds 5
} else {
    Write-Host "✅ Antigravity already running on Port $port"
}

# Kill existing V2 server if any
$v2port = 3005
$v2process = Get-NetTCPConnection -LocalPort $v2port -ErrorAction SilentlyContinue
if ($v2process) {
    Write-Host "🛑 Killing existing V2 server on port $v2process.OwningProcess..."
    Stop-Process -Id $v2process.OwningProcess -Force
}

# Start V2 Server
Write-Host "🚀 Starting V2 Server..."
node server_v2.js
