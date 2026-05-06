#!/usr/bin/env bash
# [fork-only] DeskFox installer version bump (macOS/Linux)
#
# Rule: YYYY.M.D.N (Year.Month.Day.Nth-of-day, N starts from 1)
# Per-platform counter: Windows and macOS each maintain their own N sequence.
#
# Usage:
#   bash packages/branding/scripts/bump-installer-version.sh -Platform macOS
#   bash packages/branding/scripts/bump-installer-version.sh -Platform macOS --dry-run

set -e

PLATFORM=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Platform|--platform|-p)
            PLATFORM="$2"
            shift 2
            ;;
        --dry-run|-DryRun)
            DRY_RUN=1
            shift
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 1
            ;;
    esac
done

if [[ "$PLATFORM" != "Windows" && "$PLATFORM" != "macOS" ]]; then
    echo "Usage: $0 -Platform <Windows|macOS> [--dry-run]" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"
ISS_FILE="$BRANDING_ROOT/installer/DeskFox.iss"
LOG_FILE="$REPO_ROOT/docs/installer-versions.md"
JSON_FILE="$BRANDING_ROOT/installer-versions.json"

if [[ ! -f "$LOG_FILE" ]]; then
    echo "version log not found: $LOG_FILE" >&2
    exit 1
fi
if [[ ! -f "$JSON_FILE" ]]; then
    echo "installer-versions.json not found: $JSON_FILE" >&2
    exit 1
fi

# Compute today's version (per-platform counter)
# %-m / %-d strips leading zero on GNU date; macOS date also supports it.
# Fallback: strip via sed if needed.
TODAY="$(date '+%Y.%-m.%-d' 2>/dev/null || date '+%Y.%m.%d' | sed 's/\.0/./g')"
# Match entries for THIS platform: ## [Platform] YYYY.M.D.N
# Use grep + sed (BSD-compatible, no -P flag needed on macOS)
ESCAPED_TODAY="${TODAY//./\\.}"
EXISTING_NS=$(grep "## \[$PLATFORM\] $TODAY\." "$LOG_FILE" 2>/dev/null \
    | sed -n "s/.*## \[$PLATFORM\] ${TODAY//./\\.}\.\([0-9]*\).*/\1/p" || true)

if [[ -n "$EXISTING_NS" ]]; then
    MAX_N=$(echo "$EXISTING_NS" | sort -n | tail -1)
    NEXT_N=$((MAX_N + 1))
else
    NEXT_N=1
fi
NEW_VERSION="$TODAY.$NEXT_N"

echo "[bump] platform=$PLATFORM, today=$TODAY, existing N=${EXISTING_NS:-none}, next=$NEW_VERSION"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[bump] DRY RUN, no files changed. Would set version=$NEW_VERSION (platform=$PLATFORM)"
    exit 0
fi

# 1. Update .iss AppVersion (Windows only)
if [[ "$PLATFORM" == "Windows" && -f "$ISS_FILE" ]]; then
    sed -i.bak "s/#define AppVersion \"[^\"]*\"/#define AppVersion \"$NEW_VERSION\"/" "$ISS_FILE"
    rm -f "$ISS_FILE.bak"
    echo "[bump] updated $ISS_FILE -> AppVersion=$NEW_VERSION"
else
    echo "[bump] platform=$PLATFORM, skipping .iss update"
fi

# 2. Prepend placeholder entry to version log (above first existing ## entry)
TIMESTAMP="$(date '+%Y-%m-%d %H:%M')"
PLACEHOLDER="
## [$PLATFORM] $NEW_VERSION — $TIMESTAMP

(to be filled: commits / plugin / installer path after ship)

---"

# Find the line number of first "## " entry and insert before it
FIRST_HEADER_LINE=$(grep -n '^## ' "$LOG_FILE" | head -1 | cut -d: -f1)
if [[ -n "$FIRST_HEADER_LINE" ]]; then
    # Insert placeholder before the first ## line
    head -n $((FIRST_HEADER_LINE - 1)) "$LOG_FILE" > "$LOG_FILE.tmp"
    echo "$PLACEHOLDER" >> "$LOG_FILE.tmp"
    tail -n +"$FIRST_HEADER_LINE" "$LOG_FILE" >> "$LOG_FILE.tmp"
    mv "$LOG_FILE.tmp" "$LOG_FILE"
else
    # No prior entries, append
    echo "$PLACEHOLDER" >> "$LOG_FILE"
fi
echo "[bump] prepended placeholder to $LOG_FILE"

# 3. Update installer-versions.json (front-end reads this to render settings dialog footer)
#    Surgical sed update on the platform's key — preserves formatting/indent/key order.
#    BSD-compatible: -i with empty backup arg, then rm the backup.
if [[ "$PLATFORM" == "Windows" ]]; then
    JSON_KEY="windows"
else
    JSON_KEY="macos"
fi
# Match: "windows": "anything"  ->  "windows": "$NEW_VERSION"
# Use a delimiter that won't appear in version string (|).
sed -i.bak "s|\"$JSON_KEY\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"$JSON_KEY\": \"$NEW_VERSION\"|" "$JSON_FILE"
rm -f "$JSON_FILE.bak"
# Verify the key was actually replaced (grep returns 0 if found)
if ! grep -q "\"$JSON_KEY\"[[:space:]]*:[[:space:]]*\"$NEW_VERSION\"" "$JSON_FILE"; then
    echo "[bump] ERROR: failed to update $JSON_FILE for key=$JSON_KEY" >&2
    exit 1
fi
echo "[bump] updated $JSON_FILE -> $JSON_KEY=$NEW_VERSION"

# 4. Output new version (used by caller)
echo "VERSION=$NEW_VERSION"
