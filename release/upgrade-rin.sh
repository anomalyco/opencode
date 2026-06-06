#!/bin/bash
# =============================================================================
# Rin AI — Upgrade Script (Binary Download)
# =============================================================================
# Checks for latest release and downloads the compiled binary.
#
# Usage:
#   bash upgrade-rin.sh              # Check + upgrade
#   bash upgrade-rin.sh --check      # Just check version
#   bash upgrade-rin.sh --force      # Force re-download
#   bash upgrade-rin.sh --install    # Install from release binary
# =============================================================================

set -e

R="\033[0;36m"
G="\033[0;32m"
Y="\033[1;33m"
RED="\033[0;31m"
B="\033[1m"
N="\033[0m"

RIN_REPO="rinquickly/rin"
RIN_HOME="${RIN_HOME:-$HOME/.rin}"
BIN_DIR="$RIN_HOME/bin"
CURRENT_VERSION="1.16.2"

banner() {
    echo -e "${R}"
    echo -e " ___ ___ _  _     _   ___ "
    echo -e "| _ \\_ _| \\| |   /_\\ |_ _|"
    echo -e "|   /| || .' |  / _ \\ | | "
    echo -e "|_|_\\___|_|\\_| /_/ \\_\\___|"
    echo -e "${N}"
    echo -e "${G}  Rin v${CURRENT_VERSION} — Upgrade${N}"
    echo ""
}

# =============================================================================
# Check latest version from GitHub API
# =============================================================================
check_latest() {
    echo -e "${G}▸${N} Checking latest version..."
    local latest
    latest=$(curl -sf "https://api.github.com/repos/$RIN_REPO/releases/latest" 2>/dev/null | \
        python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tag_name','').lstrip('v'))" 2>/dev/null || echo "")

    if [ -z "$latest" ]; then
        echo -e "${Y}▸${N} Could not check (offline?)"
        echo -e "${Y}▸${N} Current: ${B}v${CURRENT_VERSION}${N}"
        return 1
    fi

    echo -e "${G}▸${N} Latest: ${B}v${latest}${N}  |  Installed: ${B}v${CURRENT_VERSION}${N}"

    if [ "$latest" != "$CURRENT_VERSION" ]; then
        echo -e "${Y}▸${N} New version available: v${latest}"
        export LATEST_VERSION="$latest"
        return 0
    else
        echo -e "${G}✓${N} You have the latest version."
        return 2
    fi
}

# =============================================================================
# Detect platform
# =============================================================================
detect_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)
    case "$os" in linux) os="linux" ;; darwin) os="darwin" ;; mingw*|msys*) os="windows" ;; *) os="linux" ;; esac
    case "$arch" in x86_64|amd64) arch="x64" ;; aarch64|arm64) arch="arm64" ;; *) arch="x64" ;; esac
    echo "${os}-${arch}"
}

# =============================================================================
# Download binary
# =============================================================================
download_binary() {
    local version="${1:-$CURRENT_VERSION}"
    local platform
    platform=$(detect_platform)
    local url="https://github.com/$RIN_REPO/releases/download/v${version}/rin-${platform}.tar.gz"

    echo -e "${G}▸${N} Downloading rin-${platform}.tar.gz..."

    mkdir -p "$BIN_DIR"

    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o /tmp/rin-upgrade.tar.gz || {
            echo -e "${RED}✖ Download failed${N}"
            echo -e "${Y}▸${N} URL: $url"
            exit 1
        }
    elif command -v wget &>/dev/null; then
        wget -qO /tmp/rin-upgrade.tar.gz "$url" || {
            echo -e "${RED}✖ Download failed${N}"
            exit 1
        }
    else
        echo -e "${RED}✖ Need curl or wget${N}"
        exit 1
    fi

    # Extract
    echo -e "${G}▸${N} Extracting..."
    mkdir -p /tmp/rin-upgrade
    tar -xzf /tmp/rin-upgrade.tar.gz -C /tmp/rin-upgrade 2>/dev/null

    # Find the binary inside the tar
    local binary
    binary=$(find /tmp/rin-upgrade -type f -name "rin*" -o -type f -executable 2>/dev/null | head -1)
    if [ -n "$binary" ]; then
        cp "$binary" "$BIN_DIR/rin"
    else
        # Maybe the tar has the binary at root
        cp /tmp/rin-upgrade.tar.gz /dev/null 2>/dev/null
        echo -e "${RED}✖ No binary found in archive${N}"
        rm -rf /tmp/rin-upgrade /tmp/rin-upgrade.tar.gz
        exit 1
    fi

    chmod +x "$BIN_DIR/rin"
    rm -rf /tmp/rin-upgrade /tmp/rin-upgrade.tar.gz

    # Verify
    if [ -f "$BIN_DIR/rin" ]; then
        echo -e "${G}✓${N} Binary: $BIN_DIR/rin"
    fi
}

# =============================================================================
# Setup proxy rotation
# =============================================================================
setup_proxies() {
    local proxy_script="$RIN_HOME/rin-proxy.sh"
    if [ ! -f "$proxy_script" ]; then
        echo -e "${G}▸${N} Downloading proxy rotator..."
        curl -sf "https://raw.githubusercontent.com/$RIN_REPO/main/script/rin-proxy.sh" \
          -o "$proxy_script" 2>/dev/null && chmod +x "$proxy_script"
    fi

    # Auto-fetch proxies into RIN_PROXIES
    if [ -f "$proxy_script" ]; then
        echo -e "${G}▸${N} Fetching 500+ free proxies..."
        local proxies
        proxies=$(bash "$proxy_script" 2>/dev/null | head -100 | paste -sd ",")
        local count
        count=$(echo "$proxies" | tr ',' '\n' | wc -l)
        if [ "$count" -gt 0 ]; then
            echo -e "${G}✓${N} $count proxies loaded (auto-rotate on rate limit)"
            echo -e "${Y}▸${N} Set RIN_PROXIES to persist across sessions:"
            echo -e "    ${B}export RIN_PROXIES=\"$proxies\"${N}"
            # Set for current session
            export RIN_PROXIES="$proxies"
        fi
    fi
}

# =============================================================================
# Symlink to PATH
# =============================================================================
ensure_path() {
    local symlink_dir="/usr/local/bin"
    if [ ! -w "$symlink_dir" ]; then
        symlink_dir="$HOME/.local/bin"
        mkdir -p "$symlink_dir"
    fi

    if [ ! -f "$symlink_dir/rin" ]; then
        ln -sf "$BIN_DIR/rin" "$symlink_dir/rin" 2>/dev/null || true
        echo -e "${G}▸${N} Linked: $symlink_dir/rin"
    fi

    # Shell config
    local config=""
    if [ -n "$BASH_VERSION" ]; then config="$HOME/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then config="$HOME/.zshrc"
    fi

    if [ -n "$config" ] && ! grep -q "RIN_HOME" "$config" 2>/dev/null; then
        echo "" >> "$config"
        echo "# Rin AI" >> "$config"
        echo "export PATH=\"\$PATH:$BIN_DIR:$HOME/.local/bin\"" >> "$config"
        echo -e "${Y}▸${N} Added to PATH in ${B}$config${N}"
        echo -e "${Y}▸${N} Run: ${B}source $config${N}"
    fi
}

# =============================================================================
# Main
# =============================================================================
banner

case "${1:-}" in
    --check|-c)
        check_latest || true
        ;;
    --force|-f)
        echo -e "${Y}▸${N} Force re-downloading v${CURRENT_VERSION}..."
        download_binary "$CURRENT_VERSION"
        ensure_path
        echo -e "${G}✓${N} Rin v${CURRENT_VERSION} re-installed!"
        echo -e "${G}▸${N} Run: ${B}rin${N}"
        ;;
    --install|-i)
        download_binary "$CURRENT_VERSION"
        setup_proxies
        ensure_path
        echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
        echo -e "${G}  Rin installed!${N}"
        echo -e "${G}  Run: ${B}rin${N}"
        echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
        ;;
    --help|-h)
        echo "Rin Upgrade Script"
        echo ""
        echo "Usage:"
        echo "  bash upgrade-rin.sh              Check + upgrade"
        echo "  bash upgrade-rin.sh --check      Just check"
        echo "  bash upgrade-rin.sh --force      Re-download current"
        echo "  bash upgrade-rin.sh --install    Fresh install from binary"
        ;;
    *)
        if check_latest; then
            download_binary "$LATEST_VERSION"
            setup_proxies
            ensure_path
            echo -e "${G}✓${N} Rin upgraded to v${LATEST_VERSION}!"
            echo -e "${G}▸${N} Run: ${B}rin${N}"
        fi
        ;;
esac
