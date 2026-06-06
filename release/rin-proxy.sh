#!/bin/bash
# =============================================================================
# Rin Proxy Manager — Free Proxy Fetcher & Rotator
# =============================================================================
# Fetches fresh free proxies from multiple sources and outputs them in the
# format Rin expects for $RIN_PROXIES.
#
# Usage:
#   bash script/rin-proxy.sh              # Quick fetch (fast mode)
#   bash script/rin-proxy.sh --all         # Fetch from ALL sources (slower)
#   bash script/rin-proxy.sh --export      # Export to RIN_PROXIES file
#   bash script/rin-proxy.sh --count       # Just count available proxies
#   bash script/rin-proxy.sh --watch       # Continuous refresh every 5 min
#   source script/rin-proxy.sh            # Export RIN_PROXIES env var
#
# Sources:
#   - ProxyScrape API (HTTP, SOCKS4, SOCKS5) - ~500+ proxies
#   - GitHub proxy lists (multiple repos) - fallback
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[RIN-PROXY]${NC} $1" >&2; }
warn() { echo -e "${YELLOW}[RIN-PROXY]${NC} $1" >&2; }
err() { echo -e "${RED}[RIN-PROXY]${NC} $1" >&2; }

# =============================================================================
# Source 1: ProxyScrape (primary - best quality)
# =============================================================================
fetch_proxyscrape() {
    local protocol="${1:-http}"
    local url="https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&timeout=10000"
    [ "$protocol" != "all" ] && url="$url&protocol=$protocol"
    curl -s --max-time 15 "$url" 2>/dev/null || true
}

# =============================================================================
# Source 2: GitHub proxy lists (fallback)
# =============================================================================
fetch_github_proxies() {
    local urls=(
        "https://raw.githubusercontent.com/TheSpeedX/SOCKS5/master/list.txt|socks5"
        "https://raw.githubusercontent.com/TheSpeedX/HTTP-Proxy/master/list.txt|http"
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt|http"
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/https.txt|https"
        "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt|http"
        "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt|https"
        "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt|http"
        "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/socks4.txt|socks4"
        "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/socks5.txt|socks5"
    )
    
    for entry in "${urls[@]}"; do
        local url="${entry%%|*}"
        local proto="${entry##*|}"
        curl -s --max-time 10 "$url" 2>/dev/null | while IFS= read -r line; do
            line=$(echo "$line" | tr -d ' \r\n')
            [ -z "$line" ] && continue
            echo "${proto}://${line}"
        done &
    done
    wait
}

# =============================================================================
# Format: Remove duplicates and validate IP:port
# =============================================================================
format_proxies() {
    cat - | sort -u | while IFS= read -r entry; do
        entry=$(echo "$entry" | tr -d ' \r\n\t')
        [ -z "$entry" ] && continue
        
        # Extract ip:port
        local stripped="$entry"
        [[ "$entry" == *"://"* ]] && stripped=$(echo "$entry" | sed 's|.*://||')
        
        # Validate IP:port format
        if ! echo "$stripped" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$'; then
            continue
        fi
        
        # Ensure protocol prefix
        if [[ "$entry" != *"://"* ]]; then
            echo "http://${stripped}"
        else
            echo "$entry"
        fi
    done
}

# =============================================================================
# Quick fetch (just ProxyScrape - fast, ~500 proxies)
# =============================================================================
quick_fetch() {
    log "Fetching from ProxyScrape..."
    local proxies=$(fetch_proxyscrape "http")
    echo "$proxies" | format_proxies | shuf
}

# =============================================================================
# Full fetch (all sources - slower but more proxies)
# =============================================================================
full_fetch() {
    log "Fetching from ProxyScrape (HTTP)..."
    local http=$(fetch_proxyscrape "http")
    
    log "Fetching from ProxyScrape (SOCKS4)..."
    local socks4=$(fetch_proxyscrape "socks4")
    
    log "Fetching from ProxyScrape (SOCKS5)..."
    local socks5=$(fetch_proxyscrape "socks5")
    
    log "Fetching from GitHub proxy lists..."
    local github=$(fetch_github_proxies)
    
    echo "${http}
${socks4}
${socks5}
${github}" | format_proxies | shuf
}

# =============================================================================
# Export in Rin format (comma-separated)
# =============================================================================
export_rin_format() {
    local input=$(cat)
    local first=true
    while IFS= read -r proxy; do
        [ -z "$proxy" ] && continue
        if $first; then
            echo -n "$proxy"
            first=false
        else
            echo -n ",$proxy"
        fi
    done
    echo
}

# =============================================================================
# Watch mode
# =============================================================================
watch_mode() {
    local interval="${1:-300}"
    log "Starting proxy watch mode (refresh every ${interval}s)..."
    while true; do
        local count=$(full_fetch | wc -l | tr -d ' ')
        log "Fetched ${count} proxies"
        full_fetch | export_rin_format | tee /tmp/rin_proxies.txt
        sleep "$interval"
    done
}

# =============================================================================
# Main
# =============================================================================
case "${1:-}" in
    --all)
        full_fetch
        ;;
    --export)
        full_fetch | export_rin_format | tee /tmp/rin_proxies_export.txt
        log "Exported to /tmp/rin_proxies_export.txt"
        ;;
    --count)
        total=$(full_fetch | wc -l | tr -d ' ')
        echo "$total proxies available"
        ;;
    --watch)
        watch_mode "${2:-300}"
        ;;
    --help|-h)
        echo "Rin Proxy Manager — Free Proxy Fetcher & Rotator"
        echo ""
        echo "Usage:"
        echo "  bash script/rin-proxy.sh              Quick fetch (fast)"
        echo "  bash script/rin-proxy.sh --all         Fetch all sources"
        echo "  bash script/rin-proxy.sh --export      Export to file"
        echo "  bash script/rin-proxy.sh --count       Count proxies"
        echo "  bash script/rin-proxy.sh --watch N     Refresh every N sec"
        echo ""
        echo "Output: HTTP proxies, one per line (protocol://ip:port)"
        ;;
    *)
        # Quick fetch by default
        quick_fetch
        ;;
esac
