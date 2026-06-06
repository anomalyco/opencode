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
    cat > "$BIN_DIR/rin" << 'LAUNCHER'
#!/bin/bash
# Rin AI Launcher
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Set unlimited mode
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

# Load proxies
if [ -f "$DIR/rin-proxy.sh" ] && [ -z "$RIN_PROXIES" ]; then
    export RIN_PROXIES=$(bash "$DIR/rin-proxy.sh" 2>/dev/null | paste -sd ",")
fi

# Run Rin with bun
cd "$DIR/src"
exec bun run --conditions=browser packages/opencode/src/index.ts "$@"
LAUNCHER
    chmod +x "$BIN_DIR/rin"
    echo -e "${G}✓${N} Launcher created: $BIN_DIR/rin"
}

# =============================================================================
# Add to PATH
# =============================================================================
ensure_path() {
    local config=""
    if [ -n "$BASH_VERSION" ]; then config="$HOME/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then config="$HOME/.zshrc"
    fi

    # Symlink to common bin dir
    local link_dir="/usr/local/bin"
    if [ ! -w "$link_dir" ]; then
        link_dir="$HOME/.local/bin"
        mkdir -p "$link_dir"
    fi
    ln -sf "$BIN_DIR/rin" "$link_dir/rin" 2>/dev/null || true

    # Add to shell config if not already there
    if [ -n "$config" ] && ! grep -q "RIN_HOME" "$config" 2>/dev/null; then
        echo "" >> "$config"
        echo "# Rin AI" >> "$config"
        echo "export RIN_HOME=\"$RIN_HOME\"" >> "$config"
        echo "export PATH=\"\$PATH:$BIN_DIR:$link_dir\"" >> "$config"
        echo -e "${Y}▸${N} Added to ${B}$config${N}"
        echo -e "${Y}▸${N} Run: ${B}source $config${N}"
    fi
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
echo -e "  ${G}Binary:${N}  ${B}$BIN_DIR/rin${N}"
echo -e ""
echo -e "  ${Y}Proxy rotation:${N}  ${B}export RIN_PROXIES=\"\$(bash $RIN_HOME/rin-proxy.sh | paste -sd \",\")\"${N}"
echo -e "  ${Y}API rotation:${N}    ${B}export RIN_API_KEYS=\"key1,key2,...\"${N}"
echo ""

# Fetch proxies in background
if [ -f "$RIN_HOME/rin-proxy.sh" ]; then
    echo -e "${G}▸${N} Fetching proxies..."
    RIN_PROXIES=$(bash "$RIN_HOME/rin-proxy.sh" 2>/dev/null | paste -sd ",") || true
fi
