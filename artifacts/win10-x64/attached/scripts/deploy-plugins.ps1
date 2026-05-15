# deploy-plugins.ps1 - 离线部署 Financial Harness 到项目目录
# 首次运行时由 lingxicode.bat 自动调用
#
# 功能：
#   1. 在项目 .opencode/plugin/ 创建 Server Plugin 重定向文件
#   2. 在项目 .opencode/tui.json 创建 TUI Plugin 声明
#   3. 复制命令文件到 .opencode/commands/
#   4. 复制默认配置 lingxi_harness_config.json

$ErrorActionPreference = "Stop"
$noBom = New-Object System.Text.UTF8Encoding $false

# 定位离线包目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgDir = Split-Path -Parent $scriptDir
$fhSrc = "$pkgDir\config\plugins\financial-harness"
$workDir = (Get-Location).Path

# FH 插件路径（正斜杠，用于写入 TS/JSON 文件）
$fhPathSlash = $fhSrc.Replace('\', '/')

Write-Host "[Financial Harness] Deploying to: $workDir" -ForegroundColor Cyan

# 验证源目录
if (-not (Test-Path "$fhSrc\index.ts")) {
    Write-Host "[ERROR] Financial Harness not found: $fhSrc" -ForegroundColor Red
    exit 1
}

# 创建目录
New-Item -ItemType Directory -Force -Path ".opencode\plugin"   | Out-Null
New-Item -ItemType Directory -Force -Path ".opencode\commands" | Out-Null

# Server 插件入口（re-export，指向离线包内路径）
# ⚠️ 必须无 BOM
[System.IO.File]::WriteAllText(
    (Join-Path $workDir ".opencode\plugin\financial-harness.ts"),
    "export { default } from `"$fhPathSlash/index.ts`"",
    $noBom
)

# TUI 插件声明（指向离线包内路径）
# ⚠️ 必须无 BOM
$tuiContent = "{`"`$schema`":`"https://opencode.ai/tui.json`",`"plugin`":[`"$fhPathSlash`"]}"
[System.IO.File]::WriteAllText(
    (Join-Path $workDir ".opencode\tui.json"),
    $tuiContent,
    $noBom
)

# 复制命令文件
Copy-Item "$fhSrc\commands\*.md" ".opencode\commands\" -Force

# 复制默认配置（不覆盖已有）
if (-not (Test-Path "lingxi_harness_config.json")) {
    Copy-Item "$fhSrc\lingxi_harness_config.json" "." -Force
}

# 验证
Write-Host ""
$checks = @(
    @{ Path = ".opencode\tui.json"; Label = "tui.json" },
    @{ Path = ".opencode\plugin\financial-harness.ts"; Label = "Server plugin redirect" },
    @{ Path = "$fhSrc\node_modules\@opentui\solid\package.json"; Label = "@opentui/solid" },
    @{ Path = "$fhSrc\node_modules\solid-js\package.json"; Label = "solid-js" }
)
foreach ($c in $checks) {
    if (Test-Path $c.Path) {
        Write-Host "[OK] $($c.Label)" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $($c.Label)" -ForegroundColor Red
    }
}

$cmdCount = (Get-ChildItem ".opencode\commands\*.md" -EA SilentlyContinue).Count
Write-Host "[OK] Commands: $cmdCount files" -ForegroundColor Green
Write-Host ""
Write-Host "[Financial Harness] Deploy complete." -ForegroundColor Green