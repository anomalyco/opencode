#!/usr/bin/env bash
set -euo pipefail

echo "=== Testing Railway Healthcheck Issue ==="
echo ""

# Build the Docker image
echo "Step 1: Building Docker image..."
docker build -t opencode-healthcheck-test -f Dockerfile .

# Run the container with test environment
echo ""
echo "Step 2: Starting container..."
CONTAINER_ID=$(docker run -d \
  -e OPENCODE_SERVER_PASSWORD=test-password \
  -e OPENCODE_SERVER_USERNAME=opencode \
  -p 3000:3000 \
  opencode-healthcheck-test)

echo "Container started: $CONTAINER_ID"
echo ""
echo "Step 3: Waiting for services to start (30s)..."
sleep 30

echo ""
echo "Step 4: Testing healthcheck endpoint..."
echo ""

# Test the healthcheck endpoint
echo "Testing GET http://localhost:3000/healthz"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/healthz || echo "000")
echo "Response code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Healthcheck PASSED"
  RESPONSE=$(curl -s http://localhost:3000/healthz)
  echo "Response: $RESPONSE"
elif [ "$HTTP_CODE" = "503" ]; then
  echo "❌ Healthcheck FAILED - Service Unhealthy (Backend not ready)"
  echo ""
  echo "Checking backend logs..."
  docker exec "$CONTAINER_ID" cat /tmp/opencode-backend.log 2>/dev/null || echo "No backend logs found"
  echo ""
  echo "Checking if backend is running..."
  docker exec "$CONTAINER_ID" ps aux | grep -E "(bun|node)" || echo "No Node/Bun processes found"
  echo ""
  echo "Testing backend directly..."
  docker exec "$CONTAINER_ID" curl -s -u "opencode:test-password" http://127.0.0.1:4096/global/health || echo "Backend health check failed"
else
  echo "❌ Healthcheck FAILED - Unexpected response code: $HTTP_CODE"
  echo ""
  echo "Raw response:"
  curl -v http://localhost:3000/healthz 2>&1 || true
fi

echo ""
echo "Step 5: Cleanup..."
docker stop "$CONTAINER_ID" >/dev/null 2>&1 || true
docker rm "$CONTAINER_ID" >/dev/null 2>&1 || true

echo ""
echo "=== Test Complete ==="
