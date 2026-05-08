#!/usr/bin/env bash
# [fork-only] DeskFox 一键构建 wrapper(macOS / Linux 版,对称 build-deskfox.ps1)
#
# 流程:
#   0. (auto)确保 sidecar 已 build — RUST_TARGET=<host triple>;packages/opencode/ 出 cli binary
#   1. apply-icons.sh   把 DeskFox PNG/.ico/.icns 临时拷到 src-tauri/icons/{env}/
#   2. tauri build      --config tauri-overrides/<env>.json
#   3. restore-icons.sh git checkout HEAD -- src-tauri/icons/(还原工作树)
#
# 用法:
#   bash packages/branding/scripts/build-deskfox.sh -Env dev
#   bash packages/branding/scripts/build-deskfox.sh -Env prod
#   bash packages/branding/scripts/build-deskfox.sh -Env beta
#   bash packages/branding/scripts/build-deskfox.sh -Env prod --no-bundle  # 跳过 dmg/app bundle,只产 raw binary

set -e

ENV=""
NO_BUNDLE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e)
            ENV="$2"
            shift 2
            ;;
        --no-bundle|-NoBundle)
            NO_BUNDLE=1
            shift
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 1
            ;;
    esac
done

if [[ "$ENV" != "dev" && "$ENV" != "beta" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 -Env <dev|beta|prod> [--no-bundle]" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"

OVERRIDE="$BRANDING_ROOT/tauri-overrides/$ENV.json"
if [[ ! -f "$OVERRIDE" ]]; then
    echo "tauri override not found: $OVERRIDE" >&2
    exit 1
fi

# === 0. 确保 sidecar 已 build(自动检测 host RUST_TARGET) ===
# 上游 packages/desktop/scripts/predev.ts 里的逻辑:
#   - macOS arm64    → aarch64-apple-darwin     → opencode-darwin-arm64
#   - macOS x64      → x86_64-apple-darwin      → opencode-darwin-x64-baseline
#   - Linux x64      → x86_64-unknown-linux-gnu → opencode-linux-x64-baseline
#   - Linux arm64    → aarch64-unknown-linux-gnu → opencode-linux-arm64
detect_rust_target() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"
    case "$os/$arch" in
        Darwin/arm64)   echo "aarch64-apple-darwin" ;;
        Darwin/x86_64)  echo "x86_64-apple-darwin" ;;
        Linux/x86_64)   echo "x86_64-unknown-linux-gnu" ;;
        Linux/aarch64)  echo "aarch64-unknown-linux-gnu" ;;
        *) echo "" ;;
    esac
}

if [[ -z "$RUST_TARGET" ]]; then
    export RUST_TARGET="$(detect_rust_target)"
    if [[ -z "$RUST_TARGET" ]]; then
        echo "Cannot detect RUST_TARGET (uname=$(uname -s)/$(uname -m)). Set manually before run." >&2
        exit 1
    fi
fi
echo "[deskfox] RUST_TARGET=$RUST_TARGET"

# 绕过上游 packages/desktop/scripts/predev.ts:它会按 SIDECAR_BINARIES 表跑 build --single --baseline,
# Bun.compile 内部需要从 GitHub 拉 ~190MB 的 bun-darwin-arm64-baseline 运行时,clash/CI 网络常超时失败
# (实测 GitHub Actions macos-latest runner build 卡 57 分钟触发 1h 超时,2026-05-07 ship-mac-prod-2026.5.7.1)。
# DeskFox 用户群默认现代 CPU(都有 AVX2),baseline 二进制不需要兜底,直接 build --single 即可,
# 输出 dist/opencode-darwin-{arm64,x64}/bin/opencode,复用本机已有的 bun runtime,零下载。
# 跟 Win 侧 build-deskfox.ps1 同等修法(commit 696bbcc00 / [feat: post-sync-build-fix])。

# 把 RUST_TARGET 转成 build.ts 输出目录名:aarch64-apple-darwin → opencode-darwin-arm64
case "$RUST_TARGET" in
    aarch64-apple-darwin)   BUILD_DIR_NAME="opencode-darwin-arm64" ;;
    x86_64-apple-darwin)    BUILD_DIR_NAME="opencode-darwin-x64" ;;
    aarch64-unknown-linux-gnu) BUILD_DIR_NAME="opencode-linux-arm64" ;;
    x86_64-unknown-linux-gnu)  BUILD_DIR_NAME="opencode-linux-x64" ;;
    *) echo "Unknown RUST_TARGET=$RUST_TARGET, cannot map to build.ts dir" >&2; exit 1 ;;
esac

SIDECAR_PATH="$REPO_ROOT/packages/desktop/src-tauri/sidecars/opencode-cli-${RUST_TARGET}"
if [[ ! -f "$SIDECAR_PATH" ]]; then
    echo "[deskfox] sidecar not found, building via 'bun run build --single' (no --baseline, RUST_TARGET=$RUST_TARGET)..."
    (
        cd "$REPO_ROOT/packages/opencode"
        bun run build --single
    )
    SRC_BIN="$REPO_ROOT/packages/opencode/dist/$BUILD_DIR_NAME/bin/opencode"
    if [[ ! -f "$SRC_BIN" ]]; then
        echo "Error: sidecar build reported success but no binary at $SRC_BIN" >&2
        echo "Hint: 检查 bun 输出 / @opentui/core 安装" >&2
        exit 1
    fi
    # CI 干净 checkout 时 sidecars/ 目录可能不存在
    mkdir -p "$(dirname "$SIDECAR_PATH")"
    cp "$SRC_BIN" "$SIDECAR_PATH"
    chmod +x "$SIDECAR_PATH"
    echo "[deskfox] sidecar built: $(stat -f%z "$SIDECAR_PATH" 2>/dev/null || stat -c%s "$SIDECAR_PATH") bytes"
else
    echo "[deskfox] sidecar exists: $SIDECAR_PATH"
fi

# === 1. apply icons(按 env 选样式)===
bash "$SCRIPT_DIR/apply-icons.sh" -Env "$ENV"

# === 1.5 注入 VITE_DESKFOX_ENV 让前端 logo.tsx Mark 组件按 env 选样式 ===
export VITE_DESKFOX_ENV="$ENV"

# === 2. tauri build ===
BUILD_EXIT=0
(
    cd "$REPO_ROOT/packages/desktop"
    if [[ "$NO_BUNDLE" -eq 1 ]]; then
        bun run tauri build --no-bundle --config "$OVERRIDE"
    else
        bun run tauri build --config "$OVERRIDE"
    fi
) || BUILD_EXIT=$?

# === 3. restore(无论 build 成败都还原)===
bash "$SCRIPT_DIR/restore-icons.sh"

if [[ "$BUILD_EXIT" -ne 0 ]]; then
    echo "[deskfox] Warning: tauri build exited with code $BUILD_EXIT" >&2
fi

# === 4. 提示产物路径 ===
echo ""
case "$(uname -s)" in
    Darwin)
        APP_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app"
        DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"
        BIN_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/DeskFox"
        if [[ -f "$BIN_PATH" ]]; then
            echo "✓ raw binary: $BIN_PATH"
        fi
        if [[ -d "$APP_PATH" ]]; then
            echo "✓ .app bundle: $APP_PATH"
        fi
        if [[ -d "$DMG_DIR" ]]; then
            echo "✓ .dmg dir:    $DMG_DIR"
            ls "$DMG_DIR"/*.dmg 2>/dev/null | sed 's/^/  /'
            # FORK: 给 .dmg 文件设自定义图标(Finder 里显示狐狸,不再是通用磁盘映像图标)
            # 需 brew install fileicon;未装则提示后跳过,不影响 build 2026-05-06
            if command -v fileicon >/dev/null 2>&1; then
                ICNS="$DMG_DIR/icon.icns"
                if [[ -f "$ICNS" ]]; then
                    for DMG in "$DMG_DIR"/*.dmg; do
                        [[ -f "$DMG" ]] || continue
                        if fileicon set "$DMG" "$ICNS" >/dev/null 2>&1; then
                            echo "  ✓ icon set on $(basename "$DMG")"
                        fi
                    done
                fi
            else
                echo "  (未装 fileicon — .dmg 用通用磁盘映像图标;装:brew install fileicon)"
            fi
        fi
        echo ""
        echo "macOS Gatekeeper(不签名):首次打开 → 右键 .app → 打开 → 仍要打开"
        echo "或彻底去 quarantine:xattr -cr \"$APP_PATH\""
        ;;
    Linux)
        BIN_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/DeskFox"
        if [[ -f "$BIN_PATH" ]]; then
            echo "✓ raw binary: $BIN_PATH"
        fi
        DEB_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/deb"
        if [[ -d "$DEB_DIR" ]]; then
            echo "✓ .deb dir:   $DEB_DIR"
        fi
        ;;
esac

exit "$BUILD_EXIT"
