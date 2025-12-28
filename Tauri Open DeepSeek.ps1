<#
.SYNOPSIS
  "Tauri Open DeepSeek" — Consolidated Tauri system tools (dev, build, sidecar copy, smoke & installer tests)
.DESCRIPTION
  Single entry script that replaces the multiple Tauri helper scripts. Use the -Action parameter
  or run interactively to perform tasks such as dev, build, copy-sidecar, smoke-exe, smoke-installer,
  install-and-test, and cleanup.

USAGE
  .\"Tauri Open DeepSeek.ps1" -Action dev
  .\"Tauri Open DeepSeek.ps1" -Action build
  .\"Tauri Open DeepSeek.ps1" -Action smoke-exe
  .\"Tauri Open DeepSeek.ps1" -Action smoke-installer
  .\"Tauri Open DeepSeek.ps1" -Action install-and-test -Silent

PARAMETERS
  -Action <string>       One of: help, dev, build, copy-sidecar, smoke-exe, smoke-installer, install-and-test, run-exe, cleanup
  -Exe <string>          Path to exe for smoke/run actions (optional)
  -Seconds <int>        Seconds to wait for smoke run (default 6)
  -Silent               Run installer with /S where supported
  -NoCleanup            For smoke-installer, don't remove temp install folder
  -KeepAlive            For run-exe, leave launched process running
#>

param(
  [string]$Action = 'help',
  [string]$Exe,
  [int]$Seconds = 6,
  [switch]$Silent,
  [switch]$NoCleanup,
  [switch]$KeepAlive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Timestamp { (Get-Date).ToString('HH:mm:ss') }
function Write-Log([string]$Level, [string]$Msg) {
  $color = switch ($Level.ToUpper()) { 'OK' { 'Green' } 'WARN' { 'Yellow' } 'ERROR' { 'Red' } default { 'Cyan' } }
  Write-Host "[$(Get-Timestamp)] [$Level] $Msg" -ForegroundColor $color
}

# Cleanup helpers
function Stop-AllProcesses {
  param([string[]]$Names = @('cargo','rustc','node','vite','Open DeepSeek'))
  Write-Log 'INFO' 'Stopping lingering processes if any...'
  foreach ($n in $Names) {
    try {
      # Use a safe approach that enumerates processes and matches ProcessName to avoid errors caused by spaces
      Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like ("*$n*") -or $_.ProcessName -like ("$n*") } | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }
    } catch {}
  }
} 
try { Register-EngineEvent PowerShell.Exiting -Action { Stop-AllProcesses } | Out-Null } catch { Write-Log 'WARN' 'Could not register exit handler (Register-EngineEvent failed).' }

$RepoRoot = (Get-Location).Path
$TauriDir = Join-Path $RepoRoot 'packages\tauri'
$SidecarDest = Join-Path $TauriDir 'src-tauri\sidecars'

function Get-PackageManager($dir) {
  $pkg = Join-Path $dir 'package.json'
  if (-not (Test-Path $pkg)) { return 'pnpm' }
  try { $json = Get-Content $pkg -Raw | ConvertFrom-Json; if ($json.packageManager -match 'pnpm') { 'pnpm' } elseif ($json.packageManager -match 'npm') { 'npm' } else { 'pnpm' } } catch { 'pnpm' }
}

function Copy-Sidecars {
  Write-Log 'INFO' 'Looking for opentui.dll in node_modules caches...'
  if (-not (Test-Path $SidecarDest)) { New-Item -ItemType Directory -Path $SidecarDest | Out-Null }

  $candidates = @(
    "$RepoRoot\node_modules\\.pnpm",
    "$RepoRoot\node_modules\\.bun",
    "$RepoRoot\node_modules"
  )
  $found = $null
  foreach ($p in $candidates) {
    if (-not (Test-Path $p)) { continue }
    try {
      $c = Get-ChildItem -Path $p -Recurse -Filter 'opentui.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($c) { $found=$c.FullName; break }
    } catch {
    }
  }

  if (-not $found) { Write-Log 'WARN' 'opentui.dll not found in node_modules caches.'; return $false }
  $dest = Join-Path $SidecarDest 'opentui.dll'
  Copy-Item -LiteralPath $found -Destination $dest -Force
  Write-Log 'OK' "Copied opentui.dll -> $dest"
  return $true
}

function Start-Dev {
  Write-Log 'INFO' 'Starting Tauri in dev mode...'
  Push-Location $TauriDir
  try {
    $PM = Get-PackageManager $TauriDir
    if (-not (Test-Path 'node_modules')) { Write-Log 'INFO' "Installing dependencies with $PM..."; & $PM install }
    & $PM run tauri dev
  } finally { Pop-Location }
}

function Do-Build {
  Write-Log 'INFO' 'Preparing build: copying sidecars and building web assets and native bundle...'
  Copy-Sidecars | Out-Null
  Push-Location $TauriDir
  try {
    $PM = Get-PackageManager $TauriDir
    if (-not (Test-Path 'node_modules')) { Write-Log 'INFO' "Installing dependencies with $PM..."; & $PM install }
    Write-Log 'INFO' 'Building web assets...'
    & $PM run build
    Write-Log 'INFO' 'Running tauri build...'
    & $PM run tauri build

    # Ensure sidecar is also placed next to the produced exe so the runtime can find it when extracting to a temp root
    try {
      $releaseDir = Join-Path $TauriDir 'src-tauri\target\release'
      $sidecar = Join-Path $SidecarDest 'opentui.dll'
      if ((Test-Path $sidecar) -and (Test-Path $releaseDir)) {
        Copy-Item -LiteralPath $sidecar -Destination $releaseDir -Force
        Write-Log 'OK' "Copied sidecar to release dir: $releaseDir\opentui.dll"
      } else {
        Write-Log 'WARN' 'Sidecar or release dir missing; skipping copy-to-release.'
      }

      # Also copy into any bundle/named output folders (so NSIS packages it reliably)
      $bundleOut = Join-Path $releaseDir 'bundle'
      if (Test-Path $bundleOut) {
        Get-ChildItem -Path $bundleOut -Recurse -Directory -ErrorAction SilentlyContinue | ForEach-Object {
          try { Copy-Item -LiteralPath $sidecar -Destination $_.FullName -Force -ErrorAction SilentlyContinue; Write-Log 'OK' "Copied sidecar into bundle folder: $($_.FullName)" } catch {}
        }
      }
    } catch { Write-Log 'WARN' "Post-build sidecar copy encountered an error: $($_.Exception.Message)" }
  } finally { Pop-Location }
}

function Find-Exe {
  param([string]$candidate)
  if ($candidate -and (Test-Path $candidate)) { return (Resolve-Path $candidate).Path }
  $paths = @( (Join-Path $TauriDir 'src-tauri\target\release\Open DeepSeek.exe'), (Join-Path $TauriDir 'src-tauri\target\release\bundle') )
  foreach ($p in $paths) {
    if (-not (Test-Path $p)) { continue }
    try { $e = Get-ChildItem -Path $p -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Open.?DeepSeek' } | Select-Object -First 1; if ($e) { return $e.FullName } } catch {}
  }
  return $null
}

function Smoke-Exe {
  param([string]$exePath, [int]$wait=6)
  $exe = Find-Exe -candidate $exePath
  if (-not $exe) { Write-Log 'ERROR' 'Built exe not found. Build first.'; return 2 }
  Write-Log 'INFO' "Starting exe: $exe"
  $p = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds $wait
  if (-not $p.HasExited) { Write-Log 'WARN' 'Process still running, stopping now'; Stop-Process -Id $p.Id -Force } else { Write-Log 'OK' "Process exited with code $($p.ExitCode)" }
  return 0
}

function Smoke-Installer {
  param([switch]$NoCleanup)
  $pattern = Join-Path $TauriDir 'src-tauri\target\release\bundle\nsis\*.exe'
  $installer = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'setup|Open.*DeepSeek' } | Select-Object -First 1
  if (-not $installer) { Write-Log 'ERROR' 'Installer not found; run build first.'; return 2 }
  $temp = Join-Path $env:TEMP ('opendeepseek-install-' + (Get-Random -Maximum 100000))
  New-Item -ItemType Directory -Path $temp | Out-Null
  $args = "/S /D=$temp"
  Write-Log 'INFO' "Running installer silently (if supported) -> $installer"
  Start-Process -FilePath $installer.FullName -ArgumentList $args -Wait -NoNewWindow
  # find installed exe
  $installed = Get-ChildItem -Path $temp -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Open.?DeepSeek' } | Select-Object -First 1
  if (-not $installed) { Write-Log 'ERROR' "Could not find installed exe under $temp"; if (-not $NoCleanup) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue } ; return 3 }
  Write-Log 'INFO' "Found installed exe: $($installed.FullName)"
  $p = Start-Process -FilePath $installed.FullName -PassThru
  Start-Sleep -Seconds $Seconds
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  if (-not $NoCleanup) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue; Write-Log 'INFO' 'Cleaned up temp install dir.' }
  return 0
}

function Install-And-Test {
  param([switch]$Silent)
  $pattern = Join-Path $TauriDir 'src-tauri\target\release\bundle\nsis\*.exe'
  $installer = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'setup|Open.*DeepSeek' } | Select-Object -First 1
  if (-not $installer) { Write-Log 'ERROR' 'Installer not found; run build first.'; return 2 }
  if ($Silent) { Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait } else { Start-Process -FilePath $installer.FullName -Wait }
  Write-Log 'INFO' 'Installer finished. Searching for installed app in common locations...'
  $cands = @("$env:ProgramFiles\Open DeepSeek\Open DeepSeek.exe","$env:ProgramFiles(x86)\Open DeepSeek\Open DeepSeek.exe","$env:LOCALAPPDATA\Programs\Open DeepSeek\Open DeepSeek.exe")
  foreach ($c in $cands) { if (Test-Path $c) { Write-Log 'OK' "Found installed exe: $c"; $p=Start-Process -FilePath $c -PassThru; Start-Sleep -Seconds $Seconds; if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }; return 0 } }
  Write-Log 'WARN' 'Could not find installed exe in common locations.'; return 3
}

function Show-Help {
  Write-Host "Tauri Open DeepSeek — actions: help, dev, build, copy-sidecar, smoke-exe, smoke-installer, install-and-test, run-exe, cleanup" -ForegroundColor Cyan
  Write-Host "Examples: .\'Tauri Open DeepSeek.ps1' -Action dev" -ForegroundColor Cyan
}

function Normalize-ExitCode([object]$v) {
  if ($v -is [bool]) { if ($v) { return 0 } else { return 1 } }
  if ($v -eq $null) { return 0 }
  try { return [int]$v } catch { return 0 }
}

# Main dispatch
$actionVal = $Action; if (-not $actionVal) { $actionVal = '' }
switch ($actionVal.ToLower()) {
  'help' { Show-Help; exit 0 }
  'dev' { $rc = Start-Dev; $rc = Normalize-ExitCode $rc; exit $rc }
  'build' { $rc = Do-Build; $rc = Normalize-ExitCode $rc; exit $rc }
  'copy-sidecar' { $rc = Copy-Sidecars; $rc = Normalize-ExitCode $rc; exit $rc }
  'smoke-exe' { $rc = Smoke-Exe -exePath $Exe -wait $Seconds; $rc = Normalize-ExitCode $rc; exit $rc }
  'smoke-installer' { $rc = Smoke-Installer -NoCleanup:$NoCleanup; $rc = Normalize-ExitCode $rc; exit $rc }
  'install-and-test' { $rc = Install-And-Test -Silent:$Silent; $rc = Normalize-ExitCode $rc; exit $rc }
  'run-exe' { if ($Exe) { $p = Start-Process -FilePath $Exe -PassThru; if (-not $KeepAlive) { Start-Sleep -Seconds $Seconds; Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe -or $_.Name -eq (Split-Path $Exe -Leaf) } | ForEach-Object { Stop-Process -Id $_.Id -Force } } ; exit 0 } else { Write-Log 'ERROR' 'Provide -Exe for run-exe'; exit 2 } }
  'cleanup' { Stop-AllProcesses; exit 0 }
  default { Show-Help; exit 2 }
}
