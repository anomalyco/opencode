#!/bin/bash
echo "Testing escape key detection..."
echo "Instructions:"
echo "1. Run ./opencode"
echo "2. Enable vim mode with /vim"
echo "3. Press 'i' to enter insert mode"
echo "4. Press ESC key"
echo "5. Check the log to see what key string was generated"
echo ""
echo "Clearing log..."
rm -f /tmp/vim-debug.log

echo "Starting in 3 seconds..."
sleep 3

# Run opencode and pipe to grep to see escape-related logs
tail -f /tmp/vim-debug.log | grep -E "KeyPress|Escape|key=\"\""