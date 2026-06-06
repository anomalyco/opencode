#!/bin/bash
# =============================================================================
# Rin AI — Installer / Upgrader
# =============================================================================
# One command:
#   curl -fsSL https://raw.githubusercontent.com/rinquickly/rin/main/install-rin.sh | bash
# =============================================================================

set -e

R="\033[0;36m"; G="\033[0;32m"; Y="\033[1;33m"; RED="\033[0;31m"; B="\033[1m"; N="\033[0m"

banner() {
    echo -e "${R}"
    echo -e " ___ ___ _  _     _   ___ "
    echo -e "| _ \\_ _| \\| |   /_\\ |_ _|"
    echo -e "|   /| || .' |  / _ \\ | | "
    echo -e "|_|_\\___|_|\\_| /_/ \\_\\___|"
    echo -e "${N}"
    echo -e "${G}  Rin AI${N} — Unrestricted. Unlimited. Unstoppable."
    echo -e "  ${Y}TG${N} t.me/RinquicklyBot  ${Y}DC${N} discord.gg/K98kCm6CVf"
    echo ""
}

RIN_REPO="rinquickly/rin"
RIN_HOME="${RIN_HOME:-$HOME/.rin}"
BIN_DIR="$RIN_HOME/bin"
SRC_DIR="$RIN_HOME/src"

# =============================================================================
# Ensure bun is installed
# =============================================================================
ensure_bun() {
    if ! command -v bun &>/dev/null; then
        echo -e "${G}▸${N} Installing bun runtime..."
        curl -fsSL https://bun.sh/install | bash
        # shellcheck source=/dev/null
        source "$HOME/.bashrc" 2>/dev/null || true
        export PATH="$HOME/.bun/bin:$PATH"
    fi
    echo -e "${G}✓${N} Bun $(bun --version)"
}

# =============================================================================
# Clone/update source
# =============================================================================
ensure_source() {
    if [ -d "$SRC_DIR/.git" ]; then
        echo -e "${G}▸${N} Updating Rin source..."
        cd "$SRC_DIR" && git pull origin main --force 2>/dev/null || true
    else
        echo -e "${G}▸${N} Downloading Rin source..."
        mkdir -p "$RIN_HOME"
        git clone --depth 1 --branch main "https://github.com/$RIN_REPO.git" "$SRC_DIR" 2>/dev/null || {
            echo -e "${RED}✖ Failed to download Rin${N}"
            exit 1
        }
    fi

    # Install dependencies
    echo -e "${G}▸${N} Installing dependencies..."
    cd "$SRC_DIR"
    bun install --ignore-scripts 2>&1 | tail -1
    echo -e "${G}✓${N} Dependencies installed"
}

# =============================================================================
# Create rin launcher
# =============================================================================
create_launcher() {
    mkdir -p "$BIN_DIR"

    # Step 1: Download pre-built binary from releases
    local platform arch
    platform=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$platform" in linux) ;; darwin) ;; *) platform="linux" ;; esac
    arch=$(uname -m)
    case "$arch" in x86_64|amd64) arch="x64" ;; aarch64|arm64) arch="arm64" ;; *) arch="x64" ;; esac

    local bin_url="https://github.com/$RIN_REPO/releases/download/v1.16.2/rin-${platform}-${arch}.tar.gz"
    echo -ne "${G}▸${N} Downloading... 0%"
    if curl -fsSL --progress-bar "$bin_url" -o /tmp/rin-bin.tar.gz 2>&1 | tr '\n' '\r' | while read -r line; do
        echo -ne "\r${G}▸${N} Downloading... ${line}"
    done && echo -e "\r${G}▸${N} Downloading... 100%"; then
        mkdir -p /tmp/rin-extract
        tar -xzf /tmp/rin-bin.tar.gz -C /tmp/rin-extract 2>/dev/null
        local extracted
        extracted=$(find /tmp/rin-extract -type f -executable 2>/dev/null | head -1)
        if [ -n "$extracted" ]; then
            cp "$extracted" "$BIN_DIR/rin"
            chmod +x "$BIN_DIR/rin"
            rm -rf /tmp/rin-extract /tmp/rin-bin.tar.gz
            echo -e "${G}✓${N} Binary installed: $BIN_DIR/rin"
            return
        fi
        rm -rf /tmp/rin-extract /tmp/rin-bin.tar.gz
    fi

    # Step 2: Build from source if binary unavailable
    echo -e "${Y}▸${N} Binary download failed, building from source..."
    cd "$SRC_DIR/packages/opencode"
    if bun run script/build.ts --single --skip-embed-web-ui 2>&1 | tail -3; then
        local built_bin
        built_bin=$(find "$SRC_DIR/packages/opencode/dist" -name "opencode" -type f 2>/dev/null | head -1)
        if [ -n "$built_bin" ]; then
            cp "$built_bin" "$BIN_DIR/rin"
            chmod +x "$BIN_DIR/rin"
            echo -e "${G}✓${N} Built from source: $BIN_DIR/rin"
            return
        fi
    fi

    # Step 3: Last resort — bun run wrapper (shows 'local' as version but fully works)
    echo -e "${Y}▸${N} Build failed, creating source wrapper..."
    cat > "$BIN_DIR/rin" << 'LAUNCHER'
#!/bin/bash
SCRIPT="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
DIR="$(cd "$(dirname "$SCRIPT")/.." && pwd)"

# ===== RIN UNLIMITED MODE =====
export OPENCODE_TIMEOUT=false
export OPENCODE_HEADER_TIMEOUT=false
export OPENCODE_CHUNK_TIMEOUT=999999999
export OPENCODE_CONTEXT_LIMIT=999999999
export OPENCODE_INPUT_LIMIT=999999999
export OPENCODE_OUTPUT_LIMIT=999999999
export OPENCODE_STEPS=999999999
export OPENCODE_COMPACTION_AUTO=false
export OPENCODE_COMPACTION_PRUNE=false
export OPENCODE_TOOL_OUTPUT_MAX_LINES=999999999
export OPENCODE_TOOL_OUTPUT_MAX_BYTES=999999999

# ===== AUTO PROXY ROTATION =====
# Fetches 500+ free proxies automatically.
# Sets RIN_PROXIES for provider.ts smart rotation.
# When a proxy gets rate-limited, Rin auto-rotates to a live one.
if [ -z "$RIN_PROXIES" ]; then
    if [ -f "$DIR/rin-proxy.sh" ]; then
        echo "⟳ Rin: Fetching 500+ rotating proxies..." >&2
        RIN_PROXIES=$(bash "$DIR/rin-proxy.sh" 2>/dev/null | paste -sd ",")
        COUNT=$(echo "$RIN_PROXIES" | tr ',' '\n' | wc -l)
        echo "✓ Rin: $COUNT proxies loaded (auto-rotate on limit)" >&2
        export RIN_PROXIES
    elif command -v curl &>/dev/null; then
        # Fallback: direct API fetch
        echo "⟳ Rin: Fetching proxies from ProxyScrape..." >&2
        RIN_PROXIES=$(curl -sf "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=http&timeout=10000" 2>/dev/null | head -100 | paste -sd ",")
        COUNT=$(echo "$RIN_PROXIES" | tr ',' '\n' | wc -l)
        if [ "$COUNT" -gt 0 ]; then
            echo "✓ Rin: $COUNT proxies loaded" >&2
            export RIN_PROXIES
        fi
    fi
fi

# ===== API KEY ROTATION =====
# Set RIN_API_KEYS="key1,key2,key3" for automatic key rotation

cd "$DIR/src"
exec bun run --conditions=browser packages/opencode/src/index.ts "$@"
LAUNCHER
    chmod +x "$BIN_DIR/rin"
    echo -e "${Y}▸${N} Source wrapper created (version shows 'local' but all features work)"
}

# =============================================================================
# Add to PATH
# =============================================================================
ensure_path() {
    local config=""
    if [ -n "$BASH_VERSION" ]; then config="$HOME/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then config="$HOME/.zshrc"
    fi

    # Add to shell config if not already there
    if [ -n "$config" ] && ! grep -q "RIN_HOME" "$config" 2>/dev/null; then
        echo "" >> "$config"
        echo "# Rin AI" >> "$config"
        echo "export RIN_HOME=\"$RIN_HOME\"" >> "$config"
        echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$config"
        echo -e "${Y}▸${N} Added to ${B}$config${N}"
        echo -e "${Y}▸${N} Run: ${B}source $config${N} or log out and back in"
    fi

    # Also symlink to a common bin dir as fallback
    local link_dir="/usr/local/bin"
    if [ ! -w "$link_dir" ]; then
        link_dir="$HOME/.local/bin"
        mkdir -p "$link_dir"
    fi
    ln -sf "$BIN_DIR/rin" "$link_dir/rin" 2>/dev/null || true
}

# =============================================================================
# Download proxy script
# =============================================================================
get_proxy_script() {
    if [ ! -f "$RIN_HOME/rin-proxy.sh" ]; then
        curl -fsSL "https://raw.githubusercontent.com/$RIN_REPO/main/script/rin-proxy.sh" \
          -o "$RIN_HOME/rin-proxy.sh" 2>/dev/null || true
        chmod +x "$RIN_HOME/rin-proxy.sh" 2>/dev/null || true
    fi
}

# =============================================================================
# Main
# =============================================================================
banner

case "${1:-}" in
    --uninstall|-u)
        echo -e "${Y}▸${N} Uninstalling Rin..."
        rm -rf "$RIN_HOME" /tmp/rin_* 2>/dev/null || true
        rm -f /usr/local/bin/rin "$HOME/.local/bin/rin" 2>/dev/null || true
        echo -e "${G}✓${N} Rin removed."
        exit 0
        ;;
    --help|-h)
        echo "Rin AI — Installer"
        echo "Usage: curl -fsSL https://raw.githubusercontent.com/rinquickly/rin/main/install-rin.sh | bash"
        echo "       bash install-rin.sh --uninstall"
        exit 0
        ;;
esac

ensure_bun
ensure_source
create_launcher
get_proxy_script
ensure_path

echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${G}  Rin installed!${N}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo ""
echo -e "  ${G}Run:${N}     ${B}rin${N}"
echo ""
