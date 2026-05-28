#!/usr/bin/env bash
# Canonical CLI flow for SimplicioCode.
# REQUIREMENT (R7): every CLI invocation runs the same pipeline:
#   1. map   — `simplicio-mapper` snapshots the repo into .simplicio/project-map.json
#   2. task  — `simplicio` runs the 6-layer code-generation contract with Simplicio1
#   3. sprint (optional) — `sendsprint run` when a sprint/issue ref is supplied
#
# Usage:
#   script/simplicio/flow.sh "<task description>"        # map + task
#   script/simplicio/flow.sh --sprint JIRA-123           # map + sprint pull + task
#   script/simplicio/flow.sh --map-only                  # just refresh the map

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\033[1;36m[flow]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[flow]\033[0m %s\n' "$*" >&2; exit 1; }

MODE="task"
SPRINT_REF=""
TASK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --map-only) MODE="map"; shift ;;
    --sprint)   MODE="sprint"; SPRINT_REF="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '1,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) TASK="$*"; break ;;
  esac
done

# --- Step 1: map (mandatory before programming) -----------------------------
log "step 1/3 — mapping project via simplicio-mapper"
if command -v npx >/dev/null 2>&1; then
  npx -y @wesleysimplicio/llm-project-mapper@latest map --yes
else
  die "npx not found — install Node.js"
fi
[[ "$MODE" == "map" ]] && { log "map-only mode; stopping"; exit 0; }

# --- Step 2 (sprint mode): pull sprint card before running task -------------
if [[ "$MODE" == "sprint" ]]; then
  [[ -n "$SPRINT_REF" ]] || die "missing sprint ref (e.g. JIRA-123 or gh#42)"
  log "step 2/3 — fetching sprint card $SPRINT_REF via sendsprint"
  if command -v sendsprint >/dev/null 2>&1; then
    sendsprint run --issue "$SPRINT_REF" --dry-run || die "sendsprint failed"
  else
    die "sendsprint not installed — run script/simplicio/install-tools.sh"
  fi
fi

# --- Step 3: run simplicio-cli task with Simplicio1 (Qwen 2.5 Coder 3B) -----
log "step 3/3 — running simplicio task with Simplicio1 (Qwen 2.5 Coder 3B)"
if ! command -v simplicio >/dev/null 2>&1; then
  die "simplicio CLI not installed — run script/simplicio/install-tools.sh"
fi

export SIMPLICIO_MODEL="${SIMPLICIO_MODEL:-ollama/qwen2.5-coder:3b}"
export SIMPLICIO_BASE_URL="${SIMPLICIO_BASE_URL:-http://localhost:11434/v1}"

[[ -n "$TASK" ]] || die "missing task description"
simplicio task "$TASK"
