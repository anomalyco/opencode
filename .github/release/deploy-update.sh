#!/usr/bin/env bash
# deploy-update.sh <production> <dir>: deploys the update Worker from a verified
# bundle artifact (index.js built by `wrangler deploy --dry-run`) with the
# wrangler CLI pinned in wrangler/package-lock.json.
#
# The build job has no secrets, so the bundle is untrusted by design: its code
# can change freely. The rest of the Worker does not come from the artifact at
# all: the name, routes, custom domain, D1 database, and Pipelines stream are
# the complete pinned wrangler.json in targets/update/production/, which is what
# wrangler reads. Only production deploys this Worker.
. "$(dirname "$0")/lib.sh"

mode=$1
src=$(cd "$2" && pwd)
release=$(cd "$(dirname "$0")" && pwd)

[ "$mode" = production ] || die "The update Worker deploys only to production, not $mode"
target="$release/targets/update/production/wrangler.json"
[ -f "$target" ] || die "No pinned update target"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
# Pinned in targets/ and in the token issuer's config (anomalyco/secrets).
export CLOUDFLARE_ACCOUNT_ID=15d29c8639fd3733b1b5486a2acfd968

unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS ! -path ./index.js)
[ -z "$unexpected" ] || die "Unexpected files in the update artifact: $unexpected"
[ -f "$src/index.js" ] || die "The update artifact has no index.js"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$src/index.js" "$work/index.js"
cp "$target" "$work/wrangler.json"

wrangler="$release/wrangler/node_modules/.bin/wrangler"
[ -x "$wrangler" ] || die "Install the pinned wrangler CLI first: npm ci --ignore-scripts in .github/release/wrangler"

cd "$work"
"$wrangler" deploy --config wrangler.json --no-bundle
