# [fork-only] DeskFox one-shot installer pipeline
#
# Workflow:
#   1. bump-installer-version.ps1    -> bump version (writes new .iss + 版本日志.md placeholder)
#                                       — 可用 -SkipBump 跳过(CI 场景:user 本地已 bump 并 commit)
#   2. build-deskfox.ps1 -NoBundle    -> 重 build DeskFox.exe 让 UI 版本号(读 installer-versions.json
#                                       烧进 vite bundle)跟 bumped JSON 同步。**2026-05-11 加**:
#                                       之前 bump 跟 build 顺序错位导致 installer 文件名跟 UI 显示
#                                       版本号 mismatch(installer-.11.1 装出来 UI 仍显示 .10.1)。
#                                       — 可用 -SkipBuild 跳过(CI 已 build / 极快速重 pack 场景)
#   3. ISCC.exe /DAppEnv=$Env DeskFox.iss -> compile installer (三档独立 AppId,见 docs/governance/应用身份-命名规则.md)
#   4. Print artifact path
#
# Prereq:
#   - 默认会自动 build,不需要预跑 build-deskfox.ps1。仅 -SkipBuild 时 expects target/release/DeskFox.exe 已就绪。
#   - ISCC.exe installed at C:\ProgramData\chocolatey\bin\ISCC.exe
#
# Usage:
#   & .\packages\branding\scripts\pack-installer.ps1                          # 默认 prod,bump + build + pack
#   & .\packages\branding\scripts\pack-installer.ps1 -Env beta
#   & .\packages\branding\scripts\pack-installer.ps1 -Env dev
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBump      # 用现有 JSON 版本号 + rebuild + pack
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBuild     # 用已 build 的 exe(谨慎 — 版本号可能 mismatch)
#   & .\packages\branding\scripts\pack-installer.ps1 -Env prod -SkipBump -SkipBuild  # CI:bump + build 都在外面做好

param(
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env = "prod",
    [switch]$SkipBump,
    [switch]$SkipBuild,
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
    # FORK: 透传 Env 给 bump 脚本 — dev/beta 出带 suffix 版本号(例 2026.5.21.1-dev)
    # [feat: installer-version-env-suffix] 2026-05-21
    $bumpOut = & (Join-Path $here "bump-installer-version.ps1") -Platform "Windows" -Env $Env
    $bumpOut | Write-Output
    $versionLine = $bumpOut | Where-Object { $_ -match '^VERSION=' } | Select-Object -First 1
    if (-not $versionLine) { throw "bump script did not produce VERSION= line" }
    $newVersion = $versionLine -replace '^VERSION=', ''
    Write-Output "[pack] bumped version: $newVersion (env=$Env)"
}

# 1.5 重 build DeskFox.exe 让 UI 版本号跟 bumped JSON 同步(2026-05-11 加)
# 背景:UI 左下角"v2026.5.X.N"读 packages/branding/installer-versions.json 经 vite import
# **烧进 bundle**(不是 runtime 读文件)。如果 bump 改 JSON 后不重 build,生成的 installer 内部
# exe 还是上一版本号,跟 installer 文件名 mismatch — user 装完发现 UI 跟下载文件名不一致。
if ($SkipBuild) {
    Write-Output "[pack] -SkipBuild: 假设 target/release/DeskFox.exe 已是当前版本号,不重 build"
} else {
    Write-Output "[pack] 重 build DeskFox.exe(让 UI 显示版本号跟 installer 文件名对齐)..."
    & (Join-Path $here "build-deskfox.ps1") -Env $Env -NoBundle
    if ($LASTEXITCODE -ne 0) { throw "[pack] build-deskfox.ps1 failed with exit $LASTEXITCODE" }
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
