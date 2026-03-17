#!/usr/bin/env bash
set -euo pipefail

echo "=== Testing Railway Healthcheck Issue Locally ==="
echo ""

# Test the actual healthcheck flow
cd "$(dirname "$0")"

# Set required environment variables
export OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:-test-password-123}"
export OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"

# Function to cleanup processes
cleanup() {
  echo ""
  echo "Cleaning up..."
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${PROXY_PID:-}" ]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Step 1: Starting backend server..."
echo "This will trigger database migration on first run..."
echo ""

# Create a temporary data directory for testing
export XDG_DATA_HOME="/tmp/opencode-test-data/.local/share"
export XDG_CONFIG_HOME="/tmp/opencode-test-data/.config"
export XDG_CACHE_HOME="/tmp/opencode-test-data/.cache"
export XDG_STATE_HOME="/tmp/opencode-test-data/.local/state"
export HOME="/tmp/opencode-test-data"
export OPENCODE_TEST_HOME="/tmp/opencode-test-data"

mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
mkdir -p /tmp/opencode-test-data/workspace

# Check if marker file exists
if [ -f "$XDG_DATA_HOME/opencode.db" ]; then
  echo "✓ Database marker file exists - no migration needed"
else
  echo "⚠ Database marker file NOT found - migration WILL run on startup"
  echo "  This can take 1-3 minutes!"
fi
echo ""

# Start the backend in the background
cd packages/opencode
bun src/index.ts serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode-backend.log 2>&1 &
BACKEND_PID=$!
cd ../..

echo "Backend started with PID: $BACKEND_PID"
echo ""

# Wait for backend to be ready
echo "Step 2: Waiting for backend to be healthy (max 120s)..."
BACKEND_READY=false
for i in $(seq 1 120); do
  if curl -fsS -u "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
       http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
    echo "✓ Backend is healthy (took ${i}s)"
    BACKEND_READY=true
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "  ...still waiting (${i}s)"
    # Show last few lines of log
    tail -5 /tmp/opencode-backend.log 2>/dev/null || true
  fi
  sleep 1
done

if [ "$BACKEND_READY" = false ]; then
  echo ""
  echo "❌ Backend failed to become healthy within 120s"
  echo ""
  echo "=== Backend Log ==="
  cat /tmp/opencode-backend.log
  echo "==================="
  exit 1
fi

echo ""
echo "Step 3: Starting custom app proxy..."

# Set the app dist directory
export OPENCODE_APP_DIST_DIR="$(pwd)/packages/app/dist"
export PORT=3000

# Start the custom app proxy
bun railway/serve-custom-app.mjs > /tmp/opencode-proxy.log 2>&1 &
PROXY_PID=$!

echo "Proxy started with PID: $PROXY_PID"
echo ""

# Wait for proxy to be ready
echo "Step 4: Waiting for proxy to start..."
sleep 2

echo "Step 5: Testing healthcheck endpoint..."
echo ""

# Test the healthcheck endpoint multiple times
echo "Testing GET http://127.0.0.1:3000/healthz"
for attempt in 1 2 3; do
  echo ""
  echo "Attempt $attempt:"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/healthz 2>&1 || echo "000")
  echo "  Response code: $HTTP_CODE"
  
  if [ "$HTTP_CODE" = "200" ]; then
    RESPONSE=$(curl -s http://127.0.0.1:3000/healthz 2>&1 || echo "<failed>")
    echo "  Response body: $RESPONSE"
    echo ""
    echo "✅ SUCCESS! Healthcheck is working correctly."
    exit 0
  elif [ "$HTTP_CODE" = "503" ]; then
    echo "  ⚠️  Service Unavailable (Backend not ready)"
  elif [ "$HTTP_CODE" = "000" ]; then
    echo "  ⚠️  Connection failed (Proxy not ready)"
  else
    echo "  ⚠️  Unexpected response: $HTTP_CODE"
  fi
  
  sleep 2
done

echo ""
echo "=== DIAGNOSTICS ==="
echo ""
echo "Backend process:"
ps aux | grep -E "$BACKEND_PID" | grep -v grep || echo "  Backend not running"
echo ""
echo "Proxy process:"
ps aux | grep -E "$PROXY_PID" | grep -v grep || echo "  Proxy not running"
echo ""
echo "Backend log (last 20 lines):"
tail -20 /tmp/opencode-backend.log 2>/dev/null || echo "  No log available"
echo ""
echo "Proxy log (last 20 lines):"
tail -20 /tmp/opencode-proxy.log 2>/dev/null || echo "  No log available"
echo ""
echo "❌ Healthcheck test FAILED"
exit 1
