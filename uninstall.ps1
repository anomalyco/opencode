#Requires -Version 5.1
<#
.SYNOPSIS
    Gentle OpenCode -- Uninstaller for Windows
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

# --- Configuration ---------------------------------------------------------

$OPENCODE_DIR       = Join-Path $env:LOCALAPPDATA "opencode"
$OPENCODE_BIN       = Join-Path $OPENCODE_DIR "bin"
$GENTLE_DIR         = Join-Path $env:LOCALAPPDATA "gentle-ai"
$GENTLE_BIN         = Join-Path $GENTLE_DIR "bin"

$CONFIG_DIR         = Join-Path $env:USERPROFILE ".config\opencode"
$ENGRAM_DB          = Join-Path $env:USERPROFILE ".engram"

# Desktop (electron-builder / NSIS) app paths
$DESKTOP_UPDATER    = Join-Path $env:LOCALAPPDATA "@opencode-aidesktop-updater"
$DESKTOP_PROGRAMS   = Join-Path $env:LOCALAPPDATA "Programs\@opencode-aidesktop"
$DESKTOP_NSIS       = Join-Path $env:LOCALAPPDATA "Programs\opencode"

# Temp paths
$TEMP_DIR           = Join-Path $env:TEMP "opencode"
$TEMP_BACKUP        = Join-Path $env:TEMP "opencode-backup"
$TEMP_GENTLEMAN     = Join-Path $env:TEMP "gentleman-guardian-angel"

# Roaming / AppData config paths
$APPDATA_OPENCODE          = Join-Path $env:APPDATA "opencode"
$APPDATA_AT_OPENCODE       = Join-Path $env:APPDATA "@opencode-ai"
$APPDATA_DESKTOP_DEV       = Join-Path $env:APPDATA "ai.opencode.desktop.dev"
$APPDATA_DESKTOP           = Join-Path $env:APPDATA "ai.opencode.desktop"
$APPDATA_ONINFO            = Join-Path $env:APPDATA "oneinfo dev"

# Shortcut names
$SHORTCUT_NAME = "OpenCode.lnk"
$SHORTCUT_ALT  = "oneinfo dev.lnk"

# --- Helpers ---------------------------------------------------------------

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
            Write-ERR "Failed: $Label -- $_"
        }
    } else {
        Write-SKIP "Not found: $Label"
    }
}

# --- Parameters ------------------------------------------------------------
# (wrapped in Main function for irm|iex compatibility)

function Main {
    [CmdletBinding()]
    param(
        [switch]$RemoveEngram
    )

    Write-Host ""
    Write-Host "  Gentle OpenCode -- Uninstaller" -ForegroundColor Cyan
    Write-Host ""

    # 1. Remove CLI binaries
    Write-Step "Removing CLI binaries"
    Remove-IfExists -Path $OPENCODE_DIR -Label "opencode CLI ($OPENCODE_DIR)"
    Remove-IfExists -Path $GENTLE_DIR   -Label "gentle-ai CLI ($GENTLE_DIR)"

    # 2. Remove desktop app (electron-builder / NSIS)
    Write-Step "Removing desktop app files"
    Remove-IfExists -Path $DESKTOP_PROGRAMS  -Label "desktop app ($DESKTOP_PROGRAMS)"
    Remove-IfExists -Path $DESKTOP_NSIS      -Label "desktop app NSIS ($DESKTOP_NSIS)"
    Remove-IfExists -Path $DESKTOP_UPDATER   -Label "desktop updater ($DESKTOP_UPDATER)"

    # 3. Remove roaming / AppData config
    Write-Step "Removing application data"
    Remove-IfExists -Path $CONFIG_DIR               -Label "opencode config ($CONFIG_DIR)"
    Remove-IfExists -Path $APPDATA_DESKTOP_DEV      -Label "desktop config dev ($APPDATA_DESKTOP_DEV)"
    Remove-IfExists -Path $APPDATA_DESKTOP          -Label "desktop config ($APPDATA_DESKTOP)"
    Remove-IfExists -Path $APPDATA_OPENCODE         -Label "opencode AppData ($APPDATA_OPENCODE)"
    Remove-IfExists -Path $APPDATA_AT_OPENCODE      -Label "@opencode-ai AppData ($APPDATA_AT_OPENCODE)"
    Remove-IfExists -Path $APPDATA_ONINFO           -Label "oneinfo dev AppData ($APPDATA_ONINFO)"

    # 4. Remove temp dirs
    Write-Step "Removing temporary files"
    Remove-IfExists -Path $TEMP_DIR       -Label "temp opencode ($TEMP_DIR)"
    Remove-IfExists -Path $TEMP_BACKUP    -Label "temp opencode-backup ($TEMP_BACKUP)"
    Remove-IfExists -Path $TEMP_GENTLEMAN -Label "temp gentleman-guardian-angel ($TEMP_GENTLEMAN)"

    # 5. Remove desktop shortcuts (all locations)
    Write-Step "Removing shortcuts"
    $shortcutPaths = @(
        [Environment]::GetFolderPath("Desktop")
        [Environment]::GetFolderPath("CommonDesktopDirectory")
        Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
        Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
    )
    $removedShortcuts = 0
    foreach ($loc in $shortcutPaths) {
        if (-not (Test-Path $loc)) { continue }
        Get-ChildItem -Path $loc -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            $name = $_.Name.ToLower()
            if ($name -like "*opencode*" -or $name -like "*oneinfo*") {
                try {
                    Remove-Item -Path $_.FullName -Force
                    Write-OK "Removed shortcut: $($_.Name)"
                    $removedShortcuts++
                } catch {
                    Write-WARN "Could not remove: $($_.Name)"
                }
            }
        }
    }
    if ($removedShortcuts -eq 0) {
        Write-SKIP "No OpenCode shortcuts found"
    }

    # 6. Clean PATH entries
    Write-Step "Cleaning PATH"
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath) {
        $entries = $userPath -split ';' | Where-Object { $_ -ne '' }
        $cleaned = $entries | Where-Object {
            $entry = $_.TrimEnd('\')
            ($entry -ine $OPENCODE_DIR.TrimEnd('\')) -and
            ($entry -ine $OPENCODE_BIN.TrimEnd('\')) -and
            ($entry -ine $GENTLE_DIR.TrimEnd('\')) -and
            ($entry -ine $GENTLE_BIN.TrimEnd('\'))
        }
        if ($cleaned.Count -ne $entries.Count) {
            $newPath = $cleaned -join ';'
            [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
            Write-OK "Removed opencode/gentle-ai from PATH"
        } else {
            Write-SKIP "PATH already clean"
        }
    }

    # 7. Remove registry uninstall entries
    Write-Step "Cleaning registry"
    $registryRemoved = 0
    Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue | ForEach-Object {
        $disp = $null
        try { $disp = (Get-ItemProperty $_.PSPath -Name DisplayName -ErrorAction Stop).DisplayName } catch {}
        if ($disp -and ($disp -match 'opencode|oneinfo|gentle')) {
            try {
                Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction Stop
                Write-OK "Removed registry: $disp"
                $registryRemoved++
            } catch {
                Write-WARN "Could not remove registry entry: $disp -- $_"
            }
        }
    }
    if ($registryRemoved -eq 0) {
        Write-SKIP "No OpenCode registry entries found"
    }

    # 8. Engram database
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

# --- Done ------------------------------------------------------------------

    Write-Host ""
    Write-Host "Uninstall complete." -ForegroundColor Green
    Write-Host ""
    Write-Host "The machine is clean and ready for a fresh installation:" -ForegroundColor White
    Write-Host '  irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1 | iex' -ForegroundColor Cyan
    Write-Host ""
}

Main @args
