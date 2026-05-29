#!/usr/bin/env bash
# Parallel stress test for `opencode run --model free`.
# Verifies the structural filter (provider==opencode, all costs==0) reaches
# the full live catalog of zero-cost models.
#
# Usage:
#   script/stress-free-models.sh [DURATION_SECONDS] [WORKERS]
#
# Defaults: 300s, 3 workers. Each worker loops, calling `run --model free "x"`,
# captures the resolved model from the build line, appends to a shared log.
# At the end, prints distribution + unique-model count.
#
# Requires: gtimeout (brew install coreutils).

set -euo pipefail

DURATION="${1:-300}"
WORKERS="${2:-3}"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BIN="$REPO_ROOT/packages/opencode/dist/opencode-darwin-arm64/bin/opencode"

if [ ! -x "$BIN" ]; then
  echo "ERROR: binary not found at $BIN" >&2
  echo "       run \`bun run build\` from $REPO_ROOT/packages/opencode first" >&2
  exit 1
fi
if ! command -v gtimeout >/dev/null 2>&1; then
  echo "ERROR: gtimeout not found. Install via: brew install coreutils" >&2
  exit 1
fi

WORKDIR="$(mktemp -d -t oc-stress-XXXXXX)"
LOG="$WORKDIR/stress.log"
: > "$LOG"
END=$(($(date +%s) + DURATION))

export END BIN LOG WORKDIR

worker() {
  local id=$1
  local dir="$WORKDIR/w$id"
  mkdir -p "$dir"
  cd "$dir"
  local n=0
  while [ "$(date +%s)" -lt "$END" ]; do
    raw=$(gtimeout 12 "$BIN" run --model free "x" 2>&1 | sed $'s,\x1b\\[[0-9;]*[a-zA-Z],,g')
    pick=$(echo "$raw" | grep -oE '> build · [a-z0-9.-]+' | sed 's/> build · //' | head -1)
    if [ -n "$pick" ]; then
      echo "$(date +%s) w$id #$n $pick" >> "$LOG"
    else
      echo "$(date +%s) w$id #$n MISS" >> "$LOG"
    fi
    n=$((n + 1))
  done
}

export -f worker

echo "stress test: ${DURATION}s × ${WORKERS} workers → $LOG"
for i in $(seq 1 "$WORKERS"); do
  worker "$i" &
done
wait

echo
echo "=== completed ==="
echo "total samples: $(wc -l < "$LOG" | tr -d ' ')"
echo "--- distribution ---"
awk '{print $NF}' "$LOG" | sort | uniq -c | sort -rn
echo "--- unique non-MISS models ---"
awk '{print $NF}' "$LOG" | grep -v MISS | sort -u
echo "--- unique count ---"
awk '{print $NF}' "$LOG" | grep -v MISS | sort -u | wc -l | tr -d ' '
echo "--- per-worker counts ---"
awk '{print $2}' "$LOG" | sort | uniq -c
echo
echo "raw log: $LOG"
