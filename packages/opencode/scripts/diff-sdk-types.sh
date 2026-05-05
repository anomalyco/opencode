#!/bin/bash
# Compare SDK types generated from Hono vs HttpApi specs.
# Sorts types alphabetically so only meaningful body differences show.
#
# Usage: ./scripts/diff-sdk-types.sh          # full diff
#        ./scripts/diff-sdk-types.sh --stat   # summary only
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$(cd "$DIR/../sdk/js" && pwd)"

normalize() {
  python3 -c "
import re, sys
content = open(sys.argv[1]).read()
blocks = re.split(r'(?=^export (?:type|function|const) )', content, flags=re.MULTILINE)
header, body = blocks[0], blocks[1:]
body.sort(key=lambda b: m.group(1) if (m := re.match(r'export \w+ (\w+)', b)) else '')
sys.stdout.write(header + ''.join(body))
" "$1"
}

echo "Generating Hono SDK..." >&2
(cd "$SDK" && bun run script/build.ts >/dev/null 2>&1)
normalize "$SDK/src/v2/gen/types.gen.ts" > /tmp/sdk-types-hono.ts
git -C "$SDK" checkout -- src/ 2>/dev/null

echo "Generating HttpApi SDK..." >&2
(cd "$SDK" && OPENCODE_SDK_OPENAPI=httpapi bun run script/build.ts >/dev/null 2>&1)
normalize "$SDK/src/v2/gen/types.gen.ts" > /tmp/sdk-types-httpapi.ts
git -C "$SDK" checkout -- src/ 2>/dev/null

echo "" >&2
if [[ "${1:-}" == "--stat" ]]; then
  diff_output=$(diff /tmp/sdk-types-hono.ts /tmp/sdk-types-httpapi.ts || true)
  honly=$(printf "%s\n" "$diff_output" | grep -c '^< export type' || true)
  aonly=$(printf "%s\n" "$diff_output" | grep -c '^> export type' || true)
  total=$(printf "%s\n" "$diff_output" | wc -l | tr -d ' ')
  echo "Hono-only: $honly types  HttpApi-only: $aonly types  Diff lines: $total"
  echo ""
  if [[ $honly -gt 0 ]]; then
    echo "=== Hono-only types ==="
    printf "%s\n" "$diff_output" | grep '^< export type' | sed 's/< export type //' | sed 's/[ =].*//' | sed 's/^/  /'
    echo ""
  fi
  if [[ $aonly -gt 0 ]]; then
    echo "=== HttpApi-only types ==="
    printf "%s\n" "$diff_output" | grep '^> export type' | sed 's/> export type //' | sed 's/[ =].*//' | sed 's/^/  /'
  fi
else
  diff /tmp/sdk-types-hono.ts /tmp/sdk-types-httpapi.ts || true
fi
