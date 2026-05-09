# [fork-only] 打包飞书桥接 plugin 进 installer 用(Win 版,对称 build-feishu-plugin.sh)
# bun build 把 adapter-feishu-lark/src/plugin.ts 跟全部 deps 打成单 dist/plugin.js,
# Tauri 把这个目录作为 resource ship 进 .exe installer。装完 lib.rs setup hook 写 user opencode 配置。
#
# 用法: powershell -File packages/branding/scripts/build-feishu-plugin.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BrandingRoot = Split-Path -Parent $ScriptDir
$RepoRoot = Split-Path -Parent (Split-Path -Parent $BrandingRoot)

$AdapterSrc = Join-Path $RepoRoot "packages\adapter-feishu-lark\src"
$Entry = Join-Path $AdapterSrc "plugin.ts"
$OutDir = Join-Path $BrandingRoot "plugin\feishu-bridge\dist"
$OutFile = Join-Path $OutDir "plugin.js"

if (-not (Test-Path $Entry)) {
    Write-Error "[feishu-plugin] entry not found: $Entry"
    exit 1
}

# 时间戳判断:adapter-feishu-lark/src 任一 .ts 比 dist/plugin.js 新 → rebuild
$NeedRebuild = $true
if (Test-Path $OutFile) {
    $OutMtime = (Get-Item $OutFile).LastWriteTime
    $LatestSrc = Get-ChildItem -Recurse -File -Path $AdapterSrc -Include "*.ts" -ErrorAction SilentlyContinue |
        Measure-Object -Property LastWriteTime -Maximum
    if ($LatestSrc.Maximum -and $LatestSrc.Maximum -le $OutMtime) {
        $NeedRebuild = $false
    }
}

if (-not $NeedRebuild) {
    Write-Host "[feishu-plugin] up-to-date: $OutFile"
    exit 0
}

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

Write-Host "[feishu-plugin] bundling $Entry -> $OutFile ..."
& bun build $Entry `
    --outfile=$OutFile `
    --target=bun `
    --external='@opencode-ai/plugin' `
    --external='@opencode-ai/sdk' `
    --external='@opencode-ai/sdk/v2' `
    --external='@opencode-ai/core' `
    --external='@opencode-ai/core/*'

if (-not (Test-Path $OutFile)) {
    Write-Error "[feishu-plugin] build reported success but no output at $OutFile"
    exit 1
}

$OutSize = (Get-Item $OutFile).Length
Write-Host "[feishu-plugin] bundled: $([math]::Round($OutSize / 1024)) KB"
