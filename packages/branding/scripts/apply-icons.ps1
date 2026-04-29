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

# 1. 现场生成多分辨率 icon.ico
#    扫 ico-source/ 下所有 <size>.png(文件名即尺寸,如 16.png / 256.png),按尺寸升序拼进 ico
#    Windows 桌面图标渲染默认 48px,需要至少 16/32/48/256 多档,缺大尺寸会被强制缩放或回退默认
$icoOut = Join-Path $envAssets "icon.ico"
$pngs = Get-ChildItem -Path $envIcoSrc -Filter "*.png" |
    Where-Object { $_.BaseName -match '^\d+$' } |
    Sort-Object @{ Expression = { [int]$_.BaseName } }
if ($pngs.Count -eq 0) {
    throw "no PNGs in $envIcoSrc (expected files like 16.png, 32.png, 256.png)"
}

Push-Location $repoRoot
try {
    bun packages/branding/scripts/png-to-ico.ts $icoOut @($pngs.FullName)
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

# 3. Sync to src-tauri/icons/dev/icon.ico (winres base path)
#    Tauri 2.10.1 winres reads icons/dev/icon.ico hardcoded; --config prod.json
#    bundle.icon override is ignored. Without this sync, non-dev builds get dev icon.
#    Details: docs/features/icon-pipeline-deep-fix/3-changelog.md
if ($Env -ne "dev") {
    $devIcoPath = Join-Path $repoRoot "packages/desktop/src-tauri/icons/dev/icon.ico"
    Copy-Item -Force $icoOut $devIcoPath
    Write-Output "also synced → $devIcoPath (winres base path)"
}
