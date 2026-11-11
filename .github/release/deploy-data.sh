#!/usr/bin/env bash
# deploy-data.sh <dev|production> <dir> <secrets.json>: deploys the data site's
# three Workers (og, sync, default) from one verified Build Output artifact
# (services/data/.cloudflare/output) with the cf CLI pinned in
# cf/package-lock.json. Order matches services/data/script/deploy.ts: the OG
# Worker first because the site binds to it, then sync, then the site.
#
# The build job has no secrets, so the Workers' code and assets are untrusted
# by design: the data site can change freely. The configs may not. All three
# must equal targets/data/<mode>/*.json exactly, and the pinned copies are what
# cf reads: another Worker name, route, cron, Workflow name, or binding
# (including the OG service binding) is refused before the token is used.
#
# The sync Worker's Workflow PUT needs account-wide Workers Scripts Write;
# Cloudflare has no per-Worker Workflows permission. That is safe only because
# this script (and the other deploy-*.sh) pin every target.
. "$(dirname "$0")/lib.sh"

mode=$1
src=$(cd "$2" && pwd)
secrets=$(posix "$3")
release=$(cd "$(dirname "$0")" && pwd)

case "$mode" in
  dev | production) ;;
  *) die "Unknown data mode: $mode" ;;
esac
target="$release/targets/data/$mode"
for file in root default og sync; do
  [ -f "$target/$file.json" ] || die "No pinned data target $target/$file.json"
done

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
# Pinned in targets/ and in the token issuer's config (anomalyco/secrets).
export CLOUDFLARE_ACCOUNT_ID=15d29c8639fd3733b1b5486a2acfd968

unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS \
  ! -path ./v0/config.json \
  ! -path ./v0/workers/default/worker.config.json \
  ! -path './v0/workers/default/bundle/*' \
  ! -path './v0/workers/default/assets/*' \
  ! -path ./v0/workers/og/worker.config.json \
  ! -path './v0/workers/og/bundle/*' \
  ! -path ./v0/workers/sync/worker.config.json \
  ! -path './v0/workers/sync/bundle/*')
[ -z "$unexpected" ] || die "Unexpected files in the data artifact: $unexpected"
for dir in default og sync; do
  [ -f "$src/v0/workers/$dir/bundle/index.mjs" ] || die "The data artifact has no $dir bundle/index.mjs"
done
[ -d "$src/v0/workers/default/assets" ] || die "The data artifact has no default assets directory"

expect_json "$src/v0/config.json" "$target/root.json" "The data root config"
expect_json "$src/v0/workers/default/worker.config.json" "$target/default.json" "The data site's Worker config"
expect_json "$src/v0/workers/og/worker.config.json" "$target/og.json" "The OG Worker's config"
expect_json "$src/v0/workers/sync/worker.config.json" "$target/sync.json" "The sync Worker's config"

jq -e 'keys == ["DATA_DATABASE_HOST", "DATA_DATABASE_PASSWORD", "DATA_DATABASE_USERNAME", "DATA_HIDDEN_MODELS", "R2_SQL_AUTH_TOKEN"]
  and all(.[]; type == "string" and length > 0)' "$secrets" > /dev/null ||
  die "The secrets file does not hold exactly the data Workers' secrets"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
output="$work/.cloudflare/output/v0"
mkdir -p "$output/workers/default" "$output/workers/og" "$output/workers/sync"
cp "$target/root.json" "$output/config.json"
for dir in default og sync; do
  cp "$target/$dir.json" "$output/workers/$dir/worker.config.json"
  cp -R "$src/v0/workers/$dir/bundle" "$output/workers/$dir/bundle"
done
cp -R "$src/v0/workers/default/assets" "$output/workers/default/assets"

# Each Worker gets only the secrets its pinned config declares (cf rejects a
# missing one). The files are 0600 in the runner's temp directory and removed
# with the work directory.
umask 077
jq '{DATA_DATABASE_HOST, DATA_DATABASE_USERNAME, DATA_DATABASE_PASSWORD}' "$secrets" > "$work/default-secrets.json"
cp "$secrets" "$work/sync-secrets.json"

cf="$release/cf/node_modules/.bin/cf"
[ -x "$cf" ] || die "Install the pinned cf CLI first: npm ci --ignore-scripts in .github/release/cf"

cd "$work"
"$cf" deploy --prebuilt --mode "$mode" --worker "$(jq -r .name "$target/og.json")"
"$cf" deploy --prebuilt --mode "$mode" --worker "$(jq -r .name "$target/sync.json")" --secrets-file "$work/sync-secrets.json"
"$cf" deploy --prebuilt --mode "$mode" --worker "$(jq -r .name "$target/default.json")" --secrets-file "$work/default-secrets.json"
