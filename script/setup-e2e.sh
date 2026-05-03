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
fi

echo "[E2E Setup] Ensuring llama3.2:1b is present (required by packages/app/script/e2e-local.ts)..."
docker compose -f docker-compose.e2e.yml exec -T ollama ollama pull llama3.2:1b

echo "[E2E Setup] ✓ Environment ready!"
echo ""
echo "Services:"
echo "  Postgres:  postgres://veritly:veritly@localhost:15432/veritly"
echo "  Ollama:    http://localhost:11435 (host maps to container :11434; model: llama3.2:1b)"
echo ""
echo "Run tests with: bun run --cwd packages/app test:e2e:local"
