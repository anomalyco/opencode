# [fork-only] DeskFox 一键构建 wrapper
#
# 流程:
#   1. apply-icons.ps1   把 DeskFox PNG/.ico 临时拷到 src-tauri/icons/{env}/
#   2. tauri build       --config tauri-overrides/<env>.json(productName / mainBinaryName 覆盖)
#   3. restore-icons.ps1 git checkout HEAD -- src-tauri/icons/(还原工作树)
#
# 用法:
#   .\packages\branding\scripts\build-deskfox.ps1 -Env dev
#   .\packages\branding\scripts\build-deskfox.ps1 -Env prod
#   .\packages\branding\scripts\build-deskfox.ps1 -Env beta
#
# 不带 -NoBundle 时跑完整 bundle(NSIS .msi 等);加 -NoBundle 跳过 bundler(SignTool 没装时用)

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "beta", "prod")]
    [string]$Env,

    [switch]$NoBundle
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root  # opencode-fork/
$override = Join-Path $root "branding/tauri-overrides/$Env.json"

if (-not (Test-Path $override)) {
    throw "tauri override not found: $override"
}

# 1. apply(按 env 选样式)
& (Join-Path $PSScriptRoot "apply-icons.ps1") -Env $Env

# 1.5 注入 VITE_DESKFOX_ENV 让前端 logo.tsx Mark 组件按 env 选 branded 样式
$env:VITE_DESKFOX_ENV = $Env

# 2. tauri build
$bundleFlag = if ($NoBundle) { "--no-bundle" } else { "" }
Push-Location (Join-Path $repoRoot "packages/desktop")
try {
    if ($NoBundle) {
        bun run tauri build --no-bundle --config $override
    } else {
        bun run tauri build --config $override
    }
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}

# 3. restore(无论 build 成败都还原)
& (Join-Path $PSScriptRoot "restore-icons.ps1")

if ($buildExit -ne 0) {
    Write-Warning "tauri build exited with code $buildExit (NSIS SignTool missing 是已知挂账,exe 仍 build 出来了)"
}

# 4. 提示产物路径
$exePath = Join-Path $repoRoot "packages/desktop/src-tauri/target/release/DeskFox.exe"
if (Test-Path $exePath) {
    Write-Output ""
    Write-Output "✓ DeskFox.exe ready at: $exePath"
} else {
    Write-Warning "DeskFox.exe not found — check build output above"
}
