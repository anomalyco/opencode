#!/usr/bin/env bash
# [fork-only] DeskFox PNG → .icns 转换器(macOS only,用 iconutil)
#
# .icns 是 macOS 原生 icon 格式。iconutil 是 macOS 内置工具(无需 brew)。
# 标准 iconset 命名规范:
#   icon_16x16.png       icon_16x16@2x.png      → 32x32
#   icon_32x32.png       icon_32x32@2x.png      → 64x64
#   icon_128x128.png     icon_128x128@2x.png    → 256x256
#   icon_256x256.png     icon_256x256@2x.png    → 512x512
#   icon_512x512.png     icon_512x512@2x.png    → 1024x1024
#
# 输入:ico-source/<size>.png(我们仓现有命名约定,size = 16/32/64/128/256/512/1024)
# 输出:<env>/icon.icns
#
# 用法:bash png-to-icns.sh <out.icns> <ico-source-dir>

set -e

OUT_ICNS="$1"
SRC_DIR="$2"

if [[ -z "$OUT_ICNS" || -z "$SRC_DIR" ]]; then
    echo "Usage: $0 <out.icns> <ico-source-dir>" >&2
    exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
    echo "Error: source dir '$SRC_DIR' not found" >&2
    exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
    echo "Error: iconutil not found — this script must run on macOS" >&2
    exit 1
fi

ICONSET_DIR=$(mktemp -d)/icon.iconset
mkdir -p "$ICONSET_DIR"
trap "rm -rf $(dirname "$ICONSET_DIR")" EXIT

# 按 iconset 命名规范从 ico-source/ 拷文件;source 缺哪档就跳过哪档
# (.icns 不要求所有档齐全,缺档系统会从最近大档缩;但常用档建议齐全)
copy_if_exists() {
    local src="$SRC_DIR/$1"
    local dst="$ICONSET_DIR/$2"
    if [[ -f "$src" ]]; then
        cp "$src" "$dst"
    fi
}

copy_if_exists "16.png"   "icon_16x16.png"
copy_if_exists "32.png"   "icon_16x16@2x.png"
copy_if_exists "32.png"   "icon_32x32.png"
copy_if_exists "64.png"   "icon_32x32@2x.png"
copy_if_exists "128.png"  "icon_128x128.png"
copy_if_exists "256.png"  "icon_128x128@2x.png"
copy_if_exists "256.png"  "icon_256x256.png"
copy_if_exists "512.png"  "icon_256x256@2x.png"
copy_if_exists "512.png"  "icon_512x512.png"
copy_if_exists "1024.png" "icon_512x512@2x.png"

# 验证至少有一档
if [[ -z "$(ls -A "$ICONSET_DIR")" ]]; then
    echo "Error: no PNG copied — source dir empty or naming wrong (expected 16.png/32.png/...)" >&2
    exit 1
fi

iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"

# iconutil 自带验证,失败会非 0 退出
echo "wrote $OUT_ICNS ($(stat -f%z "$OUT_ICNS" 2>/dev/null || stat -c%s "$OUT_ICNS") bytes)"
