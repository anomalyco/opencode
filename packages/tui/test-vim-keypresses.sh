#!/bin/bash
# Test script to verify vim mode keypresses work

echo "Testing Vim Mode Keypresses"
echo "==========================="
echo ""
echo "This script will help verify that vim mode is working correctly."
echo ""
echo "Test steps:"
echo "1. Start OpenCode"
echo "2. Enable vim mode with /vim or Ctrl+Alt+V"
echo "3. Verify you see [NORMAL] in status line"
echo "4. Press 'i' to enter insert mode - should see [INSERT]"
echo "5. Type some text - it should appear"
echo "6. Press Esc to return to normal mode - should see [NORMAL]"
echo "7. Try vim motions: h,j,k,l to move cursor"
echo "8. Try 'dd' to delete a line"
echo "9. Try 'yy' then 'p' to copy and paste a line"
echo ""
echo "Starting OpenCode in 3 seconds..."
sleep 3

# Run from project root
cd ../..
bun run packages/opencode/src/index.ts