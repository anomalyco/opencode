#!/usr/bin/env bash
# Sync the publishable package from the monorepo into the standalone repo,
# then publish from there. The standalone repo (github.com/omeryasirkucuk/
# context-rollover) is the npm publish home; the monorepo stays the dev home.
#
# Usage:
#   scripts/sync-package.sh          # sync only
#   scripts/sync-package.sh --publish  # sync + npm publish
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FORK_ROOT="$(cd "$PKG_ROOT/../.." && pwd)"
DST="${ROLLOVER_PUBLISH_REPO:-$FORK_ROOT/../context-rollover}"

if [[ ! -d "$DST/.git" ]]; then
  echo "standalone repo not found at $DST" >&2
  exit 1
fi

VERSION=$(python3 -c "import json;print(json.load(open('$PKG_ROOT/package.json'))['version'])")
echo "[sync] version: $VERSION"

rsync -a --delete "$PKG_ROOT/src/" "$DST/src/"
cp "$PKG_ROOT/gui-experimental.cjs" "$PKG_ROOT/README.md" "$PKG_ROOT/package.json" "$DST/"
mkdir -p "$DST/docs"
cp "$PKG_ROOT/docs/spec.md" "$DST/docs/spec.md"
cp "$PKG_ROOT/docs/rollover.png" "$DST/docs/rollover.png"
cp "$PKG_ROOT/docs/rollover-flow.png" "$DST/docs/rollover-flow.png"
cp "$FORK_ROOT/LICENSE" "$DST/LICENSE"

# The published package's repository link points at the standalone repo.
python3 - "$DST/package.json" <<'EOF'
import json, sys
path = sys.argv[1]
with open(path) as f: pkg = json.load(f)
pkg["repository"] = {"type": "git", "url": "git+https://github.com/omeryasirkucuk/context-rollover.git"}
with open(path, "w") as f: json.dump(pkg, f, indent=2); f.write("\n")
EOF

cd "$DST"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -q -m "chore: sync from monorepo (v$VERSION)"
  git push -q origin main
  echo "[sync] committed + pushed"
else
  echo "[sync] no changes"
fi

if [[ "${1:-}" == "--publish" ]]; then
  npm publish
fi
