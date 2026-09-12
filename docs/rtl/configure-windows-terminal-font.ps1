# Adds an Arabic-capable font fallback chain to Windows Terminal so Arabic text
# renders with proper joining, while keeping your monospaced font for Latin/code.
#
# Windows Terminal honors a comma-separated `face` chain ("Cascadia Mono, Cairo");
# a `fallbacks` array is not a real setting and is ignored.
#
# The OpenCode bidi change handles ordering/alignment; this script only handles
# font selection, which is owned by the terminal, not by the application.
#
# Usage (defaults are safe and reversible):
#   powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1
#   powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1 -Face "Cascadia Mono"
#   powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1 -Fallbacks Cairo,"Noto Naskh Arabic","Segoe UI","Tahoma"
#
# A timestamped backup of settings.json is written next to it before any change.

param(
  [string]$Face,
  [string[]]$Fallbacks = @("Cairo", "Noto Naskh Arabic", "Segoe UI", "Tahoma"),
  [string]$SettingsPath
)

$ErrorActionPreference = "Stop"

$candidates = @(
  (Join-Path $env:LOCALAPPDATA "Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"),
  (Join-Path $env:LOCALAPPDATA "Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\Windows Terminal\settings.json")
)

$settingsPath = $SettingsPath
if (-not $settingsPath) {
  $settingsPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $settingsPath -or -not (Test-Path $settingsPath)) {
  throw "Windows Terminal settings.json not found. Install Windows Terminal or edit the font manually (see docs/rtl/fonts.md)."
}

Write-Host "Settings: $settingsPath"

# Report which requested fonts are actually installed.
$fontFiles = @()
foreach ($dir in @((Join-Path $env:WINDIR "Fonts"), (Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts"))) {
  if (Test-Path $dir) {
    $fontFiles += Get-ChildItem $dir -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
  }
}
foreach ($name in @($Fallbacks + @($Face)) | Where-Object { $_ } | Select-Object -Unique) {
  $needle = $name -replace "\s", "*"
  if ($fontFiles -like "*$needle*") {
    Write-Host "  installed: $name"
  } else {
    Write-Host "  NOT installed: $name (install it, or remove it from the fallback list)"
  }
}

$backup = "$settingsPath.rtl-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item -LiteralPath $settingsPath -Destination $backup -Force
Write-Host "Backup:   $backup"

$raw = Get-Content -LiteralPath $settingsPath -Raw
# Windows Terminal allows // comments; strip full-line comments so Windows
# PowerShell's JSON parser can read the file. Inline comments are left alone.
$cleaned = ($raw -split "`n" | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"

$json = $cleaned | ConvertFrom-Json

if (-not $json.profiles) {
  $json | Add-Member -NotePropertyName profiles -NotePropertyValue ([pscustomobject]@{}) -Force
}
if (-not $json.profiles.defaults) {
  $json.profiles | Add-Member -NotePropertyName defaults -NotePropertyValue ([pscustomobject]@{}) -Force
}
if (-not $json.profiles.defaults.font) {
  $json.profiles.defaults | Add-Member -NotePropertyName font -NotePropertyValue ([pscustomobject]@{}) -Force
}

# Build the comma-separated face chain: requested main face first, then the
# faces already configured (never reordered), then the Arabic fallbacks.
$chain = @()
if ($Face) { $chain += $Face }
$existingFace = $json.profiles.defaults.font.face
if ($existingFace) {
  $chain += ("$existingFace" -split "," | ForEach-Object { $_.Trim().Trim("'").Trim('"') } | Where-Object { $_ })
}
if ($chain.Count -eq 0) { $chain += "Cascadia Mono" }
foreach ($name in @($Fallbacks) | Where-Object { $_ }) {
  if ($chain -notcontains $name) { $chain += $name }
}
$json.profiles.defaults.font | Add-Member -NotePropertyName face -NotePropertyValue ($chain -join ", ") -Force
$json.profiles.defaults.font.PSObject.Properties.Remove("fallbacks")

$output = $json | ConvertTo-Json -Depth 64
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($settingsPath, $output, $utf8)

Write-Host ""
Write-Host "Updated profiles.defaults.font:"
Write-Host ("  face = " + ($chain -join ", "))
Write-Host ""
Write-Host "Restart Windows Terminal to apply. To undo, copy the backup over settings.json."
