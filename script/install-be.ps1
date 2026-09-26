# ---------------------------------------------------------------------------
# OpenCode installer with Belarusian (be) locale  — Windows / PowerShell
#
# Builds the opencode CLI binary from source (embedding the Belarusian
# translation) and installs it to %USERPROFILE%\.opencode\bin, adding it to
# the user PATH.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File script\install-be.ps1
#   powershell -ExecutionPolicy Bypass -File script\install-be.ps1 -SkipBuild
# ---------------------------------------------------------------------------
param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$App = "opencode"
$BinName = "opencode.exe"
$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallDir = Join-Path $env:USERPROFILE ".opencode\bin"

function Write-Info($msg) { Write-Host "[be] $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "[ok] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[err] $msg" -ForegroundColor Red }

# 1. bun is required to build.
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Err "bun is required to build opencode. Install it first: https://bun.sh"
    exit 1
}

# 2. Verify Belarusian locale files exist.
$localeFiles = @(
    "packages\app\src\i18n\be.ts",
    "packages\ui\src\i18n\be.ts",
    "packages\desktop\src\renderer\i18n\be.ts"
)
foreach ($f in $localeFiles) {
    if (-not (Test-Path (Join-Path $RepoDir $f))) {
        Write-Err "Missing Belarusian locale: $f. Run script\be-locale-gen.py first."
        exit 1
    }
}
Write-Ok "Belarusian locale files present."

# 3. Build.
if (-not $SkipBuild) {
    Write-Info "Installing dependencies (bun install)…"
    Push-Location $RepoDir
    try { & bun install } finally { Pop-Location }

    Write-Info "Building opencode CLI binary…"
    Push-Location (Join-Path $RepoDir "packages\opencode")
    try { & bun run script/build.ts } finally { Pop-Location }
    Write-Ok "Build complete."
} else {
    Write-Info "Skipping build (-SkipBuild)."
}

# 4. Locate the binary.
$built = Join-Path $RepoDir "packages\opencode\bin\opencode.exe"
if (-not (Test-Path $built)) {
    # On non-Windows builds the extension may be absent.
    $built = Join-Path $RepoDir "packages\opencode\bin\opencode"
}
if (-not (Test-Path $built)) {
    Write-Err "Could not find the built binary. Run the build step first."
    exit 1
}

# 5. Install.
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Force $built (Join-Path $InstallDir $BinName)
Write-Ok "Installed $App to $InstallDir\$BinName"

# 6. Add to user PATH (persist for future shells).
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $InstallDir) {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $InstallDir } else { "$userPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Ok "Added $InstallDir to user PATH"
}

# 7. Verify.
$ver = & (Join-Path $InstallDir $BinName) --version 2>$null
Write-Ok "Installed version: $ver"
Write-Info "Done. Open a new terminal and run 'opencode' to start coding."
