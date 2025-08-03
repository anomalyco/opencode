#!/bin/bash

echo "Testing Character Visual Mode"
echo "============================"
echo ""
echo "1. Run: OPENCODE_VIM_DEBUG=1 ./opencode"
echo "2. Press 'i' to enter insert mode" 
echo "3. Type: hello world"
echo "4. Press ESC to exit insert mode"
echo "5. Press '0' to go to start of line"
echo "6. Press 'v' to enter character visual mode"
echo "7. Press 'l' multiple times to select characters"
echo ""
echo "Expected: Each character should be highlighted individually"
echo "         with reverse video (light on dark background)"
echo ""
echo "Press Enter to continue..."
read

OPENCODE_VIM_DEBUG=1 ./opencode 2>vim-debug.log