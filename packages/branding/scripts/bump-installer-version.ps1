# [fork-only] DeskFox installer version bump
#
# Rule: YYYY.M.D.N[-env-suffix] (Year.Month.Day.Nth-of-day-of-env, N starts from 1)
#
# Per-platform + per-env counter(2026-05-21 起,B2 口径):
#   - Windows / macOS 各自一套 N 序列
#   - prod / beta / dev 各自一套 N 序列(env-isolated)
#   - prod 版本号无后缀(发布物):2026.5.21.1
#   - beta/dev 版本号带后缀(开发包,跟 prod 一眼区分):2026.5.21.1-beta / 2026.5.21.1-dev
#
# Example(同 2026-05-21 平台 Windows):
#   prod packs once -> [Windows] 2026.5.21.1
#   dev packs once  -> [Windows] 2026.5.21.1-dev    (N 独立计数)
#   prod packs again-> [Windows] 2026.5.21.2
#   dev packs again -> [Windows] 2026.5.21.2-dev
#
# Run before iscc / dmg build to auto-increment N for today on this platform+env.
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
    # FORK: Env 参数 — dev/beta 加 suffix,prod 无后缀 [feat: installer-version-env-suffix] 2026-05-21
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env = "prod",
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

# Compute today's version (per-platform + per-env counter)
$today = Get-Date -Format "yyyy.M.d"
# FORK: env suffix — prod 空字符串保持原口径,beta/dev 加后缀 [feat: installer-version-env-suffix] 2026-05-21
$envSuffix = if ($Env -eq "prod") { "" } else { "-$Env" }
$logContent = Get-Content $logFile -Raw -Encoding UTF8
# Match only entries for THIS platform+env: ## [Platform] YYYY.M.D.N[-suffix]<space>...
# 末尾 trailing space anchor — 防 prod 模式 ".1" 误匹配 dev 条目 ".1-dev"(没 space 在 ".1" 后)
$escSuffix = [regex]::Escape($envSuffix)
$pattern = "## \[$([regex]::Escape($Platform))\] $([regex]::Escape($today))\.(\d+)$escSuffix "
$existingNs = [regex]::Matches($logContent, $pattern) |
    ForEach-Object { [int]$_.Groups[1].Value }
$nextN = if ($existingNs) { ($existingNs | Measure-Object -Maximum).Maximum + 1 } else { 1 }
$newVersion = "$today.$nextN$envSuffix"

Write-Output "[bump] platform=$Platform, env=$Env, today=$today, existing N=$($existingNs -join ','), next=$newVersion"

if ($DryRun) {
    Write-Output "[bump] DRY RUN, no files changed. Would set AppVersion=$newVersion (platform=$Platform, env=$Env)"
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
