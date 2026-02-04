#!/bin/bash
# Get Session Context for AI Agent
#
# This is a wrapper that calls the actual implementation in common/git-context.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/common/git-context.sh" "$@"
