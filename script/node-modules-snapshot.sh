#!/usr/bin/env bash
set -euo pipefail

system="${1:-unknown}"
suffix="${2:-}"
label="$system"
if [ -n "$suffix" ]; then
  label="$system-$suffix"
fi

root="$(pwd)"
work="$root/.tmp-node-modules"

cleanup() {
  rm -rf "$work"
  if [ -n "${HOME:-}" ] && [ -d "$HOME" ]; then
    rm -rf "$HOME"
  fi
  if [ -n "${BUN_INSTALL_CACHE_DIR:-}" ] && [ -d "$BUN_INSTALL_CACHE_DIR" ]; then
    rm -rf "$BUN_INSTALL_CACHE_DIR"
  fi
}

trap cleanup EXIT

rm -rf "$work"
mkdir -p "$work"

export HOME
export BUN_INSTALL_CACHE_DIR
HOME="$(mktemp -d)"
BUN_INSTALL_CACHE_DIR="$(mktemp -d)"

while IFS= read -r existing; do
  rm -rf "$existing"
done < <(find . -type d -name node_modules -prune | sort -r)

bun install \
  --frozen-lockfile \
  --ignore-scripts \
  --no-progress \
  --linker=isolated

bun --bun nix/scripts/canonicalize-node-modules.ts

i=0
while IFS= read -r dir; do
  rel="${dir#./}"
  dest="$work/$rel"
  mkdir -p "$(dirname "$dest")"
  cp -R "$dir" "$dest"
  i=$((i + 1))
done < <(find . -type d -name node_modules -prune | sort)

hash_path="node-modules-${label}.sha256"
nix hash path --sri "$work" | tee "$hash_path"

tar_name="node-modules-${label}.tar.gz"
tar -czf "$tar_name" -C "$work" .

manifest="node-modules-${label}.list"
find "$work" -print | sed "s|$work/||" | sort > "$manifest"

summary="node-modules-${label}.txt"
{
  printf "system=%s\n" "$system"
  printf "suffix=%s\n" "$suffix"
  printf "hash=%s\n" "$(cat "$hash_path")"
  printf "directories=%s\n" "$i"
  printf "tar=%s\n" "$tar_name"
  printf "manifest=%s\n" "$manifest"
} > "$summary"
