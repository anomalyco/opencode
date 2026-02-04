#!/bin/bash
# Get current developer name
#
# This is a wrapper that uses common/paths.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common/paths.sh"

developer=$(get_developer)
if [[ -n "$developer" ]]; then
  echo "$developer"
else
  echo "Developer not initialized" >&2
  exit 1
fi
