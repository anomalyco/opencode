#!/usr/bin/env bash
# Canonical CLI flow for SimplicioCode.
# REQUIREMENT (R7): every CLI invocation runs the same pipeline:
#   1. map   — `simplicio-mapper` refreshes .specs/, .agents/, docs/*-map.md
#   2. task  — `simplicio task` runs the 6-layer code-generation contract with Simplicio1
#   3. sprint (optional) — `sendsprint run <source> <sprint>` for sprint delivery
#
# Real CLI surfaces (verified 2026-05-28):
#   - llm-project-mapper has NO subcommand: `npx ...llm-project-mapper --yes`
#   - sendsprint: `sendsprint run <source> <sprint> [--scope mine]`
#   - simplicio:  `simplicio task "<description>"`
#
# Usage:
#   script/simplicio/flow.sh "<task description>"
#   script/simplicio/flow.sh --sprint github <milestone>
#   script/simplicio/flow.sh --map-only

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
cd "$REPO_ROOT"

# Ensure pip-user bins are on PATH (simplicio-cli, sendsprint install to ~/.local/bin)
export PATH="$HOME/.local/bin:$PATH"

log() { printf '\033[1;36m[flow]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[flow]\033[0m %s\n' "$*" >&2; exit 1; }

MODE="task"
SPRINT_SOURCE=""
SPRINT_ID=""
TASK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --map-only) MODE="map"; shift ;;
    --sprint)
      MODE="sprint"
      SPRINT_SOURCE="${2:-}"
      SPRINT_ID="${3:-}"
      shift 3 || true ;;
    -h|--help)
      sed -n '1,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) TASK="$*"; break ;;
  esac
done

# --- Step 1: map (mandatory before programming) -----------------------------
log "step 1/3 — mapping project via simplicio-mapper"
if command -v npx >/dev/null 2>&1; then
  # Mapper has no subcommand — the bare invocation is the map.
  # --no-update-check avoids registry round-trips on every call.
  npx -y @wesleysimplicio/llm-project-mapper@latest \
    --yes --no-update-check --cli skip --append-gitignore no --skip-meta
else
  die "npx not found — install Node.js"
fi
[[ "$MODE" == "map" ]] && { log "map-only mode; stopping"; exit 0; }

# --- Step 2 (sprint mode): drive the sprint via sendsprint ------------------
if [[ "$MODE" == "sprint" ]]; then
  [[ -n "$SPRINT_SOURCE" && -n "$SPRINT_ID" ]] || \
    die "usage: flow.sh --sprint <jira|azuredevops|github> <sprint-id>"
  command -v sendsprint >/dev/null 2>&1 || \
    die "sendsprint not installed — run script/simplicio/install-tools.sh"
  log "step 2/3 — delivering sprint $SPRINT_SOURCE:$SPRINT_ID"
  sendsprint run "$SPRINT_SOURCE" "$SPRINT_ID" --repo "$REPO_ROOT"
  exit 0
fi

# --- Step 3: run simplicio task with Simplicio1 (Qwen 2.5 Coder 3B) ---------
log "step 3/3 — running simplicio task with Simplicio1 (Qwen 2.5 Coder 3B)"
command -v simplicio >/dev/null 2>&1 || \
  die "simplicio CLI not installed — run script/simplicio/install-tools.sh"

export SIMPLICIO_MODEL="${SIMPLICIO_MODEL:-ollama/qwen2.5-coder:3b}"
export SIMPLICIO_BASE_URL="${SIMPLICIO_BASE_URL:-http://localhost:11434/v1}"

[[ -n "$TASK" ]] || die "missing task description"
simplicio task "$TASK"
