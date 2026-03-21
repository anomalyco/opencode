#!/bin/bash

export DATABASE_URL=/tmp/debug-test.db
rm -f $DATABASE_URL

echo "=== Starting debug session ==="
./dist/opencode-linux-x64/bin/opencode --print-logs --log-level DEBUG session list 2>&1 | tee /tmp/debug.log

echo "=== Checking for any errors ==="
grep -i "error\|fail\|exception" /tmp/debug.log

echo "=== Test complete - check /tmp/debug.log for details ==="