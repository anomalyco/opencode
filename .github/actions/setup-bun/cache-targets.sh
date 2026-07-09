#!/usr/bin/env bash
set -euo pipefail

selector="$1"
base_url="$2"
version="$3"
revision="$4"
cache="$5"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT

targets=(
  linux-aarch64 linux-x64 linux-x64-baseline
  linux-aarch64-musl linux-x64-musl linux-x64-musl-baseline
  darwin-aarch64 darwin-x64
  windows-aarch64 windows-x64 windows-x64-baseline
)
if [[ "$selector" != "canary" ]]; then
  targets+=(darwin-x64-baseline)
fi

mkdir -p "$cache"
for target in "${targets[@]}"; do
  curl -fsSL "${base_url}/bun-${target}.zip" -o "$temp/bun.zip"
  unzip -qo "$temp/bun.zip" -d "$temp"
  binary="bun"
  [[ "$target" == windows-* ]] && binary="bun.exe"
  source="$temp/bun-${target}/${binary}"
  grep -aFq "$revision" "$source"
  install -m 755 "$source" "$cache/bun-${target}-v${version}"
  rm -rf "$temp/bun-${target}" "$temp/bun.zip"
done
