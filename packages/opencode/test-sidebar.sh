#!/bin/bash
# Start OpenCode in background
bun dev 2>&1 | tee /tmp/opencode-debug.log &
PID=$!

# Wait for startup
sleep 5

# Kill it
kill $PID

# Show relevant logs
echo "=== Plugin Loading Logs ==="
grep -i "plugin\|context" /tmp/opencode-debug.log | head -20

echo ""
echo "=== PluginComponent Logs ==="
grep -i "PluginComponent" /tmp/opencode-debug.log | head -10

echo ""
echo "=== Error Logs ==="
grep -i "error\|failed" /tmp/opencode-debug.log | head -10
