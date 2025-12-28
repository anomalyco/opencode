<#
.SYNOPSIS
  Start the Tauri native app for development or build & run on Windows.

.DESCRIPTION
  This script helps you run Tauri in dev mode (opens a native window backed by Vite + Tauri) or build a native release and locate the produced EXE.
  It performs basic prerequisite checks (node, pnpm, and optionally Rust for builds) and runs the appropriate commands in packages/tauri.

.PARAMETER Build
  If provided the script will build web assets and then run `tauri build` to produce a native binary.

.PARAMETER Release
  When used with -Build, performs a release build (no-op here; kept for future extension).

.EXAMPLE
  .\tauri-run-windows.ps1
  Starts Tauri in dev mode.

  .\tauri-run-windows.ps1 -Build
  Builds the app and attempts to locate the produced EXE.
#>

[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$Release
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Check-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: '$name' is not found in PATH. Please install it and try again." -ForegroundColor Red
    return $false
  }
  return $true
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# repo root is parent of scripts/
$RepoRoot = Resolve-Path (Join-Path $ScriptRoot '.')
$TauriDir = Join-Path $RepoRoot 'packages\tauri'

Write-Host "Repository: $($RepoRoot)" -ForegroundColor Cyan
Write-Host "Tauri directory: $TauriDir" -ForegroundColor Cyan

if (-not (Check-Command 'node')) { exit 1 }

function Get-PackageManager($dir) {
  $pkg = Join-Path $dir 'package.json'
  if (-not (Test-Path $pkg)) { return 'pnpm' }
  try {
    $json = Get-Content $pkg -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($json.packageManager -match 'pnpm') { return 'pnpm' }
    if ($json.packageManager -match 'npm') { return 'npm' }
    if ($json.packageManager -match 'yarn') { return 'yarn' }
  } catch {
    return 'pnpm'
  }
  return 'pnpm'
}

$PM = Get-PackageManager $TauriDir
if (-not (Check-Command $PM)) { Write-Host "ERROR: Package manager '$PM' is not found in PATH." -ForegroundColor Red; exit 1 }

if ($Build) {
  # Building native requires Rust/cargo + build toolchain available
  Write-Host "Build mode: checking Rust toolchain..." -ForegroundColor Yellow
  if (-not (Check-Command 'rustup') -or -not (Check-Command 'cargo')) {
    Write-Host "Rust toolchain (rustup/cargo) not found. Install Rust (https://www.rust-lang.org/tools/install) to build native bundles." -ForegroundColor Yellow
  }
}

Push-Location $TauriDir
try {
  if (-not (Test-Path 'node_modules')) {
    Write-Host "Installing dependencies in packages/tauri..." -ForegroundColor Yellow
    & $PM install
  }

  if (-not $Build) {
    Write-Host "Starting Tauri in dev mode (this will open a native window)..." -ForegroundColor Green
    & $PM run tauri dev
  }
  else {
    Write-Host "Building web assets (vite build)..." -ForegroundColor Green
    & $PM run build

    Write-Host "Building native (tauri build)..." -ForegroundColor Green
    & $PM run tauri build

    Write-Host "Searching for produced EXE under src-tauri/target/release/bundle..." -ForegroundColor Green
    $exe = Get-ChildItem -Path .\src-tauri\target\release\bundle -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) {
      Write-Host "Built native executable: $($exe.FullName)" -ForegroundColor Cyan
      Write-Host "You can run it directly or right-click > Open to launch the app." -ForegroundColor Cyan
    }
    else {
      Write-Host "Build finished but could not locate an .exe in the expected bundle folder." -ForegroundColor Yellow
      Write-Host "Check the Tauri build output above for details." -ForegroundColor Yellow
    }
  }
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
finally {
  Pop-Location
}

Write-Host "Done." -ForegroundColor Green
