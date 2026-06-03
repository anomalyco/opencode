#!/bin/bash
# ============================================================
# 灵犀代码 (LingxiCode) - 麒麟OS x64 一键编译脚本
# 运行环境: Win11 WSL2 Ubuntu
# 用法:
#   ./build-kylin-x64.sh              # 增量编译（默认）
#   ./build-kylin-x64.sh --full       # 全量编译（清理后重新开始）
#   ./build-kylin-x64.sh --full --clean-only  # 仅清理，不编译
#   ./build-kylin-x64.sh --skip-parsers       # 跳过解析器下载
#   ./build-kylin-x64.sh --target=linux-x64  # 仅编译指定目标
# ============================================================

set -e

# ---- 配置 ----
REQUIRED_BUN_VERSION="1.3.11"
BINARY_NAME="opencode"
BUILD_TARGET="opencode-linux-x64"

# ---- 颜色输出 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

info()  { echo -e "${YELLOW}$1${NC}"; }
ok()    { echo -e "${GREEN}$1${NC}"; }
err()   { echo -e "${RED}$1${NC}"; }
step()  { echo -e "${CYAN}$1${NC}"; }
dim()   { echo -e "${GRAY}$1${NC}"; }

# ---- 解析参数 ----
FULL_BUILD=false
CLEAN_ONLY=false
SKIP_PARSERS=false
CUSTOM_TARGET="linux-x64"
SYNC_SOURCE=true

for arg in "$@"; do
    case "$arg" in
        --full)         FULL_BUILD=true ;;
        --clean-only)   CLEAN_ONLY=true ;;
        --skip-parsers) SKIP_PARSERS=true ;;
        --target=*)     CUSTOM_TARGET="${arg#--target=}" ;;
        --no-sync)      SYNC_SOURCE=false ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --full           全量编译（清理所有产物后重新编译）"
            echo "  --clean-only     仅清理，不编译"
            echo "  --skip-parsers   跳过解析器下载（已有缓存时）"
            echo "  --target=NAME    仅编译指定目标（默认: $BUILD_TARGET）"
            echo "  --no-sync        跳过从 Windows 同步源码（已在 WSL2 中时使用）"
            echo "  --help           显示帮助"
            exit 0
            ;;
    esac
done

if [ -n "$CUSTOM_TARGET" ]; then
    BUILD_TARGET="opencode-${CUSTOM_TARGET}"
fi

# ---- 确定项目目录 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 如果脚本在项目根目录下，直接使用
if [ -f "$SCRIPT_DIR/package.json" ] && [ -f "$SCRIPT_DIR/bun.lock" ]; then
    PROJECT_DIR="$SCRIPT_DIR"
else
    PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
fi

echo ""
echo "============================================================"
step "  灵犀代码 - 麒麟OS x64 编译"
echo "============================================================"
echo ""
echo "  模式:   $([ "$FULL_BUILD" = true ] && echo '全量编译' || echo '增量编译')"
echo "  目标:   $BUILD_TARGET"
echo "  目录:   $PROJECT_DIR"
echo ""

# ============================================================
# 步骤 1: 环境检查与安装
# ============================================================
step "[1/6] 环境检查..."

# 检查 WSL2
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    dim "  (非WSL2环境，继续执行)"
fi

# 检查 Bun
BUN_PATH="$HOME/.bun/bin/bun"
if ! [ -x "$BUN_PATH" ] || ! "$BUN_PATH" --version >/dev/null 2>&1; then
    info "  Bun 未安装或版本不正确，安装 $REQUIRED_BUN_VERSION..."
    curl -fsSL https://bun.sh/install | bash -s "bun-v$REQUIRED_BUN_VERSION"
    source ~/.bashrc 2>/dev/null || true
fi

BUN_VER=$("$BUN_PATH" --version 2>/dev/null || echo "unknown")
if [ "$BUN_VER" != "$REQUIRED_BUN_VERSION" ]; then
    info "  Bun 版本 $BUN_VER != $REQUIRED_BUN_VERSION，重新安装..."
    curl -fsSL https://bun.sh/install | bash -s "bun-v$REQUIRED_BUN_VERSION"
    source ~/.bashrc 2>/dev/null || true
    BUN_VER=$("$BUN_PATH" --version 2>/dev/null || echo "unknown")
fi

if [ "$BUN_VER" = "$REQUIRED_BUN_VERSION" ]; then
    ok "  Bun $BUN_VER"
else
    err "  Bun 版本不匹配: $BUN_VER (需要 $REQUIRED_BUN_VERSION)"
    exit 1
fi

export PATH="$HOME/.bun/bin:$PATH"

# ============================================================
# 步骤 2: 清理（仅全量模式）
# ============================================================
step "[2/6] 清理检查..."

if [ "$FULL_BUILD" = true ]; then
    info "  全量模式: 清理旧构建产物..."
    rm -rf packages/opencode/dist
    rm -rf dist-offline
    rm -rf offline-cache
    rm -rf node_modules
    rm -f packages/opencode/models-snapshot.js
    ok "  清理完成"
elif [ -f "packages/opencode/dist/$BUILD_TARGET/bin/$BINARY_NAME" ]; then
    dim "  增量模式: 保留已有产物"
    dim "  已有二进制: $(du -h packages/opencode/dist/$BUILD_TARGET/bin/$BINARY_NAME | cut -f1)"
else
    dim "  增量模式: 无已有产物，将执行完整编译"
fi

if [ "$CLEAN_ONLY" = true ]; then
    ok "  仅清理模式，退出"
    exit 0
fi

# ============================================================
# 步骤 3: 安装依赖
# ============================================================
step "[3/6] 安装依赖..."

if [ "$FULL_BUILD" = true ] || [ ! -d "node_modules" ]; then
    info "  执行 bun install..."
    bun install
    ok "  依赖安装完成"
else
    # 增量模式: 检查 lock 文件是否变化
    dim "  增量模式: 依赖已存在（如需强制重装使用 --full）"
fi

# 安装跨平台原生包（只在全量模式或首次时）
# Bun 的 node_modules 结构: 跨平台包在 node_modules/.bun/ 下
CORE_VER=$(bun -e "console.log(require('./packages/opencode/package.json').dependencies['@opentui/core'])")
WATCHER_VER=$(bun -e "console.log(require('./packages/opencode/package.json').dependencies['@parcel/watcher'])")

HAS_X64_NATIVE=false
if ls node_modules/.bun/@parcel+watcher-linux-x64-glibc* >/dev/null 2>&1; then
    HAS_X64_NATIVE=true
fi

if [ "$FULL_BUILD" = true ] || [ "$HAS_X64_NATIVE" = false ]; then
    info "  安装跨平台原生包..."
    bun install --os="*" --cpu="*" "@opentui/core@$CORE_VER"
    bun install --os="*" --cpu="*" "@parcel/watcher@$WATCHER_VER"
    ok "  跨平台原生包安装完成"
else
    dim "  跨平台原生包已存在"
fi

# ============================================================
# 步骤 4: 生成模型快照
# ============================================================
step "[4/6] 生成模型快照..."

SNAPSHOT_FILE="packages/opencode/models-snapshot.js"
if [ "$FULL_BUILD" = true ] || [ ! -f "$SNAPSHOT_FILE" ]; then
    bun run packages/opencode/script/generate.ts || {
        err "  模型快照生成失败（需要外网），尝试使用已有文件..."
        if [ ! -f "$SNAPSHOT_FILE" ]; then
            err "  无已有快照文件，无法继续"
            exit 1
        fi
    }
    ok "  模型快照已生成"
else
    dim "  模型快照已存在（如需更新使用 --full）"
fi

# ============================================================
# 步骤 5: 下载离线解析器
# ============================================================
step "[5/6] 离线解析器..."

if [ "$SKIP_PARSERS" = true ] || [ -d "offline-cache/parsers" ]; then
    dim "  跳过解析器下载（--skip-parsers）"
elif [ "$FULL_BUILD" = true ] || [ ! -d "offline-cache/parsers" ]; then
    bun run script/offline-cache-parsers.ts || {
        dim "  解析器下载部分失败（不影响核心功能）"
    }
    ok "  离线解析器已下载"
else
    PARSER_COUNT=$(find offline-cache/parsers -name "*.wasm" 2>/dev/null | wc -l)
    dim "  离线解析器已存在 ($PARSER_COUNT 个WASM文件)"
fi

# ============================================================
# 步骤 6: 编译
# ============================================================
step "[6/6] 编译 $BUILD_TARGET..."

cd packages/opencode

# 检查是否已有编译产物
BINARY_PATH="dist/$BUILD_TARGET/bin/$BINARY_NAME"

    # 编译
    info "  开始编译（默认不内嵌 Web UI）..."
    OPENCODE_CHANNEL=latest bun run script/build.ts \
        --target=${CUSTOM_TARGET} \
        --skip-embed-web-ui \
        --skip-install \
        2>&1 | while IFS= read -r line; do
            # 过滤掉下载进度条，只保留关键输出
            if [[ ! "$line" =~ Downloading|Decompressing|Extracting ]] || [[ "$line" =~ building|Embedded|Smoke|error|Error ]]; then
                echo "  $line"
            fi
        done

    # 验证编译产物
    if [ ! -f "$BINARY_PATH" ]; then
        err "  编译失败: 未找到产物 $BINARY_PATH"
        exit 1
    fi

    BINARY_FILE=$(file "$BINARY_PATH")
    BINARY_SIZE=$(du -h "$BINARY_PATH" | cut -f1)

    if echo "$BINARY_FILE" | grep -q "x86-64"; then
        ok "  编译成功: x86-64, $BINARY_SIZE"
    else
        err "  编译产物架构异常: $BINARY_FILE"
        exit 1
    fi

cd "$PROJECT_DIR"

# 记录编译信息
BUILD_LOG="dist-offline/build-info.json"
cat > "$BUILD_LOG" << BIEOF
{
  "version": "$VERSION",
  "buildTarget": "$BUILD_TARGET",
  "buildMode": "$([ "$FULL_BUILD" = true ] && echo 'full' || echo 'incremental')",
  "buildDate": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "bunVersion": "$BUN_VER",
  "binarySize": "$BINARY_SIZE",
  "zipSize": "$ZIP_SIZE",
  "zipFile": "$ZIP_FILE",
  "platform": "linux-x64-glibc",
  "targetOS": "Kylin V10 SP1"
}
BIEOF

dim "  构建信息: $BUILD_LOG"
