#!/bin/bash
# Go linting script for Claude Code hooks
# This script runs Go linters on modified files

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Only show detailed output if DEBUG is set
if [[ -n "$DEBUG" ]]; then
    echo "🔍 Go linting hook triggered"
    echo "Script directory: $SCRIPT_DIR"
    echo "Project root: $PROJECT_ROOT"
fi

# Change to packages/tui directory
TUI_DIR="$PROJECT_ROOT/packages/tui"
if [[ ! -d "$TUI_DIR" ]]; then
    echo "❌ Could not find packages/tui directory at $TUI_DIR"
    exit 0  # Exit gracefully to not block Claude Code
fi

cd "$TUI_DIR" || exit 0

# Check if go is available
if ! command -v go &> /dev/null; then
    echo "⚠️  Go is not installed or not in PATH"
    exit 0
fi

# Run go fmt
echo "📐 Running go fmt..."
go fmt ./... 2>/dev/null || true

# Run go vet
echo "🔎 Running go vet..."
if ! go vet ./... 2>&1 | grep -v "internal/components/qr"; then
    echo "❌ go vet found errors"
    exit 0  # Don't block Claude Code
fi

# Run staticcheck if available
if command -v staticcheck &> /dev/null; then
    echo "🧠 Running staticcheck..."
    if ! staticcheck ./...; then
        echo "⚠️  staticcheck found issues (non-blocking)"
        # Don't fail on staticcheck issues as they might be pre-existing
    fi
else
    echo "ℹ️  staticcheck not installed, skipping"
fi

# Only show success if we actually ran something
if command -v go &> /dev/null; then
    echo "✅ Go linting completed"
fi
exit 0