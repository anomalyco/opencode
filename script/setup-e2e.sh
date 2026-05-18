#!/usr/bin/env bash
# Legacy helper: run Postgres + Ollama on fixed ports via Compose (optional manual debugging).
# Normal E2E (`bun run --cwd packages/app e2e`) uses Testcontainers — you do not need this script.

set -e

echo "[E2E Setup] Starting docker-compose.e2e.yml (postgres + ollama on localhost:15432 / :11435)..."
docker compose -f docker-compose.e2e.yml up -d postgres

echo "[E2E Setup] Waiting for Ollama..."
if ! docker compose -f docker-compose.e2e.yml ps ollama | grep -q "running"; then
  docker compose -f docker-compose.e2e.yml up -d ollama
fi

echo "[E2E Setup] Ensuring llama3.2:1b..."
docker compose -f docker-compose.e2e.yml exec -T ollama ollama pull llama3.2:1b

echo "[E2E Setup] ✓ Compose stack ready (optional — Testcontainers-based runner does not use this)."
