#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$SCRIPT_DIR/.." && pwd)/output"
fail=0
for arch in aarch64 x86_64; do
  d="$OUT/$arch/guest-root"
  k="$OUT/$arch/vmlinuz"
  if [ ! -d "$d" ] || [ ! -f "$d/bin/busybox" ]; then
    echo "missing or invalid guest-root: $d" >&2
    fail=1
  fi
  if [ ! -s "$k" ]; then
    echo "missing kernel: $k" >&2
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "run: (cd packages/executor && bun run build-vm)" >&2
  exit 1
fi
echo "guest artifacts ok under $OUT"
