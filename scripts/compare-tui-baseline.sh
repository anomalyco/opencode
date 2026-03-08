#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"

usage() {
  echo "Usage: $0 [options] <error|final|stream|tool|warning|idle>"
  echo ""
  echo "Options:"
  echo "  --model NAME"
  echo "  --width COLS"
  echo "  --height ROWS"
  echo "  --use-real-auth"
  echo "  -h, --help"
  echo ""
  echo "Env: OPENCODE_UPSTREAM_DIR=/path OPENCODE_BENCH_EVIDENCE_DIR=/path"
  echo "Deprecated env: OPENCODE_SANDBOX_MODEL OPENCODE_SANDBOX_USE_REAL_AUTH OPENCODE_SANDBOX_WIDTH OPENCODE_SANDBOX_HEIGHT"
}

warn_env() {
  echo "Deprecated: $1 is set. Use $2 instead." >&2
}

state=""
model=""
pane_width=""
pane_height=""
use_real_auth=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --model)
      model="$2"
      shift 2
      ;;
    --model=*)
      model="${1#*=}"
      shift
      ;;
    --width)
      pane_width="$2"
      shift 2
      ;;
    --width=*)
      pane_width="${1#*=}"
      shift
      ;;
    --height)
      pane_height="$2"
      shift 2
      ;;
    --height=*)
      pane_height="${1#*=}"
      shift
      ;;
    --use-real-auth)
      use_real_auth="1"
      shift
      ;;
    --)
      shift
      break
      ;;
    -* )
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "$state" ]]; then
        echo "Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      state="$1"
      shift
      ;;
  esac
done

if [[ -z "$state" ]]; then
  usage
  exit 1
fi

strict_compare="${OPENCODE_COMPARE_STRICT:-1}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
upstream_dir="${OPENCODE_UPSTREAM_DIR:-/tmp/opencode-upstream}"
evidence_root="${OPENCODE_BENCH_EVIDENCE_DIR:-/tmp/opencode-sandbox-evidence}"
fork_evidence="$evidence_root/fork"
upstream_evidence="$evidence_root/upstream"

if [[ -z "$use_real_auth" && -n "${OPENCODE_SANDBOX_USE_REAL_AUTH:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_USE_REAL_AUTH" "--use-real-auth"
  use_real_auth="1"
fi
if [[ -z "$use_real_auth" && -f "$HOME/.local/share/opencode/auth.json" ]]; then
  use_real_auth="1"
fi
if [[ -z "$model" && -n "${OPENCODE_SANDBOX_MODEL:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_MODEL" "--model"
  model="$OPENCODE_SANDBOX_MODEL"
fi
if [[ -z "$pane_width" && -n "${OPENCODE_SANDBOX_WIDTH:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_WIDTH" "--width"
  pane_width="$OPENCODE_SANDBOX_WIDTH"
fi
if [[ -z "$pane_height" && -n "${OPENCODE_SANDBOX_HEIGHT:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_HEIGHT" "--height"
  pane_height="$OPENCODE_SANDBOX_HEIGHT"
fi

mkdir -p "$fork_evidence" "$upstream_evidence"

origin_head="$(git -C "$repo_root" symbolic-ref --quiet --short refs/remotes/origin/HEAD || true)"
origin_branch="${origin_head#origin/}"
if [[ -z "$origin_branch" ]]; then
  origin_branch="dev"
fi

if [[ ! -e "$upstream_dir/.git" ]]; then
  git -C "$repo_root" fetch origin
  git -C "$repo_root" worktree add "$upstream_dir" "origin/$origin_branch"
fi

if [[ ! -d "$upstream_dir/node_modules" ]]; then
  (cd "$upstream_dir" && bun install)
fi

fork_status=0
upstream_status=0

fork_args=(
  --repo-root "$repo_root"
  --evidence-dir "$fork_evidence"
  --opencode-dir "$repo_root/packages/opencode"
)
if [[ -n "$model" ]]; then
  fork_args+=(--model "$model")
fi
if [[ -n "$pane_width" ]]; then
  fork_args+=(--width "$pane_width")
fi
if [[ -n "$pane_height" ]]; then
  fork_args+=(--height "$pane_height")
fi
if [[ "$use_real_auth" == "1" ]]; then
  fork_args+=(--use-real-auth)
fi
echo "Running fork harness (evidence: $fork_evidence)"
if ! "$repo_root/scripts/run-sandbox-tui.sh" "${fork_args[@]}" "$state"; then
  fork_status=$?
fi

upstream_args=(
  --repo-root "$repo_root"
  --evidence-dir "$upstream_evidence"
  --opencode-dir "$upstream_dir/packages/opencode"
)
if [[ -n "$model" ]]; then
  upstream_args+=(--model "$model")
fi
if [[ -n "$pane_width" ]]; then
  upstream_args+=(--width "$pane_width")
fi
if [[ -n "$pane_height" ]]; then
  upstream_args+=(--height "$pane_height")
fi
if [[ "$use_real_auth" == "1" ]]; then
  upstream_args+=(--use-real-auth)
fi
echo "Running upstream harness (evidence: $upstream_evidence)"
if ! "$repo_root/scripts/run-sandbox-tui.sh" "${upstream_args[@]}" "$state"; then
  upstream_status=$?
fi

if [[ $fork_status -ne 0 ]]; then
  echo "Fork harness failed (status $fork_status)"
fi
if [[ $upstream_status -ne 0 ]]; then
  echo "Upstream harness failed (status $upstream_status)"
fi

if [[ "$state" == "idle" ]]; then
  diff -u "$fork_evidence/task-2-idle-a.txt" "$upstream_evidence/task-2-idle-a.txt" || true
  diff -u "$fork_evidence/task-2-idle-b.txt" "$upstream_evidence/task-2-idle-b.txt" || true
else
  diff -u "$fork_evidence/task-2-${state}.txt" "$upstream_evidence/task-2-${state}.txt" || true
fi

normalize_file() {
  local src="$1"
  local dst="$2"
  perl -ne 'print unless /Model .* is not valid/' "$src" \
    | perl -pe 's#Ask anything\.\.\. "[^"]*"#Ask anything... "<placeholder>"#g' \
    | perl -pe 's#^.*packages/opencode:[^\x1b ]+.*$#<repo-line>#g' \
    | perl -pe 's#^.*Ask anything\.\.\..*$#<ask-line>#g' \
    | perl -pe 's#^.*Build .*#<build-line>#g' \
    | perl -ne 'print if /<ask-line>|<build-line>|╹|▀/' \
    > "$dst"
}

compare_normalized() {
  local left="$1"
  local right="$2"
  local label="$3"
  local left_norm="$evidence_root/.normalized-${label}-fork.txt"
  local right_norm="$evidence_root/.normalized-${label}-upstream.txt"
  normalize_file "$left" "$left_norm"
  normalize_file "$right" "$right_norm"
  if ! diff -u "$left_norm" "$right_norm"; then
    echo "Normalized drift detected for $label"
    return 1
  fi
  echo "Normalized parity OK for $label"
  return 0
}

if [[ "$strict_compare" == "1" ]]; then
  strict_status=0
  if [[ "$state" == "idle" ]]; then
    compare_normalized "$fork_evidence/task-2-idle-a.txt" "$upstream_evidence/task-2-idle-a.txt" "idle-a" || strict_status=1
    compare_normalized "$fork_evidence/task-2-idle-b.txt" "$upstream_evidence/task-2-idle-b.txt" "idle-b" || strict_status=1
  else
    compare_normalized "$fork_evidence/task-2-${state}.txt" "$upstream_evidence/task-2-${state}.txt" "$state" || strict_status=1
  fi
  if [[ "$strict_status" -ne 0 ]]; then
    exit 1
  fi
fi
