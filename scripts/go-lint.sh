#!/bin/bash
# Go linting script for Claude Code hooks
# This script runs Go linters on modified files

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if any modified files are Go files
# Claude Code passes tool input as JSON via stdin
if [ -t 0 ]; then
    # No stdin available, can't determine file
    echo "[WARNING] No file information available from hook"
else
    # Read the JSON input from stdin
    TOOL_INPUT=$(cat)
    
    # Extract file_path using jq if available, otherwise use grep/sed
    if command -v jq &> /dev/null; then
        FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)
    else
        # Fallback: basic extraction using grep and sed
        FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    fi
    
    # Check if we got a file path
    if [[ -n "$FILE_PATH" ]]; then
        # Check if the file is a Go file
        if [[ ! "$FILE_PATH" =~ \.go$ ]]; then
            # Not a Go file, exit silently
            exit 0
        fi
        # Also check if it's in the packages/tui directory
        if [[ ! "$FILE_PATH" =~ packages/tui/ ]]; then
            # Go file but not in packages/tui, exit silently
            exit 0
        fi
    fi
fi

# Only show detailed output if DEBUG is set
if [[ -n "$DEBUG" ]]; then
    echo "[DEBUG] Go linting hook triggered"
    echo "[DEBUG] Script directory: $SCRIPT_DIR"
    echo "[DEBUG] Project root: $PROJECT_ROOT"
    echo "[DEBUG] Modified file: $FILE_PATH"
fi

# Change to packages/tui directory
TUI_DIR="$PROJECT_ROOT/packages/tui"
if [[ ! -d "$TUI_DIR" ]]; then
    echo "[ERROR] Could not find packages/tui directory at $TUI_DIR"
    exit 0  # Exit gracefully to not block Claude Code
fi

cd "$TUI_DIR" || exit 0

# Check if go is available
if ! command -v go &> /dev/null; then
    echo "[WARNING] Go is not installed or not in PATH"
    exit 0
fi

# Run go fmt
echo "[FMT] Running go fmt..."
go fmt ./... 2>/dev/null || true

# Run go vet
echo "[VET] Running go vet..."
if ! go vet ./... 2>&1 | grep -v "internal/components/qr"; then
    echo "[ERROR] go vet found errors"
    exit 0  # Don't block Claude Code
fi

# Run staticcheck if available
if command -v staticcheck &> /dev/null; then
    echo "[CHECK] Running staticcheck..."
    if ! staticcheck ./...; then
        echo "[WARNING] staticcheck found issues (non-blocking)"
        # Don't fail on staticcheck issues as they might be pre-existing
    fi
else
    echo "[INFO] staticcheck not installed, skipping"
fi

# Only show success if we actually ran something
if command -v go &> /dev/null; then
    echo "[DONE] Go linting completed"
fi
exit 0