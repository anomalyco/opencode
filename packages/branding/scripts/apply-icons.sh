#!/usr/bin/env bash
# [fork-only] DeskFox icon 拷贝脚本(macOS / Linux 版,对称 apply-icons.ps1)
#
# 把 packages/branding/src/assets/icons/<env>/ 下的 PNG + 现场生成的 .ico/.icns
# 拷到 packages/desktop/src-tauri/icons/<env>/
#
# 三套样式:
#   prod  → icon-primary 样式(完整美观,正式发布)
#   beta  → icon-mono     样式(单色,测试阶段)
#   dev   → icon-favicon  样式(极简,开发调试)
#
# 跟 build-deskfox.sh 配套用:build 前调本脚本,build 后由 restore-icons.sh 还原 git。
#
# 用法:bash apply-icons.sh -Env <dev|beta|prod>

set -e

ENV=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e)
            ENV="$2"
            shift 2
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 1
            ;;
    esac
done

if [[ "$ENV" != "dev" && "$ENV" != "beta" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 -Env <dev|beta|prod>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"

ENV_ASSETS="$BRANDING_ROOT/src/assets/icons/$ENV"
ENV_ICO_SRC="$ENV_ASSETS/ico-source"
TAURI_ENV_DIR="$REPO_ROOT/packages/desktop/src-tauri/icons/$ENV"

if [[ ! -d "$ENV_ASSETS" ]]; then
    echo "branding assets not found for env=$ENV: $ENV_ASSETS" >&2
    exit 1
fi

# 1. 现场生成多分辨率 icon.ico(跟 .ps1 一致 — Mac build 时也产 .ico,
#    虽然 macOS bundle 不直接用 .ico,但保持产物对称便于 cross-build / debug)
ICO_OUT="$ENV_ASSETS/icon.ico"
PNGS=()
for f in "$ENV_ICO_SRC"/[0-9]*.png; do
    [[ -f "$f" ]] && PNGS+=("$f")
done

if [[ ${#PNGS[@]} -eq 0 ]]; then
    echo "no PNGs in $ENV_ICO_SRC (expected files like 16.png, 32.png, 256.png)" >&2
    exit 1
fi

# 按尺寸升序
IFS=$'\n' SORTED_PNGS=($(for p in "${PNGS[@]}"; do
    base=$(basename "$p" .png)
    echo "$base $p"
done | sort -n | awk '{print $2}'))
unset IFS

(
    cd "$REPO_ROOT"
    bun packages/branding/scripts/png-to-ico.ts "$ICO_OUT" "${SORTED_PNGS[@]}"
)

# 2. macOS 专属 — 生成 .icns(用 iconutil)
ICNS_OUT="$ENV_ASSETS/icon.icns"
if [[ "$(uname)" == "Darwin" ]] && command -v iconutil >/dev/null 2>&1; then
    bash "$SCRIPT_DIR/png-to-icns.sh" "$ICNS_OUT" "$ENV_ICO_SRC"
else
    echo "(skip .icns gen — not on macOS or iconutil missing)"
fi

# 3. 拷 PNG + ICO + ICNS 到 src-tauri/icons/<env>/
cp -f "$ENV_ASSETS/32x32.png"        "$TAURI_ENV_DIR/32x32.png"
cp -f "$ENV_ASSETS/128x128.png"      "$TAURI_ENV_DIR/128x128.png"
cp -f "$ENV_ASSETS/128x128@2x.png"   "$TAURI_ENV_DIR/128x128@2x.png"
cp -f "$ICO_OUT"                     "$TAURI_ENV_DIR/icon.ico"
[[ -f "$ICNS_OUT" ]] && cp -f "$ICNS_OUT" "$TAURI_ENV_DIR/icon.icns"

echo "applied DeskFox $ENV icons → $TAURI_ENV_DIR"

# 4. 同步覆盖 src-tauri/icons/dev/{icon.ico,icon.icns}
#    Tauri 2.10.1 winres / mac bundle 嵌入 icon **只读** icons/dev/(即 base config
#    tauri.conf.json bundle.icon 路径),完全无视 --config 里 prod.json 的 bundle.icon
#    override(已 A/B 验证 winres 是这样,Mac 大概率同坑)。
#    详见 docs/features/icon-pipeline-deep-fix/3-changelog.md
if [[ "$ENV" != "dev" ]]; then
    DEV_ICO="$REPO_ROOT/packages/desktop/src-tauri/icons/dev/icon.ico"
    cp -f "$ICO_OUT" "$DEV_ICO"
    echo "also synced → $DEV_ICO (winres base path)"

    if [[ -f "$ICNS_OUT" ]]; then
        DEV_ICNS="$REPO_ROOT/packages/desktop/src-tauri/icons/dev/icon.icns"
        cp -f "$ICNS_OUT" "$DEV_ICNS"
        echo "also synced → $DEV_ICNS (mac bundle base path)"
    fi
fi
