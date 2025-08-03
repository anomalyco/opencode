#!/bin/bash
# Development script to run OpenCode TUI with Vim mode

# Set required environment variables
export OPENCODE_SERVER="http://localhost:8080"
export OPENCODE_APP_INFO='{
  "id": "dev",
  "version": "dev",
  "path": {
    "root": "'$HOME'/.opencode",
    "data": "'$HOME'/.opencode/data",
    "config": "'$HOME'/.config/opencode",
    "cwd": "'$PWD'"
  }
}'
export OPENCODE_MODES='[
  {
    "id": "architect",
    "name": "Architect",
    "description": "Build complex software projects",
    "instructions": "You are an expert software architect."
  },
  {
    "id": "explorer",
    "name": "Explorer",
    "description": "Research and understand codebases",
    "instructions": "You are a code exploration expert."
  }
]'

# Build and run
echo "Building OpenCode with Vim mode support..."
go build -o opencode ./cmd/opencode

echo "Starting OpenCode..."
echo "Tips:"
echo "  - Press Ctrl+Alt+V or type /vim to toggle Vim mode"
echo "  - Look for [NORMAL] in the status line"
echo ""

./opencode "$@"