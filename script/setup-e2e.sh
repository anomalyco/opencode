#!/usr/bin/env bash
# Setup script for E2E tests
# Usage: ./script/setup-e2e.sh

set -e

echo "[E2E Setup] Starting Docker Compose environment..."
docker compose -f docker-compose.e2e.yml up -d postgres

echo "[E2E Setup] Waiting for Ollama to be ready..."
if ! docker compose -f docker-compose.e2e.yml ps ollama | grep -q "running"; then
  echo "[E2E Setup] Starting Ollama container..."
  docker compose -f docker-compose.e2e.yml up -d ollama

  echo "[E2E Setup] Pulling qwen2.5:0.5b model (this may take a while on first run)..."
  docker compose -f docker-compose.e2e.yml exec -T ollama ollama pull qwen2.5:0.5b
fi

echo "[E2E Setup] ✓ Environment ready!"
echo ""
echo "Services:"
echo "  Postgres:  postgres://veritly:veritly@localhost:15432/veritly"
echo "  Ollama:    http://localhost:11434 (model: qwen2.5:0.5b)"
echo ""
echo "Run tests with: bun run test:e2e:local"
