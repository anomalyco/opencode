#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ok=1

echo "== OpenCode issue verification =="
echo "root: $root"
echo

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found in PATH"
  echo "install bun, then re-run: ./script/verify-issues.sh"
  exit 1
fi

run() {
  local dir="$1"
  local cmd="$2"
  echo "-> $dir :: $cmd"
  if (cd "$dir" && eval "$cmd"); then
    echo "ok"
  else
    ok=0
    echo "fail"
  fi
  echo
}

run "$root/packages/opencode" "bun test test/cli/import.test.ts test/tool/apply_patch.test.ts"
run "$root/packages/app" "bun test src/context/file/watcher.test.ts"

echo "== Manual checks =="
echo
echo "#15797 import project assignment"
echo "1. cd into a git-backed repo directory."
echo "2. run: opencode import session.json"
echo "3. open opencode in same dir."
echo "expect: imported session appears in that project (not global)."
echo
echo "#15996 file view auto-refresh"
echo "1. open a file tab in web/desktop."
echo "2. ask AI to edit same file."
echo "expect: tab content refreshes without reopen."
echo
echo "#15897 apply_patch shows formatter changes"
echo "1. create repro.py with single quotes."
echo "2. do apply_patch docstring edit."
echo "expect: returned diff includes formatter side-change (ex: single->double quote)."
echo
echo "#14964 long permission actions visible"
echo "1. trigger long bash permission prompt in web/app."
echo "expect: deny/allow buttons stay visible and wrap, no overflow off-screen."
echo
echo "#14965 startup lag in Ghostty"
echo "1. set non-system theme."
echo "2. launch opencode in Ghostty and compare startup feel."
echo "3. switch to system theme."
echo "expect: system palette resolves only when using system theme."
echo
echo "#15961 skills docs alignment"
echo "open packages/web/src/content/docs/skills.mdx and confirm:"
echo "- skills.paths and skills.urls documented"
echo "- remote cache behavior + no TTL refresh documented"
echo "- permissive loader behavior documented"
echo "- <location>, base dir, sampled <skill_files> documented"
echo

if [[ "$ok" -eq 1 ]]; then
  echo "automated tests: pass"
  exit 0
fi

echo "automated tests: fail"
exit 2
