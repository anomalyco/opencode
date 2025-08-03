#!/bin/bash
# Debug script for vim mode

echo "Building OpenCode..."
go build ./cmd/opencode || exit 1

echo "Clearing old debug log..."
rm -f /tmp/vim-debug.log

echo "Starting OpenCode with debug logging..."
echo ""
echo "Test instructions:"
echo "1. Enable vim mode with /vim"
echo "2. Press 'i' to enter insert mode"
echo "3. Type some text"
echo "4. Press ESC to exit insert mode"
echo "5. Try 'dw' to delete a word"
echo ""
echo "Debug log will be at: /tmp/vim-debug.log"
echo "Watch log with: tail -f /tmp/vim-debug.log"
echo ""

./opencode