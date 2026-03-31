#!/usr/bin/env bash

set -euo pipefail

# Bun's default clonefile backend can trip over existing files in sibling worktrees.
bun install --backend=copyfile

if [ -f "$CONDUCTOR_ROOT_PATH/.env.local" ] && [ ! -e .env.local ]; then
  ln -s "$CONDUCTOR_ROOT_PATH/.env.local" .env.local
fi

if [ -f "$CONDUCTOR_ROOT_PATH/packages/app/.env.local" ] && [ ! -e packages/app/.env.local ]; then
  ln -s "$CONDUCTOR_ROOT_PATH/packages/app/.env.local" packages/app/.env.local
fi

# Copy shared workspace data into this worktree
lnko_src="/Users/mac/lnko"
lnko_dest="$PWD/lnko"
if [ -d "$lnko_src" ] && [ ! -d "$lnko_dest" ]; then
  echo "Copying $lnko_src → $lnko_dest"
  cp -R "$lnko_src" "$lnko_dest"
fi
