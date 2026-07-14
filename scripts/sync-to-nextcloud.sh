#!/usr/bin/env bash
# sync-to-nextcloud.sh — Upload latest gentle-opencode release to Nextcloud public share
#
# Usage:
#   ./scripts/sync-to-nextcloud.sh [version]
#
#   Without version: syncs the latest GitHub release
#   With version:    syncs that specific version (e.g., v1.0.2)
#
# Requirements: curl, gh (GitHub CLI)
#
# The Nextcloud share URL (public file drop) is read from NEXTCLOUD_SHARE_URL
# or passed as the second argument.

set -euo pipefail

REPO="ivanfernadezm99/opencode"
SHARE_URL="${NEXTCLOUD_SHARE_URL:-https://enlaceschacocloud.duckdns.org/s/ojAcbHDQBTX97oD}"
SHARE_TOKEN="${SHARE_URL##*/}"
WEBDAV_BASE="https://enlaceschacocloud.duckdns.org/public.php/webdav"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}==>${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*"; }

# ─── Version ────────────────────────────────────────────────────────────────

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    log "Fetching latest release..."
    VERSION=$(gh release view --repo "$REPO" --json tagName --jq '.tagName' 2>/dev/null)
    if [ -z "$VERSION" ]; then
        err "Could not determine latest release from $REPO"
        exit 1
    fi
fi
log "Syncing release: $VERSION"

# ─── Temp dir ───────────────────────────────────────────────────────────────

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# ─── Download assets from GitHub ─────────────────────────────────────────────

log "Downloading assets from GitHub..."
gh release download "$VERSION" --repo "$REPO" --dir "$TMPDIR" 2>&1 | while read -r line; do
    ok "$line"
done

# Check we got something
ASSET_COUNT=$(ls -1 "$TMPDIR" 2>/dev/null | wc -l)
if [ "$ASSET_COUNT" -eq 0 ]; then
    err "No assets downloaded from $VERSION"
    exit 1
fi
ok "$ASSET_COUNT assets downloaded"

# ─── Upload to Nextcloud ─────────────────────────────────────────────────────

log "Uploading to Nextcloud ($SHARE_URL)..."

UPLOADED=0
FAILED=0

for file in "$TMPDIR"/*; do
    filename=$(basename "$file")
    size=$(du -h "$file" | cut -f1)

    printf "  Uploading %-50s (%s) ... " "$filename" "$size"

    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X PUT \
        -u "${SHARE_TOKEN}:" \
        --data-binary "@$file" \
        "$WEBDAV_BASE/$filename" 2>&1)

    if [ "$http_code" = "201" ] || [ "$http_code" = "204" ]; then
        echo -e "${GREEN}OK${NC}"
        UPLOADED=$((UPLOADED + 1))
    else
        echo -e "${RED}FAIL (HTTP $http_code)${NC}"
        FAILED=$((FAILED + 1))
    fi
done

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
log "Sync complete: $UPLOADED uploaded, $FAILED failed"
echo ""
echo -e "  ${CYAN}Download links:${NC}"
for file in "$TMPDIR"/*; do
    filename=$(basename "$file")
    echo -e "    ${GREEN}${SHARE_URL}/download?path=/&files=${filename}${NC}"
done
