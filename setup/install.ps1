$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $PSCommandPath
$dest = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'securecode'

New-Item -ItemType Directory -Force -Path $dest | Out-Null

if (-not (Test-Path (Join-Path $dest 'tui.json'))) {
  Copy-Item (Join-Path $src 'tui.json.example') (Join-Path $dest 'tui.json')
  Write-Host "installed: $dest\tui.json"
} else {
  Write-Host "skipped (already exists): $dest\tui.json"
}

if (-not (Test-Path (Join-Path $dest 'securecode.json'))) {
  Copy-Item (Join-Path $src 'securecode.json.example') (Join-Path $dest 'securecode.json')
  Write-Host "installed: $dest\securecode.json"
  Write-Host ''
  Write-Host 'Next steps:'
  Write-Host '  1. set SECURECODE_QWEN3_API_KEY=<your Qwen3.6 API key from Acompany>'
  Write-Host '  2. SecureCode.exe run "Hello"'
} else {
  Write-Host "skipped (already exists): $dest\securecode.json"
}

New-Item -ItemType Directory -Force -Path (Join-Path $dest 'themes') | Out-Null
Get-ChildItem (Join-Path $src 'themes') -Filter '*.json' | ForEach-Object {
  $target = Join-Path $dest (Join-Path 'themes' $_.Name)
  if (-not (Test-Path $target)) {
    Copy-Item $_.FullName $target
    Write-Host "installed: $target"
    return
  }
  Write-Host "skipped (already exists): $target"
}
