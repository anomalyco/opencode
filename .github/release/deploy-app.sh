#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
src=$(cd "$1" && pwd)
target="$release_dir/targets/app/v1"
unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS \
  ! -path ./v0/config.json ! -path ./v0/workers/default/worker.config.json \
  ! -path ./v0/workers/default/bundle/index.mjs ! -path './v0/workers/default/assets/*')
[[ -z "$unexpected" ]] || die 'Unexpected file in app artifact'
expect_json "$src/v0/config.json" "$target/root.json" 'App account and stage'
expect_json "$src/v0/workers/default/worker.config.json" "$target/worker.json" 'App Worker target'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
out="$work/.cloudflare/output/v0"
mkdir -p "$out/workers/default/bundle"
cp "$target/root.json" "$out/config.json"
cp "$target/worker.json" "$out/workers/default/worker.config.json"
cp "$src/v0/workers/default/bundle/index.mjs" "$out/workers/default/bundle/"
cp -R "$src/v0/workers/default/assets" "$out/workers/default/"
cd "$work"
export CLOUDFLARE_ACCOUNT_ID=15d29c8639fd3733b1b5486a2acfd968
"$release_dir/cf/node_modules/.bin/cf" deploy --prebuilt --mode v1
