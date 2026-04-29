# [fork-only] DeskFox installer version bump
#
# Rule: YYYY.M.D.N (Year.Month.Day.Nth-of-day, N starts from 1)
# Run before iscc to auto-increment N for today.
#
# Side effects:
#   1. Update packages/branding/installer/DeskFox.iss line `#define AppVersion "..."`
#   2. Prepend a placeholder entry to top of /docs/installer-versions.md (you fill summary after build)
#
# Output: prints new version to stdout (used by pack-installer.ps1)

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root
$issFile = Join-Path $root "branding/installer/DeskFox.iss"
$logFile = Join-Path $repoRoot "docs/installer-versions.md"

if (-not (Test-Path $issFile)) { throw "iss not found: $issFile" }
if (-not (Test-Path $logFile)) { throw "version log not found: $logFile" }

# Compute today's version
$today = Get-Date -Format "yyyy.M.d"
$logContent = Get-Content $logFile -Raw -Encoding UTF8
$existingNs = [regex]::Matches($logContent, "## $([regex]::Escape($today))\.(\d+) ") |
    ForEach-Object { [int]$_.Groups[1].Value }
$nextN = if ($existingNs) { ($existingNs | Measure-Object -Maximum).Maximum + 1 } else { 1 }
$newVersion = "$today.$nextN"

Write-Output "[bump] today=$today, existing N=$($existingNs -join ','), next=$newVersion"

if ($DryRun) {
    Write-Output "[bump] DRY RUN, no files changed. Would set AppVersion=$newVersion"
    exit 0
}

# 1. Update .iss AppVersion
$iss = Get-Content $issFile -Raw -Encoding UTF8
$iss = $iss -replace '#define AppVersion "[^"]*"', "#define AppVersion `"$newVersion`""
Set-Content -Path $issFile -Value $iss -Encoding UTF8 -NoNewline
Write-Output "[bump] updated $issFile -> AppVersion=$newVersion"

# 2. Prepend placeholder entry to version log (above first existing ## entry)
$placeholder = @"

## $newVersion - $(Get-Date -Format "yyyy-MM-dd HH:mm")

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---
"@
$firstHeaderIdx = $logContent.IndexOf("`n## ")
if ($firstHeaderIdx -lt 0) {
    # No prior entries, append at end
    Add-Content -Path $logFile -Value $placeholder -Encoding UTF8
} else {
    $before = $logContent.Substring(0, $firstHeaderIdx)
    $after  = $logContent.Substring($firstHeaderIdx)
    $merged = $before + $placeholder + "`n" + $after
    Set-Content -Path $logFile -Value $merged -Encoding UTF8 -NoNewline
}
Write-Output "[bump] prepended placeholder to $logFile"

# 3. Output new version (used by caller)
Write-Output "VERSION=$newVersion"
