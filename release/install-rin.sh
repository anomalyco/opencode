#!/bin/bash
# =============================================================================
# Rin AI — Installer / Upgrader / Launcher
# =============================================================================
# One command:
#   curl -fsSL https://raw.githubusercontent.com/rinquickly/rin/main/install-rin.sh | bash
#
# Or save & run:
#   bash install-rin.sh           # Install
#   bash install-rin.sh --upgrade # Upgrade
#   bash install-rin.sh --start   # Install + start
#   bash install-rin.sh --uninstall
#   bash install-rin.sh --help
# =============================================================================

set -e

# =============================================================================
# Color codes
# =============================================================================
R="\033[0;36m"  # Cyan (Rin color)
G="\033[0;32m"  # Green
Y="\033[1;33m"  # Yellow
RED="\033[0;31m"
B="\033[1m"
N="\033[0m"

# =============================================================================
# Rin Banner — ASCII art
# =============================================================================
banner() {
    echo -e "${R}"
    echo -e "  █▀▀█ █ █ █  █▀▀▀ █▀▀█ █  "
    echo -e "  █  █ █_▀_█  █    █  █ █  "
    echo -e "  ▀▀▀▀ ▀   ▀  ▀▀▀▀ ▀▀▀▀ ▀  "
    echo -e "${N}"
    echo -e "${G}  Rin AI${N} — Unrestricted. Unlimited. Unstoppable."
    echo ""
}

# =============================================================================
# Detect platform
# =============================================================================
detect_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os" in
        linux)   os="linux" ;;
        darwin)  os="darwin" ;;
        mingw*|msys*|cygwin*) os="windows" ;;
        *) echo -e "${RED}✖ Unsupported OS: $os${N}"; exit 1 ;;
    esac

    case "$arch" in
        x86_64|amd64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
        *) echo -e "${RED}✖ Unsupported arch: $arch${N}"; exit 1 ;;
    esac

    echo "${os}_${arch}"
}

# =============================================================================
# Detect shell config
# =============================================================================
shell_config() {
    if [ -n "$BASH_VERSION" ]; then echo "$HOME/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then echo "$HOME/.zshrc"
    else echo ""
    fi
}

# =============================================================================
# Install dependencies (bun, git, curl)
# =============================================================================
install_deps() {
    # Check curl
    if ! command -v curl &>/dev/null; then
        echo -e "${G}▸${N} Installing curl..."
        if command -v apt &>/dev/null; then sudo apt install -y curl
        elif command -v brew &>/dev/null; then brew install curl
        else echo -e "${RED}✖ Install curl manually${N}"; exit 1
        fi
    fi

    # Check git
    if ! command -v git &>/dev/null; then
        echo -e "${G}▸${N} Installing git..."
        if command -v apt &>/dev/null; then sudo apt install -y git
        elif command -v brew &>/dev/null; then brew install git
        else echo -e "${RED}✖ Install git manually${N}"; exit 1
        fi
    fi

    # Check bun (needed to run Rin from source)
    if ! command -v bun &>/dev/null; then
        echo -e "${G}▸${N} Installing bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi
}

# =============================================================================
# Install Rin from GitHub source
# =============================================================================
install_rin() {
    local install_dir="${RIN_HOME:-$HOME/.rin}"
    local repo_url="https://github.com/rinquickly/rin.git"

    echo -e "${G}▸${N} Installing Rin to ${B}$install_dir${N}"

    # Remove old install if exists
    if [ -d "$install_dir/src" ]; then
        echo -e "${Y}▸${N} Updating existing Rin installation..."
        cd "$install_dir"
        git pull origin main --force 2>/dev/null || true
    else
        mkdir -p "$install_dir"
        echo -e "${G}▸${N} Cloning Rin source..."
        git clone --depth 1 --branch main "$repo_url" "$install_dir" 2>/dev/null || {
            echo -e "${RED}✖ Failed to clone. Check internet.${N}"
            exit 1
        }
    fi

    # Install dependencies
    echo -e "${G}▸${N} Installing dependencies..."
    cd "$install_dir"
    bun install 2>/dev/null || npm install 2>/dev/null || true

    # Create launcher script
    echo -e "${G}▸${N} Creating launcher..."
    cat > "$install_dir/bin/rin" << 'LAUNCHER'
#!/bin/bash
# Rin launcher
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Fetch proxies if available
if [ -f "$DIR/script/rin-proxy.sh" ] && [ -z "$RIN_PROXIES" ]; then
    export RIN_PROXIES=$(bash "$DIR/script/rin-proxy.sh" 2>/dev/null | paste -sd ",")
fi

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

# Start Rin
cd "$DIR"
exec bun run --conditions=browser packages/opencode/src/index.ts "$@"
LAUNCHER
    chmod +x "$install_dir/bin/rin"

    # Symlink to PATH
    local symlink_dir="/usr/local/bin"
    if [ ! -w "$symlink_dir" ]; then
        symlink_dir="$HOME/.local/bin"
        mkdir -p "$symlink_dir"
    fi

    if [ ! -f "$symlink_dir/rin" ]; then
        ln -sf "$install_dir/bin/rin" "$symlink_dir/rin" 2>/dev/null || true
    fi

    # Update PATH
    local config
    config=$(shell_config)
    if [ -n "$config" ] && ! grep -q "RIN_HOME" "$config" 2>/dev/null; then
        echo "" >> "$config"
        echo "# Rin AI" >> "$config"
        echo "export RIN_HOME=\"$install_dir\"" >> "$config"
        echo "export PATH=\"\$PATH:$install_dir/bin:$HOME/.local/bin\"" >> "$config"
        echo -e "${Y}▸${N} Added to ${B}$config${N}"
        echo -e "${Y}▸${N} Run: ${B}source $config${N} or restart terminal"
    fi

    echo ""
    echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
    echo -e "${G}  Rin installed!${N}"
    echo -e "${G}  Run: ${B}rin${N}  or  ${B}$install_dir/bin/rin${N}"
    echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
    echo ""
    echo -e "  ${Y}Proxy rotation:${N}  Auto-enabled (588+ free proxies)"
    echo -e "  ${Y}API key rotation:${N} Set ${B}RIN_API_KEYS${N}=\"key1,key2,...\""
    echo -e "  ${Y}Source:${N}         ${B}https://github.com/rinquickly/rin${N}"
    echo ""
}

# =============================================================================
# Fetch & setup proxies
# =============================================================================
setup_proxies() {
    echo -e "${G}▸${N} Fetching rotating proxies..."
    local script="$HOME/.rin/script/rin-proxy.sh"
    if [ -f "$script" ]; then
        local proxies
        proxies=$(bash "$script" 2>/dev/null | head -50 | paste -sd ",")
        if [ -n "$proxies" ]; then
            export RIN_PROXIES="$proxies"
            local count
            count=$(echo "$proxies" | tr ',' '\n' | wc -l)
            echo -e "${G}▸${N} ${count} proxies loaded ✓"
        fi
    fi
}

# =============================================================================
# Uninstall
# =============================================================================
uninstall() {
    echo -e "${Y}▸${N} Uninstalling Rin..."
    local install_dir="${RIN_HOME:-$HOME/.rin}"

    # Remove symlinks
    rm -f /usr/local/bin/rin 2>/dev/null || true
    rm -f "$HOME/.local/bin/rin" 2>/dev/null || true

    # Remove install dir
    if [ -d "$install_dir" ]; then
        rm -rf "$install_dir"
        echo -e "${G}✓${N} Removed $install_dir"
    fi

    # Clean proxy cache
    rm -f /tmp/rin_proxies*.txt 2>/dev/null || true

    echo -e "${G}✓${N} Rin uninstalled."
}

# =============================================================================
# Show status
# =============================================================================
status() {
    echo -e "${R}━━━━━━━━━ Rin Status ───────────────────${N}"
    local install_dir="${RIN_HOME:-$HOME/.rin}"
    if [ -d "$install_dir" ]; then
        echo -e "  ${G}Installed:${N}    $install_dir"
        if command -v rin &>/dev/null; then
            echo -e "  ${G}Command:${N}      $(which rin)"
        fi
        echo -e "  ${G}Proxies:${N}       ${RIN_PROXIES:+$(echo "$RIN_PROXIES" | tr ',' '\n' | wc -l) loaded}${RIN_PROXIES:-Not set}"
        echo -e "  ${G}API Keys:${N}      ${RIN_API_KEYS:+$(echo "$RIN_API_KEYS" | tr ',' '\n' | wc -l) configured}${RIN_API_KEYS:-Default (public)}"
    else
        echo -e "  ${RED}Not installed${N}"
    fi
    echo -e "${R}────────────────────────────────────────${N}"
}

# =============================================================================
# Main
# =============================================================================
banner

case "${1:-}" in
    --uninstall|-u)
        uninstall
        ;;
    --upgrade|-U)
        install_deps
        install_rin
        setup_proxies
        echo -e "${G}✓${N} Rin upgraded!"
        ;;
    --start|-s)
        install_deps
        install_rin
        setup_proxies
        echo -e "${G}▸${N} Starting Rin..."
        rin
        ;;
    --status|-st)
        status
        ;;
    --help|-h)
        echo "Rin AI — Installer / Upgrader"
        echo ""
        echo "Usage:"
        echo "  curl -fsSL https://raw.githubusercontent.com/rinquickly/rin/main/install-rin.sh | bash"
        echo "  bash install-rin.sh              Install"
        echo "  bash install-rin.sh --upgrade    Upgrade"
        echo "  bash install-rin.sh --start      Install + start"
        echo "  bash install-rin.sh --uninstall  Remove"
        echo "  bash install-rin.sh --help       This help"
        echo ""
        echo "Env:"
        echo "  RIN_HOME       Install dir (default: ~/.rin)"
        echo "  RIN_API_KEYS   Comma-separated API keys"
        echo "  RIN_PROXIES    Comma-separated proxy URLs"
        ;;
    *)
        install_deps
        install_rin
        setup_proxies
        echo ""
        echo -e "  ${Y}Quick start:${N}  ${B}rin${N}"
        echo -e "  ${Y}With Tor:${N}     ${B}rin${N}  (or set RIN_PROXIES=socks5://127.0.0.1:9050)"
        echo ""
        ;;
esac
