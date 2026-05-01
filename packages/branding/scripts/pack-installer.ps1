# [fork-only] DeskFox one-shot installer pipeline
#
# Workflow:
#   1. bump-installer-version.ps1    -> bump version (writes new .iss + 版本日志.md placeholder)
#                                       — 可用 -SkipBump 跳过(CI 场景:user 本地已 bump 并 commit)
#   2. ISCC.exe /DAppEnv=$Env DeskFox.iss -> compile installer (三档独立 AppId,见 docs/governance/应用身份-命名规则.md)
#   3. Print artifact path
#
# Prereq:
#   - You already ran build-deskfox.ps1 -Env $Env -NoBundle (DeskFox.exe + opencode-cli.exe in target/release/)
#   - ISCC.exe installed at C:\ProgramData\chocolatey\bin\ISCC.exe
#
# Usage:
#   & .\packages\branding\scripts\pack-installer.ps1                          # 默认 prod,本地 bump
#   & .\packages\branding\scripts\pack-installer.ps1 -Env beta
#   & .\packages\branding\scripts\pack-installer.ps1 -Env dev
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBump      # CI:版本号从 .iss 当前值取
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBump -Version 2026.5.1.2  # CI:显式传

param(
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env = "prod",
    [switch]$SkipBump,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path -Parent $here
$repoRoot = Split-Path -Parent $root
$issPath = Join-Path $root "installer/DeskFox.iss"
$iscc = "C:\ProgramData\chocolatey\bin\ISCC.exe"

if (-not (Test-Path $iscc)) { throw "ISCC.exe not found at $iscc" }

# 1. determine version (bump 本地 / SkipBump 取已有)
if ($SkipBump) {
    if ($Version) {
        $newVersion = $Version
        Write-Output "[pack] -SkipBump -Version: using $newVersion (env=$Env)"
    } else {
        # 从 .iss 当前 AppVersion 读
        $issContent = Get-Content $issPath -Raw -Encoding UTF8
        if ($issContent -match '#define\s+AppVersion\s+"([^"]+)"') {
            $newVersion = $Matches[1]
            Write-Output "[pack] -SkipBump: read AppVersion from .iss = $newVersion (env=$Env)"
        } else {
            throw "[pack] -SkipBump 但 -Version 未传 且 .iss 里找不到 AppVersion"
        }
    }
} else {
    # 本地默认走 bump
    $bumpOut = & (Join-Path $here "bump-installer-version.ps1") -Platform "Windows"
    $bumpOut | Write-Output
    $versionLine = $bumpOut | Where-Object { $_ -match '^VERSION=' } | Select-Object -First 1
    if (-not $versionLine) { throw "bump script did not produce VERSION= line" }
    $newVersion = $versionLine -replace '^VERSION=', ''
    Write-Output "[pack] bumped version: $newVersion (env=$Env)"
}

# 2. compile installer (传 AppEnv 给 .iss 选三档身份)
& $iscc "/DAppEnv=$Env" $issPath
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit $LASTEXITCODE" }

# 3. report path (OutputBaseFilename 三档不同前缀,见 .iss)
$envSuffix = switch ($Env) {
    "prod" { "" }
    "beta" { "-Beta" }
    "dev"  { "-Dev" }
}
$installerPath = Join-Path $root "installer/Output/DeskFox$envSuffix-$newVersion-setup.exe"
if (-not (Test-Path $installerPath)) {
    throw "expected installer not found: $installerPath"
}
$size = (Get-Item $installerPath).Length
Write-Output ""
Write-Output "[pack] installer ready:"
Write-Output "  $installerPath"
Write-Output "  size: $size bytes"
Write-Output ""
Write-Output "[pack] remember to fill the placeholder in docs/installer-versions.md with summary after testing"
