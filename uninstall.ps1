#Requires -Version 5.1
<#
.SYNOPSIS
    Gentle OpenCode — Uninstaller for Windows
    Removes everything installed by install.ps1

.DESCRIPTION
    Cleans opencode binary, gentle-ai binary, config, desktop shortcut,
    and PATH entries. By default preserves Engram database.

.PARAMETER KeepEngram
    Preserve Engram database (enabled by default)

.PARAMETER RemoveEngram
    Also remove Engram database and all memory

.EXAMPLE
    .\uninstall.ps1
    .\uninstall.ps1 -RemoveEngram
#>

$ErrorActionPreference = "Stop"

# ─── Configuration ─────────────────────────────────────────────────────────

$OPENCODE_DIR  = Join-Path $env:LOCALAPPDATA "opencode"
$GENTLE_DIR    = Join-Path $env:LOCALAPPDATA "gentle-ai"
$CONFIG_DIR    = Join-Path $env:USERPROFILE ".config\opencode"
$DESKTOP_APPID = "ai.opencode.desktop.dev"
$DESKTOP_CONFIG = Join-Path $env:APPDATA "$DESKTOP_APPID"
$ENGRAM_DB     = Join-Path $env:USERPROFILE ".engram"
$SHORTCUT_NAME = "OpenCode.lnk"
$SHORTCUT_ALT  = "oneinfo dev.lnk"

# ─── Helpers ───────────────────────────────────────────────────────────────

function Write-Step    { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-OK      { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-SKIP    { param($m) Write-Host "  [--] $m" -ForegroundColor DarkGray }
function Write-WARN    { param($m) Write-Host "  [!!] $m" -ForegroundColor Yellow }
function Write-ERR     { param($m) Write-Host "  [XX] $m" -ForegroundColor Red }

function Remove-IfExists {
    param([string]$Path, [string]$Label)
    if (Test-Path $Path) {
        try {
            Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
            Write-OK "Removed: $Label"
        } catch {
            Write-ERR "Failed: $Label — $_"
        }
    } else {
        Write-SKIP "Not found: $Label"
    }
}

# ─── Parameters ────────────────────────────────────────────────────────────
# (wrapped in Main function for irm|iex compatibility)

function Main {
    [CmdletBinding()]
    param(
        [switch]$RemoveEngram
    )

    Write-Host ""
    Write-Host "  Gentle OpenCode — Uninstaller" -ForegroundColor Cyan
    Write-Host ""

    # 1. Remove binaries
    Write-Step "Removing binaries"
Remove-IfExists -Path $OPENCODE_DIR -Label "opencode ($OPENCODE_DIR)"
Remove-IfExists -Path $GENTLE_DIR   -Label "gentle-ai ($GENTLE_DIR)"

# 2. Remove config
Write-Step "Removing configuration"
Remove-IfExists -Path $CONFIG_DIR      -Label "opencode config ($CONFIG_DIR)"
Remove-IfExists -Path $DESKTOP_CONFIG  -Label "desktop config ($DESKTOP_CONFIG)"

# 3. Remove desktop shortcuts
Write-Step "Removing desktop shortcuts"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$publicDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$taskbar = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

$shortcutLocations = @($desktopPath, $publicDesktop, $startMenu, $taskbar)
$removed = 0

foreach ($loc in $shortcutLocations) {
    if (-not (Test-Path $loc)) { continue }
    Get-ChildItem -Path $loc -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.Name.ToLower()
        if ($name -like "*opencode*" -or $name -like "*oneinfo*") {
            try {
                Remove-Item -Path $_.FullName -Force
                Write-OK "Removed shortcut: $($_.Name)"
                $removed++
            } catch {
                Write-WARN "Could not remove: $($_.Name)"
            }
        }
    }
}
if ($removed -eq 0) {
    Write-SKIP "No OpenCode shortcuts found"
}

# 4. Clean PATH entries
Write-Step "Cleaning PATH"
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath) {
    $entries = $userPath -split ';' | Where-Object { $_ -ne '' }
    $cleaned = $entries | Where-Object {
        $entry = $_.TrimEnd('\')
        $entry -ine $OPENCODE_DIR.TrimEnd('\') -and
        $entry -ine $GENTLE_DIR.TrimEnd('\') -and
        $entry -ine (Join-Path $OPENCODE_DIR "bin").TrimEnd('\') -and
        $entry -ine (Join-Path $GENTLE_DIR "bin").TrimEnd('\')
    }
    if ($cleaned.Count -ne $entries.Count) {
        $newPath = $cleaned -join ';'
        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        Write-OK "Removed opencode/gentle-ai from PATH"
    } else {
        Write-SKIP "PATH already clean"
    }
}

# 5. Engram database
Write-Step "Engram database"
$engramDbFile = Join-Path $ENGRAM_DB "engram.db"
if ($RemoveEngram) {
    # Backup before deleting
    if (Test-Path $engramDbFile) {
        $backupName = "engram.db.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        $backupPath = Join-Path $ENGRAM_DB $backupName
        Copy-Item -Path $engramDbFile -Destination $backupPath -Force
        $dbSize = (Get-Item $engramDbFile).Length
        Write-OK "Backed up engram.db ($([math]::Round($dbSize / 1KB)) KB) -> $backupName"
    }
    Remove-IfExists -Path $ENGRAM_DB -Label "Engram DB ($ENGRAM_DB)"
    Write-WARN "All AI memory has been deleted. Backup saved."
} else {
    if (Test-Path $ENGRAM_DB) {
        Write-OK "Preserved Engram DB at $ENGRAM_DB"
        Write-Host "     Use -RemoveEngram to delete it too." -ForegroundColor DarkGray
    } else {
        Write-SKIP "No Engram DB found"
    }
}

# ─── Done ──────────────────────────────────────────────────────────────────

    Write-Host ""
    Write-Host "Uninstall complete." -ForegroundColor Green
    Write-Host ""
    Write-Host "The machine is clean and ready for a fresh installation:" -ForegroundColor White
    Write-Host '  irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1 | iex' -ForegroundColor Cyan
    Write-Host ""
}

Main @args
