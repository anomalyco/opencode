#!/usr/bin/env bash
# deploy-site.sh <dev|production> <dir>: deploys the site Worker from a verified
# Build Output artifact (services/site/.cloudflare/output) with the cf CLI
# pinned in cf/package-lock.json, which the workflow installs before the token
# is in reach.
#
# The build job has no secrets, so the Worker's code and assets are untrusted
# by design: the site can change freely. Its config may not. The artifact's
# root config and Worker config must equal targets/site/<mode>/*.json exactly,
# and those pinned copies are what cf reads: another Worker name, route,
# domain, or binding is refused before the token is used.
. "$(dirname "$0")/lib.sh"

mode=$1
src=$(cd "$2" && pwd)
release=$(cd "$(dirname "$0")" && pwd)

case "$mode" in
  dev | production) ;;
  *) die "Unknown site mode: $mode" ;;
esac
target="$release/targets/site/$mode"
[ -f "$target/root.json" ] && [ -f "$target/worker.json" ] || die "No pinned site targets for $mode"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
# Pinned in targets/ and in the token issuer's config (anomalyco/secrets).
CLOUDFLARE_ACCOUNT_ID=$(stage_account "$mode")
export CLOUDFLARE_ACCOUNT_ID

unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS \
  ! -path ./v0/config.json \
  ! -path ./v0/workers/default/worker.config.json \
  ! -path './v0/workers/default/bundle/*' \
  ! -path './v0/workers/default/assets/*')
[ -z "$unexpected" ] || die "Unexpected files in the site artifact: $unexpected"
[ -f "$src/v0/workers/default/bundle/index.mjs" ] || die "The site artifact has no bundle/index.mjs"
[ -d "$src/v0/workers/default/assets" ] || die "The site artifact has no assets directory"

expect_json "$src/v0/config.json" "$target/root.json" "The site's root config"
expect_json "$src/v0/workers/default/worker.config.json" "$target/worker.json" "The site's Worker config"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
output="$work/.cloudflare/output/v0"
mkdir -p "$output/workers/default"
cp "$target/root.json" "$output/config.json"
cp "$target/worker.json" "$output/workers/default/worker.config.json"
cp -R "$src/v0/workers/default/bundle" "$output/workers/default/bundle"
cp -R "$src/v0/workers/default/assets" "$output/workers/default/assets"

cf="$release/cf/node_modules/.bin/cf"
[ -x "$cf" ] || die "Install the pinned cf CLI first: npm ci --ignore-scripts in .github/release/cf"

cd "$work"
"$cf" deploy --prebuilt --mode "$mode"
