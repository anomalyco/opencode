#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${OPENCODE_VERSION:-}" ]]; then
  BASE="$(node -p "require('./packages/opencode/package.json').version")"
  SHA="$(git rev-parse --short HEAD)"
  export OPENCODE_VERSION="${BASE}-acp32388.${SHA}"
fi

export OPENCODE_CHANNEL="${OPENCODE_CHANNEL:-fix-acp-subagent}"

echo "Packaging OpenCode fork release ${OPENCODE_VERSION} (channel=${OPENCODE_CHANNEL})"

bun ./packages/opencode/script/build.ts
bun ./packages/cli/script/build.ts

OC_DIST="$ROOT/packages/opencode/dist"
CLI_DIST="$ROOT/packages/cli/dist"

package_dir() {
  local dir="$1"
  local name
  name="$(basename "$dir")"
  if [[ "$name" == *linux* ]]; then
    tar -czf "${dir%/*}/${name}.tar.gz" -C "$dir/bin" .
  else
    (cd "$dir/bin" && zip -qr "${dir%/*}/${name}.zip" .)
  fi
}

for dir in "$OC_DIST"/opencode-*/; do
  [[ -d "$dir/bin" ]] || continue
  package_dir "$dir"
done

for dir in "$CLI_DIST"/cli-*/; do
  [[ -d "$dir/bin" ]] || continue
  package_dir "$dir"
done

echo "version=${OPENCODE_VERSION}" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "Packaged archives:"
ls -lh "$OC_DIST"/*.{zip,tar.gz} 2>/dev/null || true
ls -lh "$CLI_DIST"/*.{zip,tar.gz} 2>/dev/null || true
