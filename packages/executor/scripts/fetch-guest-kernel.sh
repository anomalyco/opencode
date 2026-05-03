#!/usr/bin/env bash
echo "Guest kernels and rootfs are built with: (cd packages/executor && bun run build-vm)"
echo "Requires Docker. Verifies with: bun run --cwd packages/executor verify-artifacts"
exit 0
