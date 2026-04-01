#!/usr/bin/env bash
#
# Reproduction script for SIGTSTP mouse garbling.
#
# Usage:
#   1. In Terminal 1: Run opencode normally
#   2. In Terminal 2: Run this script with the opencode PID:
#      ./test-sigtstp-mouse.sh <PID>
#   3. In Terminal 1: Move the mouse after opencode is suspended
#
# Without the fix: garbled escape sequences appear (35;89;19M35;84;20M...)
# With the fix: clean shell prompt, no garbled text
#
# You can also test without opencode by using any TUI that enables mouse:
#   python3 -c "import sys; sys.stdout.write('\x1b[?1003h\x1b[?1006h'); input()"
#   Then send SIGTSTP from another terminal.

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <PID>"
  echo ""
  echo "Sends SIGTSTP to the given PID to test mouse cleanup."
  echo "Run opencode in another terminal first, then pass its PID."
  echo ""
  echo "Find the PID with: pgrep -f opencode"
  exit 1
fi

PID="$1"

echo "Sending SIGTSTP to PID $PID..."
echo "Switch to the opencode terminal and move the mouse."
echo "If you see garbled text like '35;89;19M35;84;20M...' the bug is present."
echo ""

kill -TSTP "$PID"

echo "Done. Resume with: kill -CONT $PID  (or 'fg' in the opencode terminal)"
