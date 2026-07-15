#Requires -Version 5.1
<#
.SYNOPSIS
    Gentle OpenCode -- Installer for Windows
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

# --- Configuration ---------------------------------------------------------

$OPENCODE_REPO = "ivanfernadezm99/opencode"
$GENTLE_REPO = "Gentleman-Programming/gentle-ai"
$BINARY_NAME = "opencode"
$GENTLE_NAME = "gentle-ai"

$NEXTCLOUD_MIRROR = "https://enlaceschacocloud.duckdns.org/public.php/webdav"
$NEXTCLOUD_TOKEN = "ojAcbHDQBTX97oD"
$FALLBACK_VERSION = "v1.0.11"

$OPENCODE_DIR = Join-Path $env:LOCALAPPDATA "opencode\bin"
$GENTLE_DIR = Join-Path $env:LOCALAPPDATA "gentle-ai\bin"

# --- Colors / Logging ------------------------------------------------------

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

# --- Banner -----------------------------------------------------------------

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

# --- Platform ---------------------------------------------------------------

function Get-Arch {
    if (-not [Environment]::Is64BitOperatingSystem) {
        Stop-WithError "32-bit Windows is not supported."
    }
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { return "arm64" }
    return "amd64"
}

# --- Version Detection ------------------------------------------------------

function Get-LatestVersion {
    param([string]$Repo)

    Write-Info "Checking $Repo..."

    # Method 1: HTTP redirect (no rate limit)
    $url = "https://github.com/$Repo/releases/latest"
    try {
        $response = Invoke-WebRequest -Uri $url -MaximumRedirection 0 -ErrorAction Stop `
            -UseBasicParsing -Headers @{ "User-Agent" = "gentle-opencode-installer" }
    } catch {
        $response = $_.Exception.Response
    }

    if ($response -and $response.StatusCode -eq 302 -and $response.Headers["Location"]) {
        $location = $response.Headers["Location"]
        if ($location -match '/tag/(v[\d.]+)') {
            $version = $matches[1]
            Write-Success "Latest: $version"
            return $version
        }
    }

    # Method 2: API fallback
    Write-Warn "Redirect failed, trying API..."
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $apiResponse = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "gentle-opencode-installer" }
        $version = $apiResponse.tag_name
        if ($version) {
            Write-Success "Latest: $version"
            return $version
        }
    } catch {
        Write-Warn "GitHub API also failed."
    }

    return $null
}

function Get-LatestFromNextcloud {
    Write-Info "Checking Nextcloud for latest version..."

    try {
        $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${NEXTCLOUD_TOKEN}:"))
        $response = Invoke-WebRequest -Uri $NEXTCLOUD_MIRROR -Method PROPFIND `
            -UseBasicParsing -TimeoutSec 10 `
            -Headers @{ "Authorization" = "Basic $auth" }
    } catch {
        Write-Warn "Cannot reach Nextcloud mirror."
        return $null
    }

    # Extract versions from opencode_X.Y.Z_windows_amd64.zip filenames
    $highest = $null
    $highestVer = [version]"0.0.0"
    $matches = [regex]::Matches($response.Content, 'opencode_([\d.]+)_windows_amd64\.zip')
    foreach ($m in $matches) {
        $v = $m.Groups[1].Value
        try {
            $parsed = [version]$v
            if ($parsed -gt $highestVer) {
                $highestVer = $parsed
                $highest = "v$v"
            }
        } catch {}
    }

    if ($highest) {
        Write-Success "Nextcloud mirror has: $highest"
        return $highest
    }
    Write-Warn "No opencode versions found on mirror."
    return $null
}

# --- Download Binary -------------------------------------------------------

function Download-WithRetry {
    param([string]$Url, [string]$OutFile, [int]$MaxRetries = 3, [hashtable]$Headers = @{})

    for ($i = 1; $i -le $MaxRetries; $i++) {
        try {
            if ($i -gt 1) {
                $wait = [math]::Pow(2, $i)
                Write-Warn "Retry $i/$MaxRetries in ${wait}s..."
                Start-Sleep -Seconds $wait
            }
            $iwrParams = @{
                Uri = $Url
                OutFile = $OutFile
                UseBasicParsing = $true
                TimeoutSec = 300
            }
            if ($Headers.Count -gt 0) {
                $iwrParams.Headers = $Headers
            }
            Invoke-WebRequest @iwrParams
            return $true
        } catch {
            Write-Warn "Download attempt $i failed: $_"
        }
    }
    return $false
}

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

    # Build primary URL
    $mirrorHeaders = @{}
    if ($MirrorUrl) {
        $versionNumber = $Version -replace '^v',''
        $archiveName = "${BinaryName}_${versionNumber}_windows_${arch}.zip"
        $downloadUrl = "$MirrorUrl/$archiveName"
        $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${NEXTCLOUD_TOKEN}:"))
        $mirrorHeaders = @{ "Authorization" = "Basic $auth" }
        Write-Info "Using mirror: Nextcloud"
    } else {
        $versionNumber = $Version -replace '^v',''
        $archiveName = "${BinaryName}_${versionNumber}_windows_${arch}.zip"
        $downloadUrl = "https://github.com/$Repo/releases/download/$Version/$archiveName"
    }

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

    $tmpDir = Join-Path $env:TEMP "gentle-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        Write-Info "Downloading $archiveName..."
        $archivePath = Join-Path $tmpDir $archiveName

        # Try primary download
        $ok = Download-WithRetry -Url $downloadUrl -OutFile $archivePath -Headers $mirrorHeaders

        # If primary fails and we're not already on mirror, try Nextcloud
        if (-not $ok -and -not $MirrorUrl -and $BinaryName -eq "opencode" -and $Version) {
            Write-Warn "GitHub download failed. Trying Nextcloud mirror..."
            $mirrorDownloadUrl = "$NEXTCLOUD_MIRROR/$archiveName"
            $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${NEXTCLOUD_TOKEN}:"))
            $ok = Download-WithRetry -Url $mirrorDownloadUrl -OutFile $archivePath -Headers @{ "Authorization" = "Basic $auth" }
        }

        if (-not $ok) {
            Stop-WithError "Failed to download $archiveName after all attempts."
        }

        $fileSize = (Get-Item $archivePath).Length
        if ($fileSize -lt 1000) {
            Stop-WithError "Downloaded file is suspiciously small (${fileSize} bytes)."
        }
        Write-Success "Downloaded ($([math]::Round($fileSize / 1MB, 1)) MB)"

        if ($NeedsExtract) {
            Write-Info "Extracting..."
            Expand-Archive -Path $archivePath -DestinationPath $tmpDir -Force
            $binaryPath = Join-Path $tmpDir "$BinaryName.exe"
        } else {
            $binaryPath = $archivePath
        }

        if (-not (Test-Path $binaryPath)) {
            $binaryPath = Join-Path $tmpDir "$BinaryName.exe"
            if (-not (Test-Path $binaryPath)) {
                Stop-WithError "Binary '$BinaryName.exe' not found in archive"
            }
        }

        $destPath = Join-Path $OutputDir "$BinaryName.exe"
        Write-Info "Installing to $destPath..."
        Copy-Item -Path $binaryPath -Destination $destPath -Force
        Write-Success "Installed $BinaryName $Version"

        return $destPath
    }
    finally {
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- PATH Management -------------------------------------------------------

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

# --- Orphaned Shortcut Cleanup ---------------------------------------------

function Clear-OrphanedShortcuts {
    <#
    .SYNOPSIS
        Remove orphaned OpenCode and oneinfo shortcuts whose target no longer exists.
    #>
    $WScriptShell = $null
    try {
        $WScriptShell = New-Object -ComObject WScript.Shell
    } catch {
        Write-Warn "Cannot create WScript.Shell COM object -- skipping shortcut cleanup"
        return
    }

    $locations = @(
        @{ Path = "$env:USERPROFILE\Desktop";                                                    Label = "User Desktop" }
        @{ Path = "$env:PUBLIC\Desktop";                                                          Label = "Public Desktop" }
        @{ Path = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs";                            Label = "Start Menu" }
        @{ Path = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar";    Label = "Taskbar" }
    )

    $cleaned = 0
    foreach ($loc in $locations) {
        if (-not (Test-Path $loc.Path)) { continue }

        $shortcuts = Get-ChildItem -Path $loc.Path -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*OpenCode*" -or $_.Name -like "*oneinfo*" }

        foreach ($sc in $shortcuts) {
            try {
                $shellLink = $WScriptShell.CreateShortcut($sc.FullName)
                $target = $shellLink.TargetPath
            } catch {
                continue
            }

            $isOrphan = [string]::IsNullOrWhiteSpace($target) -or (-not (Test-Path $target))
            if (-not $isOrphan) { continue }

            Remove-Item -Path $sc.FullName -Force -ErrorAction SilentlyContinue
            Write-Info "Cleaned orphaned shortcut: $($sc.Name)"
            $cleaned++
        }
    }

    if ($cleaned -gt 0) {
        Write-Success "Removed $cleaned orphaned shortcut(s)"
    } else {
        Write-Info "No orphaned shortcuts found"
    }
}

# --- Main -------------------------------------------------------------------

function Main {
    [CmdletBinding()]
    param(
        [string]$Version = "",
        [string]$Channel = $(if ($env:GENTLE_AI_CHANNEL) { $env:GENTLE_AI_CHANNEL } else { "stable" }),
        [switch]$NoModifyPath,
        [switch]$UseMirror
    )

    if ($Channel -eq "nightly") { $Channel = "beta" }

    Show-Banner

    # --- Orphaned Shortcut Cleanup ------------------------------------------

    Write-Step "Cleaning orphaned shortcuts"
    Clear-OrphanedShortcuts

    # --- Version detection --------------------------------------------------

    if (-not $Version) {
        $Version = Get-LatestVersion -Repo $OPENCODE_REPO
    }

    if (-not $Version -and -not $UseMirror) {
        Write-Warn "GitHub is unreachable. Trying Nextcloud mirror..."
        $Version = Get-LatestFromNextcloud
        if (-not $Version) {
            $Version = $FALLBACK_VERSION
            Write-Warn "Using fallback version: $Version"
        }
        $UseMirror = $true
        Write-Info "Mirror mode enabled automatically."
    }

    if (-not $Version) {
        Stop-WithError "Could not determine opencode version and no mirror available."
    }

    # --- Prerequisites ------------------------------------------------------

    Write-Step "Checking prerequisites"

    $missing = @()
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        $missing += "git"
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $missing += "node"
    }
    # npm is bundled with Node.js -- check only if node is present but npm isn't
    if ((Get-Command node -ErrorAction SilentlyContinue) -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
        $missing += "npm"
    }

    if ($missing.Count -gt 0) {
        Write-Warn "Missing: $($missing -join ', ')"
        Write-Info "gentle-ai needs git, node, and npm to install skills and plugins."

        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Info "Attempting auto-install via winget..."
            foreach ($tool in $missing) {
                if ($tool -eq "git") {
                    Write-Info "Installing Git..."
                    winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements
                } elseif ($tool -eq "node") {
                    Write-Info "Installing Node.js (LTS)..."
                    winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
                } elseif ($tool -eq "npm") {
                    Write-Info "npm is bundled with Node.js -- will be available after Node install"
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
    Write-Success "git, node, npm -- all present"

    Write-Step "Installing opencode-fork"
    $installParams = @{
        Repo       = $OPENCODE_REPO
        OutputDir  = $OPENCODE_DIR
        AssetName  = "opencode"
        BinaryName = "opencode"
        Version    = $Version
    }
    if ($UseMirror) {
        Write-Info "Downloading from Nextcloud mirror..."
        $installParams.MirrorUrl = $NEXTCLOUD_MIRROR
    }
    Install-Binary @installParams

    Write-Step "Installing gentle-ai"
    $gentleVersion = Get-LatestVersion -Repo $GENTLE_REPO
    if (-not $gentleVersion) {
        Write-Warn "Cannot reach GitHub for gentle-ai. Trying anyway with known version..."
        $gentleVersion = "v2.1.5"  # last known stable
    }
    Install-Binary -Repo $GENTLE_REPO -OutputDir $GENTLE_DIR -AssetName "gentle-ai" -BinaryName "gentle-ai" -Version $gentleVersion

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
        Write-Info "No existing engram.db found -- fresh install"
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
        Write-Warn "No global config found -- desktop app may need manual setup"
    }

    Write-Step "Creating desktop shortcut"
    try {
        $wsh = New-Object -ComObject WScript.Shell
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $shortcutPath = Join-Path $desktopPath "OpenCode.lnk"
        $targetPath = Join-Path $OPENCODE_DIR "opencode.exe"

        if (Test-Path $targetPath) {
            $lnk = $wsh.CreateShortcut($shortcutPath)
            $lnk.TargetPath = $targetPath
            $lnk.WorkingDirectory = $OPENCODE_DIR
            $lnk.Description = "OpenCode - AI-powered terminal"
            $lnk.Save()
            Write-Success "Shortcut created: $shortcutPath"
        } else {
            Write-Warn "opencode.exe not found -- skipping shortcut"
        }
    } catch {
        Write-Warn "Could not create shortcut: $_"
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
