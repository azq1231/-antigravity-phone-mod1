$ErrorActionPreference = "SilentlyContinue"

# Define the paths we suspect
$paths = @(
    "HKCU:\Software\Classes\Directory\shell\AntigravityDebug",
    "HKCU:\Software\Classes\Directory\Background\shell\AntigravityDebug",
    "HKLM:\SOFTWARE\Classes\Directory\shell\AntigravityDebug",
    "HKLM:\SOFTWARE\Classes\Directory\Background\shell\AntigravityDebug",
    "Registry::HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug",
    "Registry::HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug"
)

Write-Host "Searching for and removing Antigravity registry keys..."

foreach ($path in $paths) {
    if (Test-Path $path) {
        Write-Host "Found: $path - Removing..."
        Remove-Item -Path $path -Recurse -Force
    } else {
        Write-Host "Not found: $path"
    }
}

# Also force restart explorer
Write-Host "Restarting Explorer..."
Stop-Process -Name explorer -Force
Start-Process explorer
