#!/bin/bash
# Test runner for packages/opencode
# Handles the bun test hang issue (server tests keep event loop alive)
# Usage: ./script/test.sh [additional bun test args]
#
# Exit codes:
#   0 = all tests passed
#   1 = test failures detected
#   2 = tests timed out before producing results

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# Max time to wait for tests (seconds). Override with TEST_TIMEOUT env var.
MAX_WAIT="${TEST_TIMEOUT:-420}"

OUTPUT_FILE=$(mktemp)
trap "rm -f $OUTPUT_FILE" EXIT

echo "Running test suite (timeout: ${MAX_WAIT}s)..."
echo ""

# Run bun test in background, tee output to file and stdout
bun test --timeout 60000 "$@" 2>&1 | tee "$OUTPUT_FILE" &
PIPE_PID=$!

# Wait for either: process exits naturally, or timeout
SECONDS_WAITED=0
while kill -0 $PIPE_PID 2>/dev/null; do
  sleep 1
  SECONDS_WAITED=$((SECONDS_WAITED + 1))

  # Check if summary line appeared (tests are done, process just won't exit)
  if grep -q "^Ran .* tests across .* files" "$OUTPUT_FILE" 2>/dev/null; then
    sleep 2  # Give it a moment to flush
    kill $PIPE_PID 2>/dev/null
    wait $PIPE_PID 2>/dev/null
    break
  fi

  if [ $SECONDS_WAITED -ge $MAX_WAIT ]; then
    echo ""
    echo "⚠️  Timeout reached (${MAX_WAIT}s) — killing test process"
    kill $PIPE_PID 2>/dev/null
    wait $PIPE_PID 2>/dev/null
    # Check if we got results before timeout
    if grep -q "pass" "$OUTPUT_FILE" 2>/dev/null; then
      break
    fi
    echo "❌ Tests timed out without producing results"
    exit 2
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Parse results
PASS_COUNT=$(grep -oE "[0-9]+ pass" "$OUTPUT_FILE" | tail -1 | grep -oE "[0-9]+")
FAIL_COUNT=$(grep -oE "[0-9]+ fail" "$OUTPUT_FILE" | tail -1 | grep -oE "[0-9]+")
SKIP_COUNT=$(grep -oE "[0-9]+ skip" "$OUTPUT_FILE" | tail -1 | grep -oE "[0-9]+")

if [ -z "$PASS_COUNT" ]; then
  echo "❌ Could not parse test results"
  exit 2
fi

echo "Results: ${PASS_COUNT} pass, ${FAIL_COUNT:-0} fail, ${SKIP_COUNT:-0} skip"

if [ "${FAIL_COUNT:-0}" = "0" ]; then
  echo "✅ All tests passed"
  exit 0
else
  echo "❌ ${FAIL_COUNT} test(s) failed"
  echo ""
  # Show failure details
  grep -A2 "✗\|FAIL\|error:" "$OUTPUT_FILE" | head -40
  exit 1
fi
