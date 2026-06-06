#!/bin/bash
# =============================================================================
# Rin AI — Installer & Upgrader
# =============================================================================
# Usage:
#   curl -fsSL https://mentermasterbot.github.io/Hello-World/rin/install.sh | bash
#   bash install-rin.sh
#   bash install-rin.sh --uninstall
#   bash install-rin.sh --version
# =============================================================================

set -e

RIN_VERSION="${RIN_VERSION:-1.16.2}"
RIN_REPO="rinquickly/rin"
RIN_COLOR="\033[0;36m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
BOLD="\033[1m"
NC="\033[0m"

# =============================================================================
# Banner
# =============================================================================
echo -e "${RIN_COLOR}"
echo -e "  █▀▀█ █ █ █  █▀▀▀ █▀▀█ █  "
echo -e "  █  █ █_▀_█  █    █  █ █  "
echo -e "  ▀▀▀▀ ▀   ▀  ▀▀▀▀ ▀▀▀▀ ▀  "
echo -e "${NC}"
echo -e "${GREEN}  Rin AI v${RIN_VERSION} — Installer${NC}"
echo -e ""

# =============================================================================
# Detect platform
# =============================================================================
detect_platform() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch
    arch=$(uname -m)
    
    case "$os" in
        linux) os="linux" ;;
        darwin) os="macos" ;;
        mingw*|msys*|cygwin*) os="windows" ;;
        *) echo -e "${RED}Unsupported OS: $os${NC}"; exit 1 ;;
    esac
    
    case "$arch" in
        x86_64|amd64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
        *) echo -e "${RED}Unsupported architecture: $arch${NC}"; exit 1 ;;
    esac
    
    echo "${os}_${arch}"
}

# =============================================================================
# Install Rin
# =============================================================================
install_rin() {
    local platform="$1"
    local install_dir="${RIN_INSTALL_DIR:-$HOME/.rin/bin}"
    local bin_path="$install_dir/rin"
    
    echo -e "${GREEN}▸${NC} Installing Rin for ${platform}..."
    
    # Create install directory
    mkdir -p "$install_dir"
    
    # Determine download URL
    local download_url="https://github.com/${RIN_REPO}/releases/download/v${RIN_VERSION}/rin-${platform}.tar.gz"
    
    echo -e "${GREEN}▸${NC} Downloading from ${download_url}..."
    
    # Download and extract
    if command -v curl &> /dev/null; then
        curl -fsSL "$download_url" -o /tmp/rin.tar.gz
    elif command -v wget &> /dev/null; then
        wget -qO /tmp/rin.tar.gz "$download_url"
    else
        echo -e "${RED}Error: need curl or wget${NC}"
        exit 1
    fi
    
    # Extract
    tar -xzf /tmp/rin.tar.gz -C "$install_dir"
    chmod +x "$bin_path"
    rm -f /tmp/rin.tar.gz
    
    echo -e "${GREEN}▸${NC} Installed to: ${BOLD}$install_dir${NC}"
    
    # Add to PATH
    if [[ ":$PATH:" != *":$install_dir:"* ]]; then
        local shell_config
        if [ -n "$BASH_VERSION" ]; then
            shell_config="$HOME/.bashrc"
        elif [ -n "$ZSH_VERSION" ]; then
            shell_config="$HOME/.zshrc"
        fi
        
        if [ -n "$shell_config" ]; then
            echo "" >> "$shell_config"
            echo "# Rin AI" >> "$shell_config"
            echo "export PATH=\"\$PATH:$install_dir\"" >> "$shell_config"
            echo -e "${YELLOW}▸${NC} Added to PATH in ${BOLD}$shell_config${NC}"
            echo -e "${YELLOW}▸${NC} Run: ${BOLD}source $shell_config${NC}"
        fi
    fi
    
    echo -e ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Rin installed successfully! ${NC}"
    echo -e "${GREEN}  Run: ${BOLD}rin${NC}${GREEN} to start${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Auto-fetch proxies
    if [ -f "$install_dir/script/rin-proxy.sh" ]; then
        echo -e "${GREEN}▸${NC} Setting up proxy rotation..."
        export RIN_PROXIES=$(bash "$install_dir/script/rin-proxy.sh" 2>/dev/null | paste -sd ",")
        echo -e "${GREEN}▸${NC} Proxies ready ✓"
    fi
    
    echo -e ""
    echo -e "  ${YELLOW}Pro tip:${NC} Set ${BOLD}RIN_API_KEYS${NC} for API key rotation"
    echo -e "  Set ${BOLD}RIN_PROXIES${NC} for proxy rotation"
    echo -e "  See ${BOLD}https://github.com/rinquickly/rin${NC} for docs"
}

# =============================================================================
# Uninstall
# =============================================================================
uninstall_rin() {
    local install_dir="${RIN_INSTALL_DIR:-$HOME/.rin}"
    echo -e "${YELLOW}▸${NC} Uninstalling Rin..."
    rm -rf "$install_dir"
    rm -f /tmp/rin_proxies.txt /tmp/rin_proxies_export.txt
    echo -e "${GREEN}▸${NC} Rin removed."
}

# =============================================================================
# Install via npm
# =============================================================================
install_npm() {
    echo -e "${GREEN}▸${NC} Installing via npm..."
    npm i -g rine-ai@latest
    echo -e "${GREEN}✓${NC} Installed via npm"
}

# =============================================================================
# Main
# =============================================================================
case "${1:-}" in
    --uninstall)
        uninstall_rin
        ;;
    --version|-v)
        echo "Rin v${RIN_VERSION}"
        ;;
    --npm)
        install_npm
        ;;
    --help|-h)
        echo "Rin AI Installer"
        echo ""
        echo "Usage:"
        echo "  curl -fsSL https://mentermasterbot.github.io/Hello-World/rin/install.sh | bash"
        echo "  bash install-rin.sh"
        echo "  bash install-rin.sh --uninstall"
        echo "  bash install-rin.sh --version"
        echo "  bash install-rin.sh --npm"
        echo ""
        echo "Env vars:"
        echo "  RIN_VERSION       Version to install (default: $RIN_VERSION)"
        echo "  RIN_INSTALL_DIR   Install directory (default: ~/.rin)"
        echo "  RIN_API_KEYS      API keys for rotation"
        echo "  RIN_PROXIES       Proxy URLs for rotation"
        ;;
    *)
        echo -e "${GREEN}▸${NC} Detecting platform..."
        local platform
        platform=$(detect_platform)
        install_rin "$platform"
        ;;
esac
