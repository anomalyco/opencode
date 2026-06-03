#!/bin/bash

# Parallelism Probe
# Detects common parallelism blockers in the target project.
# Output is advisory -- the skill presents results to the user for approval.
#
# Usage: parallel-probe.sh <project_directory> [measurement_command] [measurement_workdir] [shared_file ...]
#
# Arguments:
#   project_directory   - Root directory of the project to probe
#   measurement_command - The measurement command from the spec (optional, for port detection)
#   measurement_workdir - Measurement working directory relative to project root (default: .)
#   shared_file         - Explicitly declared shared files that parallel runs depend on
#
# Output:
#   JSON to stdout with:
#     mode: "parallel" | "serial" | "user-decision"
#     blockers: [ { type, description, suggestion } ]

set -euo pipefail

PROJECT_DIR="${1:?Error: project_directory argument required}"
MEASUREMENT_CMD="${2:-}"
MEASUREMENT_WORKDIR="${3:-.}"

shift 3 2>/dev/null || shift $# 2>/dev/null || true
SHARED_FILES=()
if [[ $# -gt 0 ]]; then
  SHARED_FILES=("$@")
fi

cd "$PROJECT_DIR" || {
  echo '{"mode":"serial","blockers":[{"type":"error","description":"Cannot access project directory","suggestion":"Check path"}]}'
  exit 0
}

if ! command -v python3 >/dev/null 2>&1; then
  echo '{"mode":"serial","blockers":[{"type":"missing_dependency","description":"python3 is required for structured probe output","suggestion":"Install python3 or skip the probe and review parallel-readiness manually"}],"blocker_count":1}'
  exit 0
fi

BLOCKERS="[]"
SCAN_PATHS=()

add_blocker() {
  local type="$1"
  local desc="$2"
  local suggestion="$3"
  BLOCKERS=$(echo "$BLOCKERS" | python3 -c "
import json, sys
b = json.load(sys.stdin)
b.append({'type': '$type', 'description': '''$desc''', 'suggestion': '''$suggestion'''})
print(json.dumps(b))
" 2>/dev/null || echo "$BLOCKERS")
}

add_scan_path() {
  local candidate="$1"

  if [[ -z "$candidate" ]]; then
    return
  fi

  if [[ -e "$candidate" ]]; then
    SCAN_PATHS+=("$candidate")
  fi
}

add_scan_path "$MEASUREMENT_WORKDIR"

if [[ ${#SHARED_FILES[@]} -gt 0 ]]; then
  for shared_file in "${SHARED_FILES[@]}"; do
    add_scan_path "$shared_file"
  done
fi

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  SCAN_PATHS=(".")
fi

# Check 1: Hardcoded ports in measurement command
if [[ -n "$MEASUREMENT_CMD" ]]; then
  # Look for common port patterns in the command itself
  if echo "$MEASUREMENT_CMD" | grep -qE '(--port(?:\s+|=)[0-9]+|:\s*[0-9]{4,5}|PORT=[0-9]+|localhost:[0-9]+)'; then
    add_blocker "port" "Measurement command contains hardcoded port reference" "Parameterize port via environment variable (e.g., PORT=\$EVAL_PORT)"
  fi
fi

# Check 2: SQLite databases in the measurement workdir or declared shared files
SQLITE_FILES=$(find "${SCAN_PATHS[@]}" -maxdepth 4 -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) ! -path '*/.git/*' ! -path '*/node_modules/*' ! -path '*/.claude/*' ! -path '*/.context/*' ! -path '*/.worktrees/*' 2>/dev/null | head -10 || true)
if [[ -n "$SQLITE_FILES" ]]; then
  FILE_COUNT=$(echo "$SQLITE_FILES" | wc -l | tr -d ' ')
  add_blocker "shared_file" "Found $FILE_COUNT SQLite database file(s)" "Copy database files into each experiment worktree"
fi

# Check 3: Lock/PID files in the measurement workdir or declared shared files
LOCK_FILES=$(find "${SCAN_PATHS[@]}" -maxdepth 4 -type f \( -name '*.lock' -o -name '*.pid' \) ! -path '*/.git/*' ! -path '*/node_modules/*' ! -path '*/.claude/*' ! -path '*/.context/*' ! -path '*/.worktrees/*' ! -name 'package-lock.json' ! -name 'yarn.lock' ! -name 'bun.lock' ! -name 'bun.lockb' ! -name 'Gemfile.lock' ! -name 'poetry.lock' ! -name 'Cargo.lock' 2>/dev/null | head -10 || true)
if [[ -n "$LOCK_FILES" ]]; then
  FILE_COUNT=$(echo "$LOCK_FILES" | wc -l | tr -d ' ')
  add_blocker "lock_file" "Found $FILE_COUNT lock/PID file(s) that may cause contention" "Ensure measurement command cleans up lock files, or run in serial mode"
fi

# Check 4: Exclusive resource hints in the measurement command
if [[ -n "$MEASUREMENT_CMD" ]] && echo "$MEASUREMENT_CMD" | grep -qiE '(cuda|gpu|tensorflow|torch|nvidia-smi|CUDA_VISIBLE_DEVICES)'; then
  add_blocker "exclusive_resource" "Measurement command appears to use GPU or another exclusive accelerator" "GPU is typically an exclusive resource -- consider serial mode or device parameterization"
fi

# Determine mode
BLOCKER_COUNT=$(echo "$BLOCKERS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [[ "$BLOCKER_COUNT" == "0" ]]; then
  MODE="parallel"
elif echo "$BLOCKERS" | python3 -c "import json,sys; b=json.load(sys.stdin); exit(0 if any(x['type']=='exclusive_resource' for x in b) else 1)" 2>/dev/null; then
  MODE="serial"
else
  MODE="user-decision"
fi

# Output JSON result
python3 -c "
import json
print(json.dumps({
    'mode': '$MODE',
    'blockers': $BLOCKERS,
    'blocker_count': $BLOCKER_COUNT
}, indent=2))
"
