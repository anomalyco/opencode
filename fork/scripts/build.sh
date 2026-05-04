#!/bin/bash
# ==============================================================================
# OpenCode 自定义编译脚本 (Build Script)
# ==============================================================================
# 用法 (Usage):
#   ./fork/scripts/build.sh          - 仅编译当前平台的二进制文件 (推荐)
#   ./fork/scripts/build.sh --all    - 编译所有支持平台
#
# 产物位置 (Output):
#   编译后的产物将存放在 ./fork/dist 目录下，该目录已被 git 忽略。
# ==============================================================================

set -e

# 获取项目根目录 (相对于 fork/scripts/ 是两层)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/fork/dist"

# 默认只编译当前平台
BUILD_OPTS="--single"
if [ "$1" == "--all" ]; then
  BUILD_OPTS=""
  echo "🚀 正在为所有平台进行全量编译..."
else
  echo "🚀 正在为当前平台进行编译..."
fi

mkdir -p "$DIST_DIR"

# 进入包目录执行 Bun 编译命令
cd "$ROOT_DIR/packages/opencode"
bun run script/build.ts $BUILD_OPTS

# 将编译产物移动到 fork/dist
echo "📦 正在将编译产物移动到 $DIST_DIR..."
rm -rf "$DIST_DIR"/*
cp -r dist/* "$DIST_DIR/"

echo "✅ 编译完成！产物存放在: fork/dist"
ls -F "$DIST_DIR"
