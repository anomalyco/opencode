#!/bin/bash

echo "Testing Visual Mode Highlighting"
echo "================================"
echo ""
echo "This script will test character visual mode (v) highlighting."
echo "Follow these steps:"
echo "1. Press 'i' to enter insert mode"
echo "2. Type: 'hello world this is a test'"
echo "3. Press ESC to return to normal mode"
echo "4. Press 'v' to enter character visual mode"
echo "5. Use 'l' to move right and select characters"
echo "6. You should see character-by-character highlighting"
echo ""
echo "Press Enter to start the test..."
read

OPENCODE_VIM_DEBUG=1 ./opencode