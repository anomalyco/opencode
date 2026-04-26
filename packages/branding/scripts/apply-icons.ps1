# [fork-only] DeskFox icon 拷贝脚本
#
# 把 packages/branding/src/assets/icons/<env>/ 下的 PNG + 现场生成的 .ico
# 拷到 packages/desktop/src-tauri/icons/<env>/
#
# 三套样式:
#   prod  → icon-primary 样式(完整美观,正式发布)
#   beta  → icon-mono     样式(单色,测试阶段)
#   dev   → icon-favicon  样式(极简,开发调试)
#
# 跟 build-deskfox.ps1 配套用:build 前调本脚本,build 后由 restore-icons.ps1 还原 git。
# 也可单独跑(开发时调试 icon),但记得跑完 restore-icons.ps1 否则工作树脏。
#
# 用法:
#   .\packages\branding\scripts\apply-icons.ps1 -Env dev
#   .\packages\branding\scripts\apply-icons.ps1 -Env prod
#   .\packages\branding\scripts\apply-icons.ps1 -Env beta

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root  # opencode-fork/

$envAssets = Join-Path $root "branding/src/assets/icons/$Env"
$envIcoSrc = Join-Path $envAssets "ico-source"
$tauriEnvDir = Join-Path $repoRoot "packages/desktop/src-tauri/icons/$Env"

if (-not (Test-Path $envAssets)) {
    throw "branding assets not found for env=${Env}: $envAssets"
}

# 1. 现场生成 icon.ico(三尺寸 16/32/48,源在 ico-source/ 下)
$icoOut = Join-Path $envAssets "icon.ico"
$png16 = Join-Path $envIcoSrc "16.png"
$png32 = Join-Path $envIcoSrc "32.png"
$png48 = Join-Path $envIcoSrc "48.png"

Push-Location $repoRoot
try {
    bun packages/branding/scripts/png-to-ico.ts $icoOut $png16 $png32 $png48
    if ($LASTEXITCODE -ne 0) { throw "png-to-ico.ts failed for env=${Env}" }
} finally {
    Pop-Location
}

# 2. 拷 PNG + ICO 到 src-tauri/icons/<env>/
Copy-Item -Force (Join-Path $envAssets "32x32.png")        (Join-Path $tauriEnvDir "32x32.png")
Copy-Item -Force (Join-Path $envAssets "128x128.png")      (Join-Path $tauriEnvDir "128x128.png")
Copy-Item -Force (Join-Path $envAssets "128x128@2x.png")   (Join-Path $tauriEnvDir "128x128@2x.png")
Copy-Item -Force $icoOut                                   (Join-Path $tauriEnvDir "icon.ico")

Write-Output "applied DeskFox ${Env} icons → $tauriEnvDir"
