#!/bin/bash
# =============================================================================
# Rin AI — Standalone Launcher for Linux x64
# =============================================================================
# This is the Rin binary. It downloads and runs Rin from source on first use.
# After the first run, Rin runs from $HOME/.rin/
#
# Usage:
#   chmod +x rin && ./rin
#   ./rin --help
#
# Install:
#   sudo mv rin /usr/local/bin/rin
# =============================================================================
# Rin AI v1.16.2 - https://github.com/rinquickly/rin
# =============================================================================

set -e

RIN_VERSION="1.16.2"
RIN_REPO="rinquickly/rin"
RIN_HOME="${RIN_HOME:-$HOME/.rin}"
BUN="$HOME/.bun/bin/bun"

# Colors
R="\033[0;36m"
G="\033[0;32m"  
Y="\033[1;33m"
RED="\033[0;31m"
B="\033[1m"
N="\033[0m"

# Create Rin home
mkdir -p "$RIN_HOME/bin"

# =============================================================================
# Ensure Rin source is available
# =============================================================================
ensure_source() {
    if [ ! -d "$RIN_HOME/src" ]; then
        echo -e "${G}▸${N} Downloading Rin v${RIN_VERSION}..."
        git clone --depth 1 --branch main "https://github.com/$RIN_REPO.git" "$RIN_HOME/src" 2>/dev/null || {
            echo -e "${RED}✖ Failed to download Rin${N}"
            exit 1
        }
    fi
    
    # Ensure bun
    if [ ! -f "$BUN" ]; then
        echo -e "${G}▸${N} Installing bun..."
        curl -fsSL https://bun.sh/install | bash
    fi
    
    # Install deps if needed
    if [ ! -d "$RIN_HOME/src/node_modules" ]; then
        echo -e "${G}▸${N} Installing dependencies..."
        cd "$RIN_HOME/src"
        "$BUN" install 2>/dev/null || true
    fi
}

# =============================================================================
# Fetch proxies
# =============================================================================
fetch_proxies() {
    if [ -f "$RIN_HOME/src/script/rin-proxy.sh" ] && [ -z "$RIN_PROXIES" ]; then
        local proxies
        proxies=$(bash "$RIN_HOME/src/script/rin-proxy.sh" 2>/dev/null | head -50 | paste -sd ",")
        if [ -n "$proxies" ]; then
            export RIN_PROXIES="$proxies"
        fi
    fi
}

# =============================================================================
# Set unlimited mode
# =============================================================================
set_unlimited() {
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
}

# =============================================================================
# Print banner
# =============================================================================
banner() {
    echo -e "${R}"
    echo -e "  █▀▀█ █ █ █  █▀▀▀ █▀▀█ █  "
    echo -e "  █  █ █_▀_█  █    █  █ █  "
    echo -e "  ▀▀▀▀ ▀   ▀  ▀▀▀▀ ▀▀▀▀ ▀  "
    echo -e "${N}"
}

# =============================================================================
# Main
# =============================================================================
banner
ensure_source
fetch_proxies
set_unlimited

# Print proxy count
if [ -n "$RIN_PROXIES" ]; then
    local count=$(echo "$RIN_PROXIES" | tr ',' '\n' | wc -l)
    echo -e "${G}  ∞ ${count} proxies • Unlimited mode${N}"
fi
echo ""

# Run Rin
cd "$RIN_HOME/src"
exec "$BUN" run --conditions=browser packages/opencode/src/index.ts "$@"
