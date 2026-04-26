# [fork-only] 把 packages/desktop/src-tauri/icons/ 还原到 git HEAD 状态
#
# build 完成后调,保证工作树干净不污染上游 icons/ 文件。
# 这是"build hook 模式"的关键 — git 永远不持有 DeskFox icon,只在 build 期间临时拷贝。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repoRoot = Split-Path -Parent $root  # opencode-fork/

Push-Location $repoRoot
try {
    git checkout HEAD -- packages/desktop/src-tauri/icons/
    if ($LASTEXITCODE -ne 0) { throw "git checkout failed" }
    Write-Output "restored upstream icons (working tree clean)"
} finally {
    Pop-Location
}
