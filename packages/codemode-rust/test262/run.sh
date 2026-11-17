#!/usr/bin/env bash
# Runs the reference's pinned test262 file set through PsychoScript and checks it against test262/rust-skipped.txt.
# Usage: bash test262/run.sh [--write] [prefix]. Extra arguments go to the runner; see test262/src/main.rs.
#
# - Clones tc39/test262 at the reference manifest's revision into TEST262_CHECKOUT (default: a cache directory).
# - Runs the reference's own sync script into TEST262_FILES (default: target/test262), so the file set and its
#   filters are exactly the reference's.
# - The reference CodeMode package is ../codemode relative to this workspace; set CODEMODE_REF to override it.
# Needs git, bun and cargo.
set -euo pipefail
[ -n "${CODEMODE_REF:-}" ] && CODEMODE_REF=$(cd "$CODEMODE_REF" && pwd)
cd "$(dirname "$0")/.."
REF_PKG=${CODEMODE_REF:-../codemode}
MANIFEST=$REF_PKG/test/test262/manifest.json
[ -f "$MANIFEST" ] || { echo "reference test262 manifest not found at $MANIFEST" >&2; exit 1; }
REVISION=$(sed -nE 's/^ *"revision": *"([0-9a-f]+)".*/\1/p' "$MANIFEST")
CHECKOUT=${TEST262_CHECKOUT:-${XDG_CACHE_HOME:-$HOME/.cache}/test262-$REVISION}
FILES=${TEST262_FILES:-target/test262}

# A shallow, sparse checkout of the pinned revision: the sync reads only test/built-ins and test/language.
if [ "$(git -C "$CHECKOUT" rev-parse HEAD 2>/dev/null)" != "$REVISION" ]; then
  echo "fetching tc39/test262 at $REVISION into $CHECKOUT" >&2
  rm -rf "$CHECKOUT"
  git init -q "$CHECKOUT"
  git -C "$CHECKOUT" remote add origin https://github.com/tc39/test262.git
  git -C "$CHECKOUT" sparse-checkout set test/built-ins test/language
  git -C "$CHECKOUT" fetch -q --depth 1 --filter=blob:none origin "$REVISION"
  git -C "$CHECKOUT" checkout -q FETCH_HEAD
fi

# The sync script writes next to the manifest it reads, so give it a private copy of both.
SYNCED="$FILES/test/test262"
if [ "$(cat "$FILES/stamp" 2>/dev/null)" != "$REVISION $(cksum <"$MANIFEST") $(cksum <"$REF_PKG/script/sync-test262.ts")" ]; then
  echo "syncing the reference's file set into $FILES" >&2
  rm -rf "$FILES"
  mkdir -p "$FILES/script" "$SYNCED"
  cp "$REF_PKG/script/sync-test262.ts" "$FILES/script/"
  cp "$MANIFEST" "$SYNCED/"
  bun run "$FILES/script/sync-test262.ts" "$CHECKOUT" >&2
  echo "$REVISION $(cksum <"$MANIFEST") $(cksum <"$REF_PKG/script/sync-test262.ts")" >"$FILES/stamp"
fi

cargo build --release --locked -p psychoscript-test262 >&2
exec target/release/psychoscript-test262 \
  --root "$SYNCED" \
  --reference-skipped "$REF_PKG/test/test262/skipped.txt" \
  --skipped test262/rust-skipped.txt \
  "$@"
