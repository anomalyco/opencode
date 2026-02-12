#!/bin/bash
#
# Clone repositories used by MULocBench benchmark.
# Repositories are cloned to ../dataset/repos/ relative to this script.
#
# Usage:
#   ./clone_repos.sh              # Clone all repos at HEAD
#   ./clone_repos.sh --shallow    # Shallow clone (faster, less disk space)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# File containing repository URLs (one per line)
REPO_FILE="${SCRIPT_DIR}/repos.txt"

# Directory to store the repositories (inside locagent)
TARGET_DIR="${SCRIPT_DIR}/dataset/repos"

# Parse arguments
SHALLOW=false
if [[ "$1" == "--shallow" ]]; then
    SHALLOW=true
fi

mkdir -p "$TARGET_DIR"

echo "=============================================="
echo "MULocBench Repository Cloner"
echo "=============================================="
echo "Repos file: $REPO_FILE"
echo "Target dir: $TARGET_DIR"
echo "Shallow clone: $SHALLOW"
echo "=============================================="

# Count total repos
TOTAL_REPOS=$(grep -c '^https' "$REPO_FILE" 2>/dev/null || echo 0)
echo "Total repositories to process: $TOTAL_REPOS"
echo ""

# Function to clone or update a single repo
clone_repo() {
    local repo_url="$1"
    local target_dir="$2"
    local shallow="$3"

    # Extract the repository name from the URL
    local repo_name=$(basename "$repo_url" .git)
    local repo_path="$target_dir/$repo_name"

    if [ -d "$repo_path" ]; then
        echo "[UPDATE] $repo_name - pulling latest..."
        cd "$repo_path" || return 1
        git pull origin HEAD 2>/dev/null || git fetch origin 2>/dev/null || true
        cd - > /dev/null
    else
        echo "[CLONE] $repo_name ..."
        if [ "$shallow" = true ]; then
            git clone --depth 1 "$repo_url" "$repo_path" 2>&1 || {
                echo "[ERROR] Failed to clone $repo_name"
                return 1
            }
        else
            git clone "$repo_url" "$repo_path" 2>&1 || {
                echo "[ERROR] Failed to clone $repo_name"
                return 1
            }
        fi
    fi

    echo "[OK] $repo_name"
    return 0
}

# Process repos
SUCCESS_COUNT=0
FAIL_COUNT=0

while read -r repo_url; do
    # Skip empty lines and comments
    [[ -z "$repo_url" || "$repo_url" =~ ^# ]] && continue

    if clone_repo "$repo_url" "$TARGET_DIR" "$SHALLOW"; then
        ((++SUCCESS_COUNT))
    else
        ((++FAIL_COUNT))
    fi
done < "$REPO_FILE"

echo ""
echo "=============================================="
echo "Clone Summary"
echo "=============================================="
echo "Successful: $SUCCESS_COUNT"
echo "Failed: $FAIL_COUNT"
echo "Total: $TOTAL_REPOS"
echo "=============================================="

if [ $FAIL_COUNT -gt 0 ]; then
    echo "Warning: Some repositories failed to clone"
    exit 1
fi

echo "All repositories have been cloned successfully."
echo ""
echo "Note: For evaluation, checkout specific base_commit from mulocbench.json per issue."
