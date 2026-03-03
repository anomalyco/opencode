#Requires -Version 5.1
<#
.SYNOPSIS
    Portable wrapper for OpenCode on Windows.
.DESCRIPTION
    Downloads and runs OpenCode from a self-contained directory next to this
    script.  All config, data, cache and state stay within .opencode_portable/
    so nothing is written to your user profile.
.PARAMETER PortableHelp
    Show wrapper usage and exit.
.PARAMETER PortableUpdate
    Force re-download of the OpenCode binary.
.PARAMETER PortableVersion
    Show the currently cached version and exit.
#>
param(
    [switch]$PortableHelp,
    [switch]$PortableUpdate,
    [switch]$PortableVersion,
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$PassthroughArgs
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Self-location & portable directory
# ---------------------------------------------------------------------------
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PortableDir = Join-Path $ScriptDir ".opencode_portable"
$BinPath     = Join-Path $PortableDir "bin\opencode.exe"
$VersionFile = Join-Path $PortableDir ".version"

# ---------------------------------------------------------------------------
# --PortableHelp
# ---------------------------------------------------------------------------
if ($PortableHelp) {
    @"
OpenCode Portable Wrapper (PowerShell)

Usage: .\opencode-portable.ps1 [-PortableHelp] [-PortableUpdate] [-PortableVersion] [opencode args...]

Wrapper options (consumed by this script):
    -PortableHelp       Show this help message
    -PortableUpdate     Force re-download of the OpenCode binary
    -PortableVersion    Show the currently cached version

All other arguments are passed through to the OpenCode binary.

Environment variables:
    OPENCODE_PORTABLE_VERSION   Pin a specific version (e.g. 1.0.180)

Version pinning:
    You can also create a .opencode-version file next to this script
    containing the desired version number (one line, e.g. "1.0.180").

Portable directory layout:
    .opencode_portable\
    +-- bin\            Binary
    +-- config\         XDG_CONFIG_HOME
    +-- data\           XDG_DATA_HOME
    +-- cache\          XDG_CACHE_HOME
    +-- state\          XDG_STATE_HOME
    +-- .version        Cached version string
"@
    exit 0
}

# ---------------------------------------------------------------------------
# --PortableVersion
# ---------------------------------------------------------------------------
if ($PortableVersion) {
    if (Test-Path $VersionFile) {
        Write-Host "Cached version: $(Get-Content $VersionFile -Raw)".Trim()
    } else {
        Write-Host "No version cached yet."
    }
    exit 0
}

# ---------------------------------------------------------------------------
# Create portable directory structure
# ---------------------------------------------------------------------------
foreach ($sub in @("bin", "config", "data", "cache", "state")) {
    $p = Join-Path $PortableDir $sub
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

# ---------------------------------------------------------------------------
# XDG environment isolation
# ---------------------------------------------------------------------------
$env:XDG_CONFIG_HOME = Join-Path $PortableDir "config"
$env:XDG_DATA_HOME   = Join-Path $PortableDir "data"
$env:XDG_CACHE_HOME  = Join-Path $PortableDir "cache"
$env:XDG_STATE_HOME  = Join-Path $PortableDir "state"
$env:OPENCODE_DISABLE_AUTOUPDATE = "true"

# ---------------------------------------------------------------------------
# Determine pinned version
# ---------------------------------------------------------------------------
$PinnedVersion = $env:OPENCODE_PORTABLE_VERSION
if (-not $PinnedVersion) {
    $versionFilePath = Join-Path $ScriptDir ".opencode-version"
    if (Test-Path $versionFilePath) {
        $PinnedVersion = (Get-Content $versionFilePath -Raw).Trim()
    }
}
if ($PinnedVersion) {
    $PinnedVersion = $PinnedVersion -replace '^v', ''
}

# ---------------------------------------------------------------------------
# Decide whether a download is needed
# ---------------------------------------------------------------------------
$NeedDownload = $false
if ($PortableUpdate) {
    $NeedDownload = $true
} elseif (-not (Test-Path $BinPath)) {
    $NeedDownload = $true
} elseif ($PinnedVersion -and (Test-Path $VersionFile)) {
    $cached = (Get-Content $VersionFile -Raw).Trim()
    if ($cached -ne $PinnedVersion) {
        $NeedDownload = $true
    }
}

# ---------------------------------------------------------------------------
# Download logic
# ---------------------------------------------------------------------------
if ($NeedDownload) {
    # --- platform detection -------------------------------------------------
    $os   = "windows"
    $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
        "AMD64" { "x64" }
        "x86"   { "x64" }   # 32-bit on 64-bit — use x64 binary
        default {
            Write-Host "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" -ForegroundColor Red
            exit 1
        }
    }

    # AVX2 / baseline detection via IsProcessorFeaturePresent(40)
    $needsBaseline = $false
    try {
        Add-Type -MemberDefinition @"
[DllImport("kernel32.dll")]
public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);
"@ -Name Kernel32 -Namespace Win32Portable -ErrorAction Stop
        $hasAVX2 = [Win32Portable.Kernel32]::IsProcessorFeaturePresent(40)
        if (-not $hasAVX2) { $needsBaseline = $true }
    } catch {
        # If detection fails, assume baseline for safety
        $needsBaseline = $true
    }

    $target = "$os-$arch"
    if ($needsBaseline) { $target += "-baseline" }
    $filename = "opencode-$target.zip"

    # --- resolve version & URL ----------------------------------------------
    if ($PinnedVersion) {
        $url = "https://github.com/anomalyco/opencode/releases/download/v$PinnedVersion/$filename"
        $specificVersion = $PinnedVersion
    } else {
        $url = "https://github.com/anomalyco/opencode/releases/latest/download/$filename"
        try {
            $releaseInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/anomalyco/opencode/releases/latest" -UseBasicParsing
            $specificVersion = $releaseInfo.tag_name -replace '^v', ''
        } catch {
            Write-Host "Failed to fetch latest version information" -ForegroundColor Red
            exit 1
        }
    }

    # --- download & extract -------------------------------------------------
    $tmpDir = Join-Path $env:TEMP "opencode_portable_$PID"
    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        Write-Host "Downloading OpenCode v$specificVersion ($target)..." -ForegroundColor DarkGray

        $archivePath = Join-Path $tmpDir $filename
        # Use .NET WebClient for better performance on large files
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($url, $archivePath)

        Expand-Archive -Path $archivePath -DestinationPath $tmpDir -Force

        $srcBin = Join-Path $tmpDir "opencode.exe"
        if (-not (Test-Path $srcBin)) {
            Write-Host "Error: opencode.exe not found in archive" -ForegroundColor Red
            exit 1
        }
        Copy-Item $srcBin $BinPath -Force

        Set-Content -Path $VersionFile -Value $specificVersion -NoNewline
        Write-Host "OpenCode v$specificVersion ready." -ForegroundColor Green
    } finally {
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------
if (-not (Test-Path $BinPath)) {
    Write-Host "Error: OpenCode binary not found at $BinPath" -ForegroundColor Red
    exit 1
}

& $BinPath @PassthroughArgs
exit $LASTEXITCODE
