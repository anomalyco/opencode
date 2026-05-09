#!/usr/bin/env bash
# [fork-only] 打包飞书桥接 plugin 进 installer 用 — bun build 把 adapter-feishu-lark/src/plugin.ts
# 跟全部 deps 打成单 dist/plugin.js,Tauri 把这个目录作为 resource ship 进 .app/.dmg/.exe。
# 装完 installer 后 lib.rs setup hook 把 plugin 路径写进 user opencode 配置。
#
# 跟 sidecar build 同款时间戳判断:adapter-feishu-lark/src 内有新于 dist/plugin.js → rebuild;
# 否则跳过(节省 build 时间,Win 端 build-pipeline-sidecar-fix b9581b76e 同等修法)。
#
# 用法:
#   bash packages/branding/scripts/build-feishu-plugin.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"

ADAPTER_SRC="$REPO_ROOT/packages/adapter-feishu-lark/src"
ENTRY="$ADAPTER_SRC/plugin.ts"
OUT_DIR="$BRANDING_ROOT/plugin/feishu-bridge/dist"
OUT_FILE="$OUT_DIR/plugin.js"

if [[ ! -f "$ENTRY" ]]; then
    echo "[feishu-plugin] entry not found: $ENTRY" >&2
    exit 1
fi

# 时间戳判断:adapter-feishu-lark/src 任一 .ts 比 dist/plugin.js 新 → rebuild
need_rebuild() {
    [[ ! -f "$OUT_FILE" ]] && return 0
    local latest_src
    latest_src=$(find "$ADAPTER_SRC" -name "*.ts" -type f -exec stat -f%m {} + 2>/dev/null | sort -rn | head -1)
    [[ -z "$latest_src" ]] && return 1
    local out_mtime
    out_mtime=$(stat -f%m "$OUT_FILE" 2>/dev/null)
    [[ -z "$out_mtime" ]] && return 0
    [[ "$latest_src" -gt "$out_mtime" ]]
}

if ! need_rebuild; then
    echo "[feishu-plugin] up-to-date: $OUT_FILE"
    exit 0
fi

mkdir -p "$OUT_DIR"

echo "[feishu-plugin] bundling $ENTRY → $OUT_FILE ..."
# external @opencode-ai/plugin + sdk:这些 sidecar runtime 提供(PluginInput),不能内嵌
# external @opencode-ai/core:sidecar 已有,内嵌会重复
bun build "$ENTRY" \
    --outfile="$OUT_FILE" \
    --target=bun \
    --external='@opencode-ai/plugin' \
    --external='@opencode-ai/sdk' \
    --external='@opencode-ai/sdk/v2' \
    --external='@opencode-ai/core' \
    --external='@opencode-ai/core/*'

if [[ ! -f "$OUT_FILE" ]]; then
    echo "[feishu-plugin] build reported success but no output at $OUT_FILE" >&2
    exit 1
fi

OUT_SIZE=$(stat -f%z "$OUT_FILE" 2>/dev/null)
echo "[feishu-plugin] bundled: $((OUT_SIZE / 1024)) KB"
