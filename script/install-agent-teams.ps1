param(
  [string]$Workspace = (Split-Path -Parent $PSScriptRoot),
  [string]$ProjectDirectory = "F:\"
)

$ErrorActionPreference = "Stop"
$source = Join-Path $Workspace "packages\opencode\dist\opencode-windows-x64\bin\opencode.exe"
if (-not (Test-Path -LiteralPath $source)) {
  throw "Agent Teams binary not found. Run the single-platform OpenCode build first: $source"
}

$installDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "OpenCodeAgentTeams"
$destination = Join-Path $installDirectory "opencode-team.exe"
$desktop = [Environment]::GetFolderPath("Desktop")
$launcher = Join-Path $desktop "OpenCode Agent Teams - ProjectCombo.cmd"

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force

$content = @(
  "@echo off",
  "title OpenCode Agent Teams - ProjectCombo",
  "cd /d `"$ProjectDirectory`"",
  "`"$destination`" web --hostname 127.0.0.1 --port 4097",
  "if errorlevel 1 pause"
) -join "`r`n"
[System.IO.File]::WriteAllText($launcher, $content)

Write-Host "Installed: $destination"
Write-Host "Launcher:  $launcher"
Write-Host "The normal OpenCode installation was not changed."
