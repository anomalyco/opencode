# [fork-only] DeskFox one-shot installer pipeline
#
# Workflow:
#   1. bump-installer-version.ps1    -> bump version (writes new .iss + 版本日志.md placeholder)
#   2. ISCC.exe /DAppEnv=$Env DeskFox.iss -> compile installer (三档独立 AppId,见 docs/governance/应用身份-命名规则.md)
#   3. Print artifact path
#
# Prereq:
#   - You already ran build-deskfox.ps1 -Env $Env -NoBundle (DeskFox.exe + opencode-cli.exe in target/release/)
#   - ISCC.exe installed at C:\ProgramData\chocolatey\bin\ISCC.exe
#
# Usage:
#   & .\packages\branding\scripts\pack-installer.ps1                # 默认 prod
#   & .\packages\branding\scripts\pack-installer.ps1 -Env beta
#   & .\packages\branding\scripts\pack-installer.ps1 -Env dev

param(
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env = "prod"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path -Parent $here
$repoRoot = Split-Path -Parent $root
$issPath = Join-Path $root "installer/DeskFox.iss"
$iscc = "C:\ProgramData\chocolatey\bin\ISCC.exe"

if (-not (Test-Path $iscc)) { throw "ISCC.exe not found at $iscc" }

# 1. bump version (Windows platform — N 序列三档共享,不按 env 拆)
$bumpOut = & (Join-Path $here "bump-installer-version.ps1") -Platform "Windows"
$bumpOut | Write-Output
$versionLine = $bumpOut | Where-Object { $_ -match '^VERSION=' } | Select-Object -First 1
if (-not $versionLine) { throw "bump script did not produce VERSION= line" }
$newVersion = $versionLine -replace '^VERSION=', ''
Write-Output "[pack] new version: $newVersion (env=$Env)"

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
