#!/usr/bin/env bash
set -euo pipefail

APP=opencode

# Colors
RED='\033[0;31m'
MUTED='\033[0;2m'
GREEN='\033[0;32m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Self-location & portable directory
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PORTABLE_DIR="$SCRIPT_DIR/.opencode_portable"
BIN_PATH="$PORTABLE_DIR/bin/$APP"
VERSION_FILE="$PORTABLE_DIR/.version"

# ---------------------------------------------------------------------------
# Parse wrapper-specific flags (--portable-*)
# Everything else is collected for passthrough to the OpenCode binary.
# ---------------------------------------------------------------------------
portable_help=false
portable_update=false
portable_version=false
passthrough_args=()

for arg in "$@"; do
    case "$arg" in
        --portable-help)    portable_help=true ;;
        --portable-update)  portable_update=true ;;
        --portable-version) portable_version=true ;;
        *)                  passthrough_args+=("$arg") ;;
    esac
done

# ---------------------------------------------------------------------------
# --portable-help
# ---------------------------------------------------------------------------
if [ "$portable_help" = true ]; then
    cat <<EOF
OpenCode Portable Wrapper

Usage: $(basename "$0") [wrapper-options] [opencode-options...]

Wrapper options (consumed by this script):
    --portable-help      Show this help message
    --portable-update    Force re-download of the OpenCode binary
    --portable-version   Show the currently cached version

All other arguments are passed through to the OpenCode binary.

Environment variables:
    OPENCODE_PORTABLE_VERSION   Pin a specific version (e.g. 1.0.180)

Version pinning:
    You can also create a .opencode-version file next to this script
    containing the desired version number (one line, e.g. "1.0.180").

Portable directory layout:
    .opencode_portable/
    ├── bin/           Binary
    ├── config/        XDG_CONFIG_HOME
    ├── data/          XDG_DATA_HOME
    ├── cache/         XDG_CACHE_HOME
    ├── state/         XDG_STATE_HOME
    └── .version       Cached version string
EOF
    exit 0
fi

# ---------------------------------------------------------------------------
# --portable-version
# ---------------------------------------------------------------------------
if [ "$portable_version" = true ]; then
    if [ -f "$VERSION_FILE" ]; then
        echo "Cached version: $(cat "$VERSION_FILE")"
    else
        echo "No version cached yet."
    fi
    exit 0
fi

# ---------------------------------------------------------------------------
# Create portable directory structure
# ---------------------------------------------------------------------------
mkdir -p "$PORTABLE_DIR"/{bin,config,data,cache,state}

# ---------------------------------------------------------------------------
# XDG environment isolation
# ---------------------------------------------------------------------------
export XDG_CONFIG_HOME="$PORTABLE_DIR/config"
export XDG_DATA_HOME="$PORTABLE_DIR/data"
export XDG_CACHE_HOME="$PORTABLE_DIR/cache"
export XDG_STATE_HOME="$PORTABLE_DIR/state"
export OPENCODE_DISABLE_AUTOUPDATE=true

# ---------------------------------------------------------------------------
# Determine pinned version (env var > .opencode-version file > latest)
# ---------------------------------------------------------------------------
pinned_version="${OPENCODE_PORTABLE_VERSION:-}"
if [ -z "$pinned_version" ] && [ -f "$SCRIPT_DIR/.opencode-version" ]; then
    pinned_version="$(tr -d '[:space:]' < "$SCRIPT_DIR/.opencode-version")"
fi
# Strip leading 'v' if present
pinned_version="${pinned_version#v}"

# ---------------------------------------------------------------------------
# Decide whether a download is needed
# ---------------------------------------------------------------------------
need_download=false
if [ "$portable_update" = true ]; then
    need_download=true
elif [ ! -x "$BIN_PATH" ]; then
    need_download=true
elif [ -n "$pinned_version" ] && [ -f "$VERSION_FILE" ]; then
    cached="$(cat "$VERSION_FILE")"
    if [ "$cached" != "$pinned_version" ]; then
        need_download=true
    fi
fi

# ---------------------------------------------------------------------------
# Download logic
# ---------------------------------------------------------------------------
if [ "$need_download" = true ]; then
    # --- prerequisite checks ------------------------------------------------
    if ! command -v curl >/dev/null 2>&1; then
        echo -e "${RED}Error: 'curl' is required but not installed.${NC}" >&2
        exit 1
    fi

    # --- platform detection (ported from install script) --------------------
    raw_os=$(uname -s)
    os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
    case "$raw_os" in
        Darwin*)       os="darwin" ;;
        Linux*)        os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    esac

    arch=$(uname -m)
    if [[ "$arch" == "aarch64" ]]; then
        arch="arm64"
    fi
    if [[ "$arch" == "x86_64" ]]; then
        arch="x64"
    fi

    # Rosetta detection on macOS
    if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
        rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
        if [ "$rosetta_flag" = "1" ]; then
            arch="arm64"
        fi
    fi

    combo="$os-$arch"
    case "$combo" in
        linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64) ;;
        *)
            echo -e "${RED}Unsupported OS/Arch: $os/$arch${NC}" >&2
            exit 1
            ;;
    esac

    archive_ext=".zip"
    if [ "$os" = "linux" ]; then
        archive_ext=".tar.gz"
    fi

    # Archive tool check
    if [ "$os" = "linux" ]; then
        if ! command -v tar >/dev/null 2>&1; then
            echo -e "${RED}Error: 'tar' is required but not installed.${NC}" >&2
            exit 1
        fi
    else
        if ! command -v unzip >/dev/null 2>&1; then
            echo -e "${RED}Error: 'unzip' is required but not installed.${NC}" >&2
            exit 1
        fi
    fi

    # musl detection
    is_musl=false
    if [ "$os" = "linux" ]; then
        if [ -f /etc/alpine-release ]; then
            is_musl=true
        fi
        if command -v ldd >/dev/null 2>&1; then
            if ldd --version 2>&1 | grep -qi musl; then
                is_musl=true
            fi
        fi
    fi

    # AVX2 / baseline detection
    needs_baseline=false
    if [ "$arch" = "x64" ]; then
        if [ "$os" = "linux" ]; then
            if ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null; then
                needs_baseline=true
            fi
        fi
        if [ "$os" = "darwin" ]; then
            avx2=$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)
            if [ "$avx2" != "1" ]; then
                needs_baseline=true
            fi
        fi
        if [ "$os" = "windows" ]; then
            ps="(Add-Type -MemberDefinition \"[DllImport(\"\"kernel32.dll\"\")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);\" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)"
            out=""
            if command -v powershell.exe >/dev/null 2>&1; then
                out=$(powershell.exe -NoProfile -NonInteractive -Command "$ps" 2>/dev/null || true)
            elif command -v pwsh >/dev/null 2>&1; then
                out=$(pwsh -NoProfile -NonInteractive -Command "$ps" 2>/dev/null || true)
            fi
            out=$(echo "$out" | tr -d '\r' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
            if [ "$out" != "true" ] && [ "$out" != "1" ]; then
                needs_baseline=true
            fi
        fi
    fi

    target="$os-$arch"
    if [ "$needs_baseline" = "true" ]; then
        target="$target-baseline"
    fi
    if [ "$is_musl" = "true" ]; then
        target="$target-musl"
    fi

    filename="$APP-$target$archive_ext"

    # --- resolve version & URL ----------------------------------------------
    if [ -n "$pinned_version" ]; then
        # Verify the release exists
        http_status=$(curl -sI -o /dev/null -w "%{http_code}" "https://github.com/anomalyco/opencode/releases/tag/v${pinned_version}")
        if [ "$http_status" = "404" ]; then
            echo -e "${RED}Error: Release v${pinned_version} not found${NC}" >&2
            echo -e "${MUTED}Available releases: https://github.com/anomalyco/opencode/releases${NC}" >&2
            exit 1
        fi
        url="https://github.com/anomalyco/opencode/releases/download/v${pinned_version}/$filename"
        specific_version="$pinned_version"
    else
        url="https://github.com/anomalyco/opencode/releases/latest/download/$filename"
        specific_version=$(curl -s https://api.github.com/repos/anomalyco/opencode/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
        if [ -z "$specific_version" ]; then
            echo -e "${RED}Failed to fetch latest version information${NC}" >&2
            exit 1
        fi
    fi

    # --- download & extract -------------------------------------------------
    tmp_dir="${TMPDIR:-/tmp}/opencode_portable_$$"
    mkdir -p "$tmp_dir"
    cleanup() { rm -rf "$tmp_dir"; }
    trap cleanup EXIT

    echo -e "${MUTED}Downloading OpenCode ${NC}v${specific_version}${MUTED} (${target})...${NC}"
    curl -#fL -o "$tmp_dir/$filename" "$url"

    if [ "$os" = "linux" ]; then
        tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
    else
        unzip -q "$tmp_dir/$filename" -d "$tmp_dir"
    fi

    bin_name="$APP"
    if [ "$os" = "windows" ]; then
        bin_name="$APP.exe"
    fi

    mv "$tmp_dir/$bin_name" "$BIN_PATH"
    chmod 755 "$BIN_PATH"

    echo "$specific_version" > "$VERSION_FILE"
    echo -e "${GREEN}OpenCode ${NC}v${specific_version}${GREEN} ready.${NC}"

    # Clean up temp dir immediately (trap will also fire, harmlessly)
    rm -rf "$tmp_dir"
    trap - EXIT
fi

# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------
exec "$BIN_PATH" "${passthrough_args[@]}"
