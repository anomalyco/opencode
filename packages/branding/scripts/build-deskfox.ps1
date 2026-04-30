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

# 0. Ensure sidecar built, mtime >= packages/opencode/src/**/*.ts latest
# Upstream predev.ts uses baseline path; in our env (clash proxy) bun-baseline download fails,
# but non-baseline still builds OK. We bypass this by preferring non-baseline binary in sidecars/.
# Mac side: build-deskfox.sh line 52-95 (no baseline issue there, direct predev.ts).
if (-not $env:RUST_TARGET) {
    # ARM64 Windows: add detect branch when needed
    $env:RUST_TARGET = "x86_64-pc-windows-msvc"
}
$sidecarPath = Join-Path $repoRoot "packages/desktop/src-tauri/sidecars/opencode-cli-$($env:RUST_TARGET).exe"
$opencodeSrcDir = Join-Path $repoRoot "packages/opencode/src"

$needBuild = $false
if (-not (Test-Path $sidecarPath)) {
    Write-Output "[deskfox] sidecar not found, will build: $sidecarPath"
    $needBuild = $true
} else {
    $sidecarMtime = (Get-Item $sidecarPath).LastWriteTime
    $latestSrcMtime = (Get-ChildItem -Recurse -File -Path $opencodeSrcDir -Include "*.ts","*.tsx" -ErrorAction SilentlyContinue |
        Measure-Object -Property LastWriteTime -Maximum).Maximum
    if ($latestSrcMtime -and $latestSrcMtime -gt $sidecarMtime) {
        Write-Output "[deskfox] sidecar stale ($($sidecarMtime.ToString('yyyy-MM-dd HH:mm')) < src $($latestSrcMtime.ToString('yyyy-MM-dd HH:mm'))), will rebuild"
        $needBuild = $true
    } else {
        Write-Output "[deskfox] sidecar up-to-date: $sidecarPath"
    }
}

if ($needBuild) {
    Write-Output "[deskfox] running predev.ts (RUST_TARGET=$($env:RUST_TARGET))..."
    Push-Location (Join-Path $repoRoot "packages/desktop")
    try {
        # Allow predev failure (baseline download often fails); fallback to dist/ non-baseline below
        bun ./scripts/predev.ts
    } finally {
        Pop-Location
    }

    # Prefer non-baseline (clash-friendly), fallback baseline
    $nonBaselineBin = Join-Path $repoRoot "packages/opencode/dist/opencode-windows-x64/bin/opencode.exe"
    $baselineBin = Join-Path $repoRoot "packages/opencode/dist/opencode-windows-x64-baseline/bin/opencode.exe"
    $srcBin = $null
    if ((Test-Path $nonBaselineBin) -and (Get-Item $nonBaselineBin).LastWriteTime -gt (Get-Date).AddMinutes(-10)) {
        $srcBin = $nonBaselineBin
        Write-Output "[deskfox] using non-baseline sidecar (clash/network friendly)"
    } elseif ((Test-Path $baselineBin) -and (Get-Item $baselineBin).LastWriteTime -gt (Get-Date).AddMinutes(-10)) {
        $srcBin = $baselineBin
        Write-Output "[deskfox] using baseline sidecar"
    } else {
        throw "[deskfox] sidecar build failed: no fresh binary in packages/opencode/dist/{opencode-windows-x64,opencode-windows-x64-baseline}/bin/. Hint: check bun build output, RUST_TARGET env, and clash/network"
    }
    Copy-Item -Force $srcBin $sidecarPath
    $size = (Get-Item $sidecarPath).Length
    Write-Output "[deskfox] sidecar updated: $sidecarPath ($size bytes)"
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
