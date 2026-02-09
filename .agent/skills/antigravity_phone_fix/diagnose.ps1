# Antigravity Phone Fix 深度診斷腳本 (v4.2 - Ultra Stable)

$PORT = 3004
$AG_PORT = 9000
$LOG_FILE = "server.log"

Write-Host "================ Antigravity 深度診斷 ================" -ForegroundColor Cyan

# --- 1. 檔案存在性 ---
Write-Host "`n[1/6] 關鍵檔案驗證" -ForegroundColor White
$keyFiles = @("server.js", "package.json", "public/index.html", "public/js/app_multi.js", "public/sw.js", "core/cdp_manager.js", "core/automation.js")
foreach ($f in $keyFiles) {
    if (Test-Path $f) { Write-Host "  ✅ OK: $f" -ForegroundColor Green }
    else { Write-Host "  ❌ MISSING: $f" -ForegroundColor Red }
}

# --- 2. 模組檢查 ---
Write-Host "`n[2/6] 模組依賴鏈診斷" -ForegroundColor White
function Scan-File-Deps($f) {
    if (-not (Test-Path $f)) { return }
    $txt = Get-Content $f -Raw
    # 簡單且穩定的 Regex
    $matches = [regex]::Matches($txt, 'import\s+\{([^}]+)\}\s+from\s+[''"](.+?)[''"]')
    foreach ($m in $matches) {
        $funcs = $m.Groups[1].Value.Trim()
        $path = $m.Groups[2].Value
        Write-Host "  CHECK: $path ($funcs)" -ForegroundColor Gray
    }
}
Scan-File-Deps "server.js"

# --- 3. SW 驗證 ---
Write-Host "`n[3/6] Service Worker 驗證" -ForegroundColor White
if (Test-Path "public/sw.js") { Write-Host "  ✅ sw.js 存在" -ForegroundColor Green }

# --- 4. 埠口檢查 ---
Write-Host "`n[4/6] 網絡連線" -ForegroundColor White
$pSrv = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($pSrv) { Write-Host "  ✅ Server ($PORT) 在線" -ForegroundColor Green }
else { Write-Host "  ❌ Server ($PORT) 離線" -ForegroundColor Red }

# --- 5. 依賴檢查 ---
Write-Host "`n[5/6] Dependencies" -ForegroundColor White
if (Test-Path "package.json") { Write-Host "  ✅ package.json 正常" -ForegroundColor Green }

# --- 6. 日誌 ---
Write-Host "`n[6/6] 最近日誌回溯" -ForegroundColor White
if (Test-Path $LOG_FILE) {
    Get-Content $LOG_FILE -Tail 5 | ForEach-Object { Write-Host "  > $_" -ForegroundColor Gray }
}

Write-Host "`n==== 診斷結束 ====" -ForegroundColor Cyan
