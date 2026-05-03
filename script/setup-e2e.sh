#!/usr/bin/env bash
# Setup script for E2E tests
# Usage: ./script/setup-e2e.sh

set -e

if [ ! -s packages/executor/output/vmlinux ] || [ ! -s packages/executor/output/initrd.img ] || [ ! -s packages/executor/output/rootfs.ext4 ]; then
  echo "[E2E Setup] Missing QEMU guest VM artifacts (vmlinux, initrd.img, rootfs.ext4)."
  echo ""
  echo "Build them first on a Linux machine (debootstrap needs Linux):"
  echo "  (cd packages/executor && bun run build-vm)"
  echo ""
  echo "Expected files:"
  echo "  packages/executor/output/vmlinux"
  echo "  packages/executor/output/initrd.img"
  echo "  packages/executor/output/rootfs.ext4"
  exit 1
fi

echo "[E2E Setup] Starting Docker Compose environment..."
docker compose -f docker-compose.e2e.yml up -d postgres executor

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
echo "  Executor:  http://localhost:8080"
echo ""
echo "Run tests with: bun run test:e2e:local"
