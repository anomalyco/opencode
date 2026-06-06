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
    # Only need curl for binary download
    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        echo -e "${G}▸${N} Installing curl..."
        if command -v apt &>/dev/null; then sudo apt install -y curl
        elif command -v brew &>/dev/null; then brew install curl
        else echo -e "${RED}✖ Install curl or wget manually${N}"; exit 1
        fi
    fi
}

# =============================================================================
# Install Rin from GitHub source
# =============================================================================
install_rin() {
    local install_dir="${RIN_HOME:-$HOME/.rin}"
    local bin_dir="$install_dir/bin"
    local repo_url="https://github.com/rinquickly/rin"
    local version="${RIN_VERSION:-1.16.2}"

    echo -e "${G}▸${N} Installing Rin v${version} to ${B}$install_dir${N}"
    mkdir -p "$bin_dir"

    # Detect platform for binary download
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)
    case "$os" in linux) os="linux" ;; darwin) os="darwin" ;; *) os="linux" ;; esac
    case "$arch" in x86_64|amd64) arch="x64" ;; aarch64|arm64) arch="arm64" ;; *) arch="x64" ;; esac

    local binary_url="$repo_url/releases/download/v${version}/rin-${os}-${arch}.tar.gz"

    echo -e "${G}▸${N} Downloading binary from ${B}$binary_url${N}..."

    # Download binary
    if command -v curl &>/dev/null; then
        curl -fsSL "$binary_url" -o /tmp/rin.tar.gz || {
            echo -e "${Y}▸${N} Binary download failed, trying source build..."
            install_from_source "$install_dir" "$bin_dir"
            return
        }
    elif command -v wget &>/dev/null; then
        wget -qO /tmp/rin.tar.gz "$binary_url" || {
            echo -e "${Y}▸${N} Binary download failed, trying source build..."
            install_from_source "$install_dir" "$bin_dir"
            return
        }
    else
        echo -e "${Y}▸${N} No curl/wget, trying source build..."
        install_from_source "$install_dir" "$bin_dir"
        return
    fi

    # Extract binary
    tar -xzf /tmp/rin.tar.gz -C "$bin_dir" 2>/dev/null || {
        # If tar.gz contains a single binary file
        mkdir -p /tmp/rin_extract
        tar -xzf /tmp/rin.tar.gz -C /tmp/rin_extract
        find /tmp/rin_extract -type f -executable | head -1 | while read f; do
            cp "$f" "$bin_dir/rin"
        done
        rm -rf /tmp/rin_extract
    }
    chmod +x "$bin_dir/rin" 2>/dev/null || true
    rm -f /tmp/rin.tar.gz

    # Check binary works
    if [ -f "$bin_dir/rin" ] && $bin_dir/rin --version &>/dev/null; then
        echo -e "${G}✓${N} Binary installed successfully"
    else
        echo -e "${Y}▸${N} Binary not working, building from source..."
        install_from_source "$install_dir" "$bin_dir"
        return
    fi

    # Download proxy script
    curl -fsSL "$repo_url/raw/main/script/rin-proxy.sh" -o "$install_dir/rin-proxy.sh" 2>/dev/null || true
    chmod +x "$install_dir/rin-proxy.sh" 2>/dev/null || true

    # Symlink to PATH
    local symlink_dir="/usr/local/bin"
    if [ ! -w "$symlink_dir" ]; then
        symlink_dir="$HOME/.local/bin"
        mkdir -p "$symlink_dir"
    fi

    ln -sf "$bin_dir/rin" "$symlink_dir/rin" 2>/dev/null || true

    # Update PATH in shell config
    local config
    config=$(shell_config)
    if [ -n "$config" ] && ! grep -q "RIN_HOME" "$config" 2>/dev/null; then
        echo "" >> "$config"
        echo "# Rin AI" >> "$config"
        echo "export RIN_HOME=\"$install_dir\"" >> "$config"
        echo "export PATH=\"\$PATH:$bin_dir:$HOME/.local/bin\"" >> "$config"
        echo -e "${Y}▸${N} Added to ${B}$config${N}"
        echo -e "${Y}▸${N} Run: ${B}source $config${N}"
    fi

    echo ""
    echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
    echo -e "${G}  Rin v${version} installed!${N}"
    echo -e "${G}  Binary: ${B}$bin_dir/rin${N}"
    echo -e "${G}  Run: ${B}rin${N}"
    echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
    echo ""
    echo -e "  ${Y}Proxy rotation:${N}  ${B}export RIN_PROXIES=\"\$(bash $install_dir/rin-proxy.sh | paste -sd \",\")\"${N}"
    echo -e "  ${Y}API key rotation:${N} ${B}export RIN_API_KEYS=\"key1,key2,...\"${N}"
    echo ""
}

# Fallback: install from source
install_from_source() {
    local install_dir="$1"
    local bin_dir="$2"
    echo -e "${G}▸${N} Building Rin from source..."

    # Ensure bun
    if ! command -v bun &>/dev/null; then
        echo -e "${G}▸${N} Installing bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    # Clone
    git clone --depth 1 --branch main "https://github.com/rinquickly/rin.git" "$install_dir/src" 2>/dev/null || {
        echo -e "${RED}✖ Failed to clone${N}"
        exit 1
    }

    # Install deps
    cd "$install_dir/src"
    bun install --ignore-scripts 2>/dev/null || true

    # Build binary
    bun build --compile --target=bun-linux-x64 --outfile="$bin_dir/rin" \
        --external="@opentui/*" \
        packages/opencode/src/index.ts 2>/dev/null || {
        echo -e "${Y}▸${N} Build failed, using bun runner..."
        cat > "$bin_dir/rin" << 'RUNNER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export OPENCODE_TIMEOUT=false
export OPENCODE_HEADER_TIMEOUT=false
exec bun run "$DIR/src/packages/opencode/src/index.ts" "$@"
RUNNER
        chmod +x "$bin_dir/rin"
    }

    chmod +x "$bin_dir/rin" 2>/dev/null || true
    echo -e "${G}✓${N} Rin built from source"
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
