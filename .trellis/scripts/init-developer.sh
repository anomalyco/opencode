#!/bin/bash
# Initialize developer for workflow
#
# Usage:
#   ./.trellis/scripts/init-developer.sh <developer-name>
#
# This creates:
#   - .trellis/.developer file with developer info
#   - .trellis/workspace/<name>/ directory structure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common/paths.sh"
source "$SCRIPT_DIR/common/developer.sh"

if [[ -z "$1" ]]; then
  echo "Usage: $0 <developer-name>"
  echo ""
  echo "Example:"
  echo "  $0 john"
  exit 1
fi

# Check if already initialized
existing=$(get_developer)
if [[ -n "$existing" ]]; then
  echo "Developer already initialized: $existing"
  echo ""
  echo "To reinitialize, remove $DIR_WORKFLOW/$FILE_DEVELOPER first"
  exit 0
fi

init_developer "$1"
