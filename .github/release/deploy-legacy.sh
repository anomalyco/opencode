#!/usr/bin/env bash
# deploy-legacy.sh <dev|production> <dir> <secrets.json>: deploys the legacy
# Worker from a verified Build Output artifact (services/legacy/.cloudflare/output)
# with the cf CLI pinned in cf/package-lock.json.
#
# The build job has no secrets, so the Worker's code is untrusted by design.
# Its config must equal targets/legacy/<mode>/*.json exactly, and the pinned
# copy is what cf reads: another Worker name, domain, or binding is refused
# before the token is used. The GitHub App secrets are read from AWS by the
# workflow into <secrets.json> and reach cf as a file, never argv.
. "$(dirname "$0")/lib.sh"

mode=$1
src=$(cd "$2" && pwd)
secrets=$(posix "$3")
release=$(cd "$(dirname "$0")" && pwd)

case "$mode" in
  dev | production) ;;
  *) die "Unknown legacy mode: $mode" ;;
esac
target="$release/targets/legacy/$mode"
[ -f "$target/root.json" ] && [ -f "$target/worker.json" ] || die "No pinned legacy targets for $mode"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
# Pinned in targets/ and in the token issuer's config (anomalyco/secrets).
export CLOUDFLARE_ACCOUNT_ID=15d29c8639fd3733b1b5486a2acfd968

unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS \
  ! -path ./v0/config.json \
  ! -path ./v0/workers/default/worker.config.json \
  ! -path './v0/workers/default/bundle/*')
[ -z "$unexpected" ] || die "Unexpected files in the legacy artifact: $unexpected"
[ -f "$src/v0/workers/default/bundle/index.js" ] || die "The legacy artifact has no bundle/index.js"

expect_json "$src/v0/config.json" "$target/root.json" "The legacy Worker's root config"
expect_json "$src/v0/workers/default/worker.config.json" "$target/worker.json" "The legacy Worker's config"

jq -e 'keys == ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"] and all(.[]; type == "string" and length > 0)' \
  "$secrets" > /dev/null || die "The secrets file does not hold exactly GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
output="$work/.cloudflare/output/v0"
mkdir -p "$output/workers/default"
cp "$target/root.json" "$output/config.json"
cp "$target/worker.json" "$output/workers/default/worker.config.json"
cp -R "$src/v0/workers/default/bundle" "$output/workers/default/bundle"

cf="$release/cf/node_modules/.bin/cf"
[ -x "$cf" ] || die "Install the pinned cf CLI first: npm ci --ignore-scripts in .github/release/cf"

cd "$work"
"$cf" deploy --prebuilt --mode "$mode" --secrets-file "$secrets"
