#!/usr/bin/env bash
# deploy-files.sh <dev|production> <dir>: deploys the files Worker from a
# verified bundle artifact (index.js built by `wrangler deploy --dry-run`)
# with the wrangler CLI pinned in wrangler/package-lock.json.
#
# The build job has no secrets, so the bundle is untrusted by design: its code
# can change freely. The rest of the Worker does not come from the artifact at
# all: the name, route, R2 bucket, and STAGE var are the complete pinned
# wrangler.json in targets/files/<mode>/, which is what wrangler reads. The
# token can write every Worker on the account, so nothing in the artifact can
# name another destination.
. "$(dirname "$0")/lib.sh"

mode=$1
src=$(cd "$2" && pwd)
release=$(cd "$(dirname "$0")" && pwd)

case "$mode" in
  dev | production) ;;
  *) die "Unknown files mode: $mode" ;;
esac
target="$release/targets/files/$mode/wrangler.json"
[ -f "$target" ] || die "No pinned files target for $mode"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
# Pinned in targets/ and in the token issuer's config (anomalyco/secrets).
CLOUDFLARE_ACCOUNT_ID=$(stage_account "$mode")
export CLOUDFLARE_ACCOUNT_ID

unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS ! -path ./index.js)
[ -z "$unexpected" ] || die "Unexpected files in the files artifact: $unexpected"
[ -f "$src/index.js" ] || die "The files artifact has no index.js"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$src/index.js" "$work/index.js"
cp "$target" "$work/wrangler.json"

wrangler="$release/wrangler/node_modules/.bin/wrangler"
[ -x "$wrangler" ] || die "Install the pinned wrangler CLI first: npm ci --ignore-scripts in .github/release/wrangler"

cd "$work"
"$wrangler" deploy --config wrangler.json --no-bundle
