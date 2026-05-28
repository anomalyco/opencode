#!/usr/bin/env bash
# Daily update entry-point invoked by the cron (10:00 and 17:30 BRT).
# Delegates to install-tools.sh, then records the run.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
LOG="$REPO_ROOT/.simplicio/update.log"

mkdir -p "$(dirname "$LOG")"

{
  echo "===== $(date -u +'%Y-%m-%dT%H:%M:%SZ') ====="
  "$HERE/install-tools.sh"
  echo
} >>"$LOG" 2>&1

# Trim log to the last 2000 lines so it doesn't grow unbounded.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
