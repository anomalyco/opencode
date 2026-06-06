#!/bin/bash
# =============================================================================
# Rin AI — Upgrade Script
# =============================================================================
# Checks for latest version and upgrades Rin automatically.
#
# Usage:
#   bash upgrade-rin.sh           # Check and upgrade
#   bash upgrade-rin.sh --check   # Just check version
#   bash upgrade-rin.sh --force   # Force reinstall
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
CURRENT_VERSION="1.16.2"

echo -e "${R}"
echo -e "  █▀▀█ █ █ █  █▀▀▀ █▀▀█ █  "
echo -e "  █  █ █_▀_█  █    █  █ █  "
echo -e "  ▀▀▀▀ ▀   ▀  ▀▀▀▀ ▀▀▀▀ ▀  "
echo -e "${N}"
echo -e "${G}  Rin Upgrade Check${N}"
echo ""

check_latest() {
    echo -e "${G}▸${N} Checking latest version..."
    local latest
    latest=$(curl -s "https://api.github.com/repos/$RIN_REPO/releases/latest" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tag_name','').lstrip('v'))" 2>/dev/null || echo "")
    
    if [ -z "$latest" ]; then
        echo -e "${Y}▸${N} Could not check latest version (no internet?)"
        echo -e "${Y}▸${N} Current: ${B}v${CURRENT_VERSION}${N}"
        return 1
    fi
    
    echo -e "${G}▸${N} Latest: ${B}v${latest}${N}  |  Current: ${B}v${CURRENT_VERSION}${N}"
    
    if [ "$latest" != "$CURRENT_VERSION" ]; then
        echo -e "${Y}▸${N} New version available!"
        return 0
    else
        echo -e "${G}▸${N} You have the latest version."
        return 2
    fi
}

do_upgrade() {
    echo -e "${G}▸${N} Upgrading Rin..."
    
    # Remove old source
    if [ -d "$RIN_HOME/src" ]; then
        echo -e "${G}▸${N} Removing old version..."
        rm -rf "$RIN_HOME/src"
    fi
    
    # Fresh clone
    echo -e "${G}▸${N} Downloading latest Rin..."
    git clone --depth 1 --branch main "https://github.com/$RIN_REPO.git" "$RIN_HOME/src" 2>/dev/null || {
        echo -e "${RED}✖ Upgrade failed${N}"
        exit 1
    }
    
    # Reinstall deps
    if command -v bun &>/dev/null; then
        echo -e "${G}▸${N} Updating dependencies..."
        cd "$RIN_HOME/src" && bun install 2>/dev/null || true
    fi
    
    # Update launcher
    if [ -f "$RIN_HOME/src/release/rin-linux-x64.sh" ]; then
        cp "$RIN_HOME/src/release/rin-linux-x64.sh" "$RIN_HOME/bin/rin"
        chmod +x "$RIN_HOME/bin/rin"
    fi
    
    echo -e "${G}✓${N} Rin upgraded! Run: ${B}rin${N}"
}

case "${1:-}" in
    --check|-c)
        check_latest || true
        ;;
    --force|-f)
        do_upgrade
        ;;
    --help|-h)
        echo "Rin Upgrade Script"
        echo ""
        echo "Usage:"
        echo "  bash upgrade-rin.sh           Check + upgrade"
        echo "  bash upgrade-rin.sh --check   Just check"
        echo "  bash upgrade-rin.sh --force   Force reinstall"
        ;;
    *)
        check_latest && do_upgrade || true
        ;;
esac
