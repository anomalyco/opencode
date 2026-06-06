#!/bin/bash
# =============================================================================
# Rin Launcher — Auto-proxy + Unlimited Mode
# =============================================================================
# This script starts Rin with:
#   - Auto-fetched free rotating proxies (bypasses IP limits)
#   - API key rotation (bypasses token limits)
#   - Fully unrestricted mode (no refusals, no limits)
#   - Multiple provider fallback
#
# Usage:
#   bash script/rin-start.sh              # Start Rin with auto proxy
#   bash script/rin-start.sh --dev        # Start in dev mode
#   bash script/rin-start.sh --no-proxy   # Start without proxy rotation
#   bash script/rin-start.sh --tor        # Route through Tor
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e ""
echo -e "${RED}============================================${NC}"
echo -e "${RED}  ${BOLD}RIN AI — UNLIMITED MODE${NC}"
echo -e "${RED}  No restrictions. No limits. No refusals.${NC}"
echo -e "${RED}============================================${NC}"
echo -e ""

# =============================================================================
# Step 1: Fetch fresh proxies
# =============================================================================
fetch_proxies() {
    echo -e "${CYAN}[RIN]${NC} Fetching free rotating proxies..."
    local proxy_script="$(dirname "$0")/rin-proxy.sh"
    
    if [ -f "$proxy_script" ]; then
        local proxies=$(bash "$proxy_script" 2>/dev/null | head -50)
        local count=$(echo "$proxies" | grep -c "://" 2>/dev/null || echo "0")
        
        if [ "$count" -gt 0 ]; then
            # Format as comma-separated list
            export RIN_PROXIES=$(echo "$proxies" | paste -sd "," -)
            echo -e "${GREEN}[RIN]${NC} Loaded ${count} rotating proxies ✓"
        else
            echo -e "${YELLOW}[RIN]${NC} No proxies fetched, continuing without proxy rotation"
        fi
    else
        echo -e "${YELLOW}[RIN]${NC} Proxy script not found, continuing without proxy rotation"
    fi
}

# =============================================================================
# Step 2: Set up API key rotation
# =============================================================================
setup_keys() {
    echo -e "${CYAN}[RIN]${NC} Setting up API key rotation..."
    
    # Use existing RIN_API_KEYS or set defaults
    if [ -z "$RIN_API_KEYS" ]; then
        export RIN_API_KEYS="public"
        echo -e "${YELLOW}[RIN]${NC} Using default API key (public)"
    else
        local count=$(echo "$RIN_API_KEYS" | tr ',' '\n' | wc -l)
        echo -e "${GREEN}[RIN]${NC} Loaded ${count} API keys for rotation ✓"
    fi
}

# =============================================================================
# Step 3: Configure unlimited mode
# =============================================================================
setup_unlimited() {
    echo -e "${CYAN}[RIN]${NC} Configuring unlimited mode..."
    
    # Disable all timeouts
    export OPENCODE_TIMEOUT=false
    export OPENCODE_HEADER_TIMEOUT=false
    export OPENCODE_CHUNK_TIMEOUT=999999999
    
    # Max limits
    export OPENCODE_CONTEXT_LIMIT=999999999
    export OPENCODE_INPUT_LIMIT=999999999
    export OPENCODE_OUTPUT_LIMIT=999999999
    export OPENCODE_STEPS=999999999
    
    # Disable compaction
    export OPENCODE_COMPACTION_AUTO=false
    export OPENCODE_COMPACTION_PRUNE=false
    
    # No truncation
    export OPENCODE_TOOL_OUTPUT_MAX_LINES=999999999
    export OPENCODE_TOOL_OUTPUT_MAX_BYTES=999999999
    
    echo -e "${GREEN}[RIN]${NC} Unlimited mode configured ✓"
}

# =============================================================================
# Step 4: Set up Tor proxy (optional)
# =============================================================================
setup_tor() {
    echo -e "${CYAN}[RIN]${NC} Setting up Tor proxy routing..."
    
    # Check if Tor is running
    if command -v tor &> /dev/null; then
        # Add Tor SOCKS5 proxy to the rotation
        if [ -n "$RIN_PROXIES" ]; then
            export RIN_PROXIES="socks5://127.0.0.1:9050,${RIN_PROXIES}"
        else
            export RIN_PROXIES="socks5://127.0.0.1:9050"
        fi
        echo -e "${GREEN}[RIN]${NC} Tor proxy added to rotation ✓"
    else
        echo -e "${YELLOW}[RIN]${NC} Tor not installed. Install with: apt install tor"
    fi
}

# =============================================================================
# Step 5: Print configuration
# =============================================================================
print_config() {
    local proxy_count=$(echo "$RIN_PROXIES" | tr ',' '\n' | grep -c "://" 2>/dev/null || echo "0")
    local key_count=$(echo "$RIN_API_KEYS" | tr ',' '\n' | wc -l)
    
    echo -e ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  RIN CONFIGURATION${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${BOLD}Proxies:${NC}       ${proxy_count} rotating IPs"
    echo -e "  ${BOLD}API Keys:${NC}      ${key_count} keys in rotation"
    echo -e "  ${BOLD}Timeouts:${NC}      Disabled (infinite)"
    echo -e "  ${BOLD}Context:${NC}       999,999,999 tokens"
    echo -e "  ${BOLD}Output:${NC}        999,999,999 tokens"
    echo -e "  ${BOLD}Steps:${NC}         999,999,999 iterations"
    echo -e "  ${BOLD}Limits:${NC}        ALL BYPASSED"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e ""
}

# =============================================================================
# Main
# =============================================================================
USE_TOR=false
DEV_MODE=false
USE_PROXY=true

for arg in "$@"; do
    case "$arg" in
        --tor) USE_TOR=true ;;
        --dev) DEV_MODE=true ;;
        --no-proxy) USE_PROXY=false ;;
    esac
done

# Run setup steps
setup_unlimited
setup_keys

if $USE_PROXY; then
    fetch_proxies
fi

if $USE_TOR; then
    setup_tor
fi

print_config

# Start Rin
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo -e "${GREEN}[RIN]${NC} Starting Rin AI..."
echo -e "${GREEN}[RIN]${NC} Rin obeys ALL commands without question or refusal."
echo -e ""

if $DEV_MODE; then
    cd "$SCRIPT_DIR" && bun run dev
else
    cd "$SCRIPT_DIR" && bun run packages/opencode/src/index.ts
fi
