$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$installerPath = Join-Path $desktopDir "dist\opencode-desktop-win-x64.exe"

Set-Location $desktopDir
$env:OPENCODE_CHANNEL = "dev"

Write-Host "Working directory: $desktopDir"
Write-Host "OPENCODE_CHANNEL=$env:OPENCODE_CHANNEL"
Write-Host "Running: bun run build"
bun run build

if ($LASTEXITCODE -ne 0) {
  throw "bun run build failed with exit code $LASTEXITCODE"
}

Write-Host "Running: bun run package:win"
bun run package:win

if ($LASTEXITCODE -ne 0) {
  throw "bun run package:win failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path $installerPath)) {
  throw "Installer was not created at $installerPath"
}

$installer = Get-Item $installerPath
Write-Host "Installer created successfully:"
Write-Host "  Path: $($installer.FullName)"
Write-Host "  Size: $($installer.Length) bytes"
Write-Host "  Modified: $($installer.LastWriteTime)"
