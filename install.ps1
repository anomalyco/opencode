#Requires -Version 5.1
<#
.SYNOPSIS
    Gentle OpenCode — Installer for Windows
    Installs opencode-fork + gentle-ai in one step.

.DESCRIPTION
    Downloads the latest opencode-fork and gentle-ai binaries from GitHub,
    installs them, adds them to PATH, and runs gentle-ai's agent setup.

.EXAMPLE
    irm https://github.com/YOUR_USER/opencode-fork/releases/latest/download/install.ps1 | iex

.PARAMETER Version
    Specific opencode version to install (e.g., "1.0.180")

.PARAMETER NoModifyPath
    Skip adding directories to the User PATH

.PARAMETER Channel
    gentle-ai channel: stable (default), beta, nightly

.PARAMETER UseMirror
    Download opencode from Nextcloud mirror instead of GitHub
#>

$ErrorActionPreference = "Stop"

$null = & chcp 65001 2>$null
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ─── Configuration ─────────────────────────────────────────────────────────

$OPENCODE_REPO = "ivanfernadezm99/opencode"
$GENTLE_REPO = "Gentleman-Programming/gentle-ai"
$BINARY_NAME = "opencode"
$GENTLE_NAME = "gentle-ai"

$NEXTCLOUD_MIRROR = "https://enlaceschacocloud.duckdns.org/s/ojAcbHDQBTX97oD/download"

$OPENCODE_DIR = Join-Path $env:LOCALAPPDATA "opencode\bin"
$GENTLE_DIR = Join-Path $env:LOCALAPPDATA "gentle-ai\bin"

# ─── Colors / Logging ──────────────────────────────────────────────────────

function Write-Info    { param([string]$Message) Write-Host "  $Message" -ForegroundColor Blue }
function Write-Success { param([string]$Message) Write-Host "  $Message" -ForegroundColor Green }
function Write-Warn    { param([string]$Message) Write-Host "  $Message" -ForegroundColor Yellow }
function Write-Err     { param([string]$Message) Write-Host "  $Message" -ForegroundColor Red }
function Write-Step    { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Stop-WithError {
    param([string]$Message)
    Write-Err $Message
    exit 1
}

# ─── Banner ─────────────────────────────────────────────────────────────────

function Show-Banner {
    Write-Host ""
    Write-Host "   ____            _   _              _    ___ " -ForegroundColor Cyan
    Write-Host "  / ___| ___ _ __ | |_| | ___        / \  |_ _|" -ForegroundColor Cyan
    Write-Host " | |  _ / _ \ '_ \| __| |/ _ \_____ / _ \  | | " -ForegroundColor Cyan
    Write-Host " | |_| |  __/ | | | |_| |  __/_____/ ___ \ | | " -ForegroundColor Cyan
    Write-Host "  \____|\___|_| |_|\__|_|\___|    /_/   \_\___|" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Gentle OpenCode Installer - Windows" -ForegroundColor DarkGray
    Write-Host ""
}

# ─── Platform ───────────────────────────────────────────────────────────────

function Get-Arch {
    if (-not [Environment]::Is64BitOperatingSystem) {
        Stop-WithError "32-bit Windows is not supported."
    }
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { return "arm64" }
    return "amd64"
}

# ─── GitHub Latest Version ─────────────────────────────────────────────────

function Get-LatestVersion {
    param([string]$Repo)

    Write-Info "Fetching latest release from $Repo..."
    $url = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "gentle-opencode-installer" }
    } catch {
        Stop-WithError "Failed to fetch latest release from $Repo.`n$_"
    }

    $version = $response.tag_name
    if (-not $version) {
        Stop-WithError "Could not determine latest version from $Repo"
    }
    Write-Success "Latest: $version"
    return $version
}

# ─── Download Binary ───────────────────────────────────────────────────────

function Install-Binary {
    param(
        [string]$Repo,
        [string]$OutputDir,
        [string]$AssetName,
        [string]$BinaryName,
        [bool]$NeedsExtract = $true,
        [string]$MirrorUrl = "",
        [string]$Version = ""
    )

    $arch = Get-Arch

    if ($MirrorUrl) {
        if ($Version) {
            $archiveName = "${BinaryName}_$($Version -replace '^v','')_windows_${arch}.zip"
        } else {
            $archiveName = "${BinaryName}_windows_${arch}.zip"
        }
        $downloadUrl = "${MirrorUrl}?path=/&files=${archiveName}"
        Write-Info "Using mirror: $MirrorUrl"
    } else {
        $version = Get-LatestVersion -Repo $Repo
        $versionNumber = $version.TrimStart("v")
        $archiveName = "${BinaryName}_${versionNumber}_windows_${arch}.zip"
        $downloadUrl = "https://github.com/$Repo/releases/download/$version/$archiveName"
    }

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

    $tmpDir = Join-Path $env:TEMP "gentle-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        Write-Info "Downloading $archiveName..."
        $archivePath = Join-Path $tmpDir $archiveName
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing

        $fileSize = (Get-Item $archivePath).Length
        if ($fileSize -lt 1000) {
            Stop-WithError "Downloaded file is suspiciously small (${fileSize} bytes)."
        }
        Write-Success "Downloaded ($([math]::Round($fileSize / 1KB)) KB)"

        if ($NeedsExtract) {
            Expand-Archive -Path $archivePath -DestinationPath $tmpDir -Force
            $binaryPath = Join-Path $tmpDir "$BinaryName.exe"
        } else {
            $binaryPath = $archivePath
        }

        if (-not (Test-Path $binaryPath)) {
            # Try with .exe extension
            $binaryPath = Join-Path $tmpDir "$BinaryName.exe"
            if (-not (Test-Path $binaryPath)) {
                Stop-WithError "Binary '$BinaryName.exe' not found in archive"
            }
        }

        $destPath = Join-Path $OutputDir "$BinaryName.exe"
        Write-Info "Installing to $destPath..."
        Copy-Item -Path $binaryPath -Destination $destPath -Force
        Write-Success "Installed $BinaryName"

        return $destPath
    }
    finally {
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ─── PATH Management ───────────────────────────────────────────────────────

function Add-ToUserPath {
    param([string]$Dir)

    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $pathEntries = if ($userPath) { $userPath -split ';' | Where-Object { $_ -ne '' } } else { @() }
    $alreadyPresent = $pathEntries | Where-Object { $_.TrimEnd('\') -ieq $Dir.TrimEnd('\') }

    if (-not $alreadyPresent) {
        $newUserPath = if ($userPath) { "$userPath;$Dir" } else { $Dir }
        [Environment]::SetEnvironmentVariable("PATH", $newUserPath, "User")
        Write-Success "Added $Dir to PATH (takes effect in new shells)"
    }

    # Also set for current session
    $sessionEntries = $env:PATH -split ';' | Where-Object { $_ -ne '' }
    $sessionPresent = $sessionEntries | Where-Object { $_.TrimEnd('\') -ieq $Dir.TrimEnd('\') }
    if (-not $sessionPresent) {
        $env:PATH = "$env:PATH;$Dir"
    }
}

# ─── Main ───────────────────────────────────────────────────────────────────

function Main {
    [CmdletBinding()]
    param(
        [string]$Version = "",
        [string]$Channel = $(if ($env:GENTLE_AI_CHANNEL) { $env:GENTLE_AI_CHANNEL } else { "stable" }),
        [switch]$NoModifyPath,
        [switch]$UseMirror
    )

    if ($Channel -eq "nightly") { $Channel = "beta" }

    # Resolve version early (needed for mirror download filenames)
    if (-not $Version) {
        $Version = Get-LatestVersion -Repo $OPENCODE_REPO
    }

    Show-Banner

    # ─── Prerequisites ──────────────────────────────────────────────────────

    Write-Step "Checking prerequisites"

    $missing = @()
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        $null = & git --version 2>$null
        if ($LASTEXITCODE -ne 0 -and -not (Get-Command git -ErrorAction SilentlyContinue)) {
            $missing += "git"
        }
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $null = & node --version 2>$null
        if ($LASTEXITCODE -ne 0 -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
            $missing += "node"
        }
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        $null = & npm --version 2>$null
        if ($LASTEXITCODE -ne 0 -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
            $missing += "npm"
        }
    }

    if ($missing.Count -gt 0) {
        Write-Warn "Missing: $($missing -join ', ')"
        Write-Info "gentle-ai needs git, node, and npm to install skills and plugins."

        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Info "Attempting auto-install via winget..."
            foreach ($tool in $missing) {
                switch ($tool) {
                    "git" {
                        Write-Info "Installing Git..."
                        winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements
                    }
                    "node" {
                        Write-Info "Installing Node.js (LTS)..."
                        winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
                    }
                    "npm" {
                        Write-Info "npm is bundled with Node.js — will be available after Node install"
                    }
                }
            }
            Write-Warn "Prerequisites were just installed. Restart your terminal and re-run this installer."
            Write-Host ""
            Write-Host "  1. Close this window" -ForegroundColor Cyan
            Write-Host "  2. Open a NEW PowerShell as Administrator" -ForegroundColor Cyan
            Write-Host "  3. Re-run: irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1 | iex" -ForegroundColor DarkGray
            Write-Host ""
            exit 0
        } else {
            Write-Err "winget not found. Please install manually:"
            Write-Host ""
            Write-Host "  Git:      https://git-scm.com/download/win" -ForegroundColor Cyan
            Write-Host "  Node.js:  https://nodejs.org/ (LTS)" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  After installing, OPEN A NEW TERMINAL and re-run the installer." -ForegroundColor Yellow
            Write-Host ""
            exit 1
        }
    }
    Write-Success "git, node, npm — all present"

    Write-Step "Installing opencode-fork"
    if ($UseMirror) {
        Write-Info "Downloading from Nextcloud mirror..."
        Install-Binary -Repo $OPENCODE_REPO -OutputDir $OPENCODE_DIR -AssetName "opencode" -BinaryName "opencode" -MirrorUrl $NEXTCLOUD_MIRROR -Version $Version
    } else {
        Install-Binary -Repo $OPENCODE_REPO -OutputDir $OPENCODE_DIR -AssetName "opencode" -BinaryName "opencode"
    }

    Write-Step "Installing gentle-ai"
    Install-Binary -Repo $GENTLE_REPO -OutputDir $GENTLE_DIR -AssetName "gentle-ai" -BinaryName "gentle-ai"

    Write-Step "Setting up PATH"
    if (-not $NoModifyPath) {
        Add-ToUserPath -Dir $OPENCODE_DIR
        Add-ToUserPath -Dir $GENTLE_DIR
    }

    Write-Step "Backing up Engram database (if exists)"
    $engramDbDir = Join-Path $env:USERPROFILE ".engram"
    $engramDbPath = Join-Path $engramDbDir "engram.db"
    if (Test-Path $engramDbPath) {
        $backupName = "engram.db.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        $backupPath = Join-Path $engramDbDir $backupName
        Copy-Item -Path $engramDbPath -Destination $backupPath -Force
        $dbSize = (Get-Item $engramDbPath).Length
        Write-Success "Backed up engram.db ($([math]::Round($dbSize / 1KB)) KB) -> $backupName"
    } else {
        Write-Info "No existing engram.db found — fresh install"
    }

    Write-Step "Configuring gentle-ai for opencode"
    $gentleExe = Join-Path $GENTLE_DIR "gentle-ai.exe"
    if (Test-Path $gentleExe) {
        Write-Info "This may take a minute -- downloading skills, agents, and tools..."
        $envPath = $env:GENTLE_AI_CHANNEL
        if ($Channel -ne "stable") {
            $env:GENTLE_AI_CHANNEL = $Channel
        }
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $gentleExe
            $psi.Arguments = "install --agent opencode"
            $psi.UseShellExecute = $false
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            $stdout = $proc.StandardOutput.ReadToEnd()
            $stderr = $proc.StandardError.ReadToEnd()
            $proc.WaitForExit()
            $output = "$stdout`n$stderr"
            if ($proc.ExitCode -ne 0) {
                Write-Warn "gentle-ai install exited with code $($proc.ExitCode)"
                if ($output.Trim()) { Write-Host $output -ForegroundColor DarkGray }
                Write-Warn "You can run 'gentle-ai install --agent opencode' manually later."
            } else {
                Write-Success "gentle-ai configured opencode agent"
                if ($output.Trim()) { Write-Host $output -ForegroundColor DarkGray }
            }
        }
        catch {
            Write-Warn "gentle-ai install error: $_"
            Write-Warn "You can run 'gentle-ai install --agent opencode' manually later."
        }
        finally {
            $ErrorActionPreference = $prevEA
            $env:GENTLE_AI_CHANNEL = $envPath
        }
    }

    Write-Step "Linking config for desktop app"
    $desktopAppId = "ai.opencode.desktop.dev"
    $desktopConfig = Join-Path $env:APPDATA "$desktopAppId\config\opencode"
    $globalConfig = Join-Path $env:USERPROFILE ".config\opencode"
    if (Test-Path $globalConfig) {
        if (-not (Test-Path $desktopConfig)) {
            New-Item -ItemType Directory -Path $desktopConfig -Force | Out-Null
        }
        Copy-Item -Path "$globalConfig\*" -Destination $desktopConfig -Recurse -Force
        Write-Success "Desktop app config linked"
    } else {
        Write-Warn "No global config found — desktop app may need manual setup"
    }

    Write-Step "Verifying installation"
    $opencodeExe = Join-Path $OPENCODE_DIR "opencode.exe"
    if (Test-Path $opencodeExe) {
        try {
            $ver = & $opencodeExe --version 2>&1
            Write-Success "opencode: $ver"
        } catch {
            Write-Warn "Could not verify opencode version"
        }
    }

    if (Test-Path $gentleExe) {
        try {
            $ver = & $gentleExe version 2>&1
            Write-Success "gentle-ai: $ver"
        } catch {
            Write-Warn "Could not verify gentle-ai version"
        }
    }

    Write-Host ""
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next step:" -ForegroundColor White
    Write-Host "  Set your API key:" -ForegroundColor Cyan
    Write-Host '    $env:OPENCODE_API_KEY = "your-api-key"' -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Then open a project:" -ForegroundColor Cyan
    Write-Host "    opencode" -ForegroundColor White
    Write-Host ""
    Write-Host "  Press Tab to switch between agents:" -ForegroundColor Cyan
    Write-Host "    gentle-orchestrator  (SDD workflow)" -ForegroundColor DarkGray
    Write-Host "    Default              (standard chat)" -ForegroundColor DarkGray
    Write-Host ""
}

Main @args
