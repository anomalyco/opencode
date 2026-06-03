#!/bin/bash
# deploy-plugins.sh - 离线部署 Financial Harness 到项目目录
# 首次运行时由 lingxicode.sh 自动调用
#
# 功能：
#   1. 在项目 .opencode/plugin/ 创建 Server Plugin 重定向文件
#   2. 在项目 .opencode/tui.json 创建 TUI Plugin 声明
#   3. 复制命令文件到 .opencode/commands/
#   4. 复制默认配置 lingxi_harness_config.json

set -e

# 定位离线包目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
FH_SRC="$PKG_DIR/config/plugins/financial-harness"
WORK_DIR="$(pwd)"

echo "[Financial Harness] Deploying to: $WORK_DIR"

# 验证源目录
if [ ! -f "$FH_SRC/index.ts" ]; then
    echo "[ERROR] Financial Harness not found: $FH_SRC"
    exit 1
fi

# 创建目录
mkdir -p ".opencode/plugin"
mkdir -p ".opencode/commands"

# Server 插件入口（re-export，指向离线包内路径）
echo "export { default } from \"$FH_SRC/index.ts\"" > ".opencode/plugin/financial-harness.ts"

# TUI 插件声明（指向离线包内路径）
echo "{\"\$schema\":\"https://opencode.ai/tui.json\",\"plugin\":[\"$FH_SRC\"]}" > ".opencode/tui.json"

# 复制命令文件
cp "$FH_SRC/commands/"*.md ".opencode/commands/"

# 复制默认配置（不覆盖已有）
if [ ! -f "lingxi_harness_config.json" ]; then
    cp "$FH_SRC/lingxi_harness_config.json" .
fi

# 验证
echo ""
check_file() {
    if [ -f "$1" ]; then
        echo "[OK] $2"
    else
        echo "[FAIL] $2"
    fi
}

check_file ".opencode/tui.json" "tui.json"
check_file ".opencode/plugin/financial-harness.ts" "Server plugin redirect"
check_file "$FH_SRC/node_modules/@opentui/solid/package.json" "@opentui/solid"
check_file "$FH_SRC/node_modules/solid-js/package.json" "solid-js"
check_file "$FH_SRC/node_modules/@opentui/core-linux-arm64/package.json" "@opentui/core-linux-arm64"

CMD_COUNT=$(ls -1 .opencode/commands/*.md 2>/dev/null | wc -l)
echo "[OK] Commands: $CMD_COUNT files"
echo ""
echo "[Financial Harness] Deploy complete."