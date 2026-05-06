# [fork-only] DeskFox installer version bump
#
# Rule: YYYY.M.D.N (Year.Month.Day.Nth-of-day, N starts from 1)
# Per-platform counter: Windows and macOS each maintain their own N sequence,
# they DO NOT share a counter. Same date Windows and macOS may both have .1.
# Example:
#   Day X: Windows packs once -> [Windows] X.1
#   Day X: macOS packs twice  -> [macOS] X.1, [macOS] X.2
#
# Run before iscc / dmg build to auto-increment N for today on this platform.
#
# Side effects:
#   1. Update packages/branding/installer/DeskFox.iss line `#define AppVersion "..."` (Windows only)
#   2. Prepend a placeholder entry to top of /docs/installer-versions.md (you fill summary after build)
#   3. Update packages/branding/installer-versions.json (the platform's key) — front-end reads it
#      to render "DeskFox <Platform>" + version in the settings dialog footer.
#
# Output: prints new version to stdout (used by pack-installer.ps1)

param(
    [ValidateSet("Windows", "macOS")]
    [string]$Platform = "Windows",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root
$issFile = Join-Path $root "branding/installer/DeskFox.iss"
$logFile = Join-Path $repoRoot "docs/installer-versions.md"
$jsonFile = Join-Path $root "branding/installer-versions.json"

if (-not (Test-Path $issFile)) { throw "iss not found: $issFile" }
if (-not (Test-Path $logFile)) { throw "version log not found: $logFile" }
if (-not (Test-Path $jsonFile)) { throw "installer-versions.json not found: $jsonFile" }

# Compute today's version (per-platform counter)
$today = Get-Date -Format "yyyy.M.d"
$logContent = Get-Content $logFile -Raw -Encoding UTF8
# Match only entries for THIS platform: ## [Platform] YYYY.M.D.N - timestamp
$pattern = "## \[$([regex]::Escape($Platform))\] $([regex]::Escape($today))\.(\d+) "
$existingNs = [regex]::Matches($logContent, $pattern) |
    ForEach-Object { [int]$_.Groups[1].Value }
$nextN = if ($existingNs) { ($existingNs | Measure-Object -Maximum).Maximum + 1 } else { 1 }
$newVersion = "$today.$nextN"

Write-Output "[bump] platform=$Platform, today=$today, existing N=$($existingNs -join ','), next=$newVersion"

if ($DryRun) {
    Write-Output "[bump] DRY RUN, no files changed. Would set AppVersion=$newVersion (platform=$Platform)"
    exit 0
}

# 1. Update .iss AppVersion (Windows only; macOS uses Info.plist or build-time arg)
if ($Platform -eq "Windows") {
    $iss = Get-Content $issFile -Raw -Encoding UTF8
    $iss = $iss -replace '#define AppVersion "[^"]*"', "#define AppVersion `"$newVersion`""
    Set-Content -Path $issFile -Value $iss -Encoding UTF8 -NoNewline
    Write-Output "[bump] updated $issFile -> AppVersion=$newVersion"
} else {
    Write-Output "[bump] platform=$Platform, skipping .iss update (macOS uses Info.plist or build-time arg)"
}

# 2. Prepend placeholder entry to version log (above first existing ## entry)
$placeholder = @"

## [$Platform] $newVersion - $(Get-Date -Format "yyyy-MM-dd HH:mm")

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

# 3. Update installer-versions.json (front-end reads this to render settings dialog footer)
#    Surgical regex update on the platform's line — preserves formatting/indent/key order.
$jsonKey = if ($Platform -eq "Windows") { "windows" } else { "macos" }
$jsonContent = Get-Content $jsonFile -Raw -Encoding UTF8
$pattern = "(`"$jsonKey`"\s*:\s*`")[^`"]*(`")"
$replaced = [regex]::Replace($jsonContent, $pattern, "`${1}$newVersion`${2}")
if ($replaced -eq $jsonContent) {
    throw "installer-versions.json: key '$jsonKey' not found, file may be malformed: $jsonFile"
}
Set-Content -Path $jsonFile -Value $replaced -Encoding UTF8 -NoNewline
Write-Output "[bump] updated $jsonFile -> $jsonKey=$newVersion"

# 4. Output new version (used by caller)
Write-Output "VERSION=$newVersion"
