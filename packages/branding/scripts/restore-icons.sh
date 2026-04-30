#!/usr/bin/env bash
# [fork-only] 把 packages/desktop/src-tauri/icons/ 还原到 git HEAD 状态
#
# build 完成后调,保证工作树干净不污染上游 icons/ 文件。
# 这是"build hook 模式"的关键 — git 永远不持有 DeskFox icon,只在 build 期间临时拷贝。
#
# macOS / Linux 对称版 restore-icons.ps1。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

(
    cd "$REPO_ROOT"
    git checkout HEAD -- packages/desktop/src-tauri/icons/
)

echo "restored upstream icons (working tree clean)"
