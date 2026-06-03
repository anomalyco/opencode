<#
.SYNOPSIS
    打包 LINGXI CODE 麒麟 OS V10 x64 离线部署包
.DESCRIPTION
    将构建好的 x64 二进制、离线解析器、配置文件、启动脚本打包为
    可直接在内网麒麟 OS 上部署的 tar.gz 包。
.PARAMETER Target
    构建目标类型，需与 build-kylin-x64.sh 一致。默认 linux-x64。
.PARAMETER OutputDir
    输出目录。默认 <project-root>/dist-offline-kylin-x64
.EXAMPLE
    .\build-kylin-x64-release-package.ps1
    使用默认配置打包
#>

param(
    [ValidateSet("linux-x64")]
    [string]$Target = "linux-x64",
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $ProjectRoot "packages\opencode"
$ParsersCacheDir = Join-Path $ProjectRoot "offline-cache\parsers"
$ArtifactDir = Join-Path $ProjectRoot "artifacts\kylin-x64\release"
$ArtifactDirAttached = Join-Path $ProjectRoot "artifacts\kylin-x64\attached"

if (-not $OutputDir) {
    $OutputDir = Join-Path $ProjectRoot "dist-offline-kylin-x64"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LINGXI CODE Kylin V10 Offline Packaging" -ForegroundColor Cyan
Write-Host "  Target: $Target" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ── 查找二进制 ────────────────────────────────────────
$binary = Join-Path $BuildDir "dist\opencode-$Target\bin\opencode"
$binaryZip = Join-Path $BuildDir "dist\opencode-$Target\bin\opencode.zip"
$binaryBin = Join-Path $BuildDir "dist\opencode-$Target\bin"
if (-not (Test-Path $binary)) {
    if (-not (Test-Path $binaryZip)) {
        Write-Error "x64 binary not found: $binaryZip"
        exit 1
    }
    Expand-Archive -Path $binaryZip -DestinationPath $binaryBin -Force
    if (-not (Test-Path $binary)) {
        Write-Error "x64 binary not found: $binary"
        exit 1
    }
}
$binarySize = [math]::Round((Get-Item $binary).Length / 1MB, 1)
Write-Host "`n  Binary found: $binary ($binarySize MB)" -ForegroundColor Gray

# ── 清理输出目录 ──────────────────────────────────────
if (Test-Path $OutputDir) {
    Write-Host "  Cleaning output directory..." -ForegroundColor Gray
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# ── 复制二进制 ────────────────────────────────────────
Write-Host "`n[1/3] Copying binary..." -ForegroundColor Yellow
$OutputDirBin = Join-Path $OutputDir "bin"
New-Item -ItemType Directory -Path $OutputDirBin -Force | Out-Null
Copy-Item $binary (Join-Path $OutputDirBin "opencode") -Force
Write-Host "  Done." -ForegroundColor Green

# ── 复制配置文件 ──────────────────────────────────────
if (Test-Path $ArtifactDirAttached) {
    Copy-Item -Path "$ArtifactDirAttached\*" -Destination $OutputDir -Recurse -Force
    Write-Host "Copied attached files"
}

# ── 复制解析器 ────────────────────────────────────────
Write-Host "`n[2/3] Copying offline parsers..." -ForegroundColor Yellow
if (Test-Path $ParsersCacheDir) {
    Copy-Item -Path $ParsersCacheDir -Destination (Join-Path $OutputDir "parsers") -Recurse -Force
    $parserCount = (Get-ChildItem (Join-Path $OutputDir "parsers") -Directory).Count
    Write-Host "  Copied $parserCount parser directories." -ForegroundColor Green
} else {
    Write-Host "  WARNING: No offline parser cache found at $ParsersCacheDir" -ForegroundColor DarkYellow
    Write-Host "  Run 'bun run script/offline-cache-parsers.ts' first." -ForegroundColor DarkYellow
}

# ── 打包 ──────────────────────────────────────────────
Write-Host "`n[3/3] Creating tar.gz archive..." -ForegroundColor Yellow
$PackageJson = Get-Content (Join-Path $BuildDir "package.json") -Encoding UTF8 | ConvertFrom-Json
$Version = $PackageJson.version
$tarName = "lingxicode-offline-v${Version}-kylin-x64.tar.gz"
$tarPath = Join-Path $ArtifactDir $tarName

# 尝试使用 WSL 的 tar（Windows 原生 tar 在新版 Windows 也可用）
$wslAvailable = $false
try {
    $wslCheck = wsl --list --quiet 2>$null
    if ($LASTEXITCODE -eq 0) { $wslAvailable = $true }
} catch {
    $wslAvailable = $false
}

# 检查 Windows 自带 tar
$winTarAvailable = $false
try {
    $tarCheck = tar --version 2>$null
    if ($LASTEXITCODE -eq 0) { $winTarAvailable = $true }
} catch {
    $winTarAvailable = $false
}

if ($winTarAvailable) {
    Write-Host "  Using Windows tar..." -ForegroundColor Gray
    Push-Location $OutputDir
    tar -czf $tarPath .
    Pop-Location
} elseif ($wslAvailable) {
    Write-Host "  Using WSL tar..." -ForegroundColor Gray
    $wslOutputDir = (wsl wslpath "$OutputDir").Trim()
    Push-Location $OutputDir
    wsl tar -czf (wsl wslpath "$tarPath") -C $wslOutputDir .
    Pop-Location
} else {
    Write-Host "  WARNING: No tar available. Skipping archive creation." -ForegroundColor DarkYellow
    Write-Host "  You can manually archive the directory: $OutputDir" -ForegroundColor DarkYellow
    $tarPath = $null
}

# 创建 SHA256
if (Test-Path $tarPath) {
    $runSh = Get-FileHash -Path $tarPath -Algorithm SHA256
    $runShUnix = $runSh.Hash.ToLower() + "  " + $tarName
    [System.IO.File]::WriteAllText(
        (Join-Path $ArtifactDir "SHA256SUMS"),
        $runShUnix,
        [System.Text.UTF8Encoding]::new($false)
    )
}

# ── 完成 ──────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Packaging SUCCESS" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Output dir: $OutputDir" -ForegroundColor Green
if ($tarPath -and (Test-Path $tarPath)) {
    $tarSize = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
    Write-Host "  Archive:    $tarPath ($tarSize MB)" -ForegroundColor Green
}
Write-Host ""

# 列出打包内容概览
Write-Host "  Package contents:" -ForegroundColor Cyan
$items = Get-ChildItem $OutputDir -Force
foreach ($item in $items) {
    if ($item.PSIsContainer) {
        $count = (Get-ChildItem $item.FullName -Recurse -File).Count
        Write-Host "    $($item.Name)/ ($count files)" -ForegroundColor Gray
    } else {
        $size = [math]::Round($item.Length / 1MB, 1)
        Write-Host "    $($item.Name) ($size MB)" -ForegroundColor Gray
    }
}
Write-Host ""
Write-Host "  Deploy to Kylin OS:" -ForegroundColor Cyan
Write-Host "    1. Copy $tarName to target machine" -ForegroundColor Gray
Write-Host "    2. tar -xzf $tarName" -ForegroundColor Gray
Write-Host "    3. chmod +x lingxicode.sh bin/opencode" -ForegroundColor Gray
Write-Host "    4. export ENTERPRISE_API_KEY='your-key'" -ForegroundColor Gray
Write-Host "    5. ./lingxicode.sh" -ForegroundColor Gray
