#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"

state="${1:-}"
if [[ -z "$state" ]]; then
  echo "Usage: $0 <error|final|stream|tool|warning|idle>"
  echo "Env: OPENCODE_UPSTREAM_DIR=/path OPENCODE_BENCH_EVIDENCE_DIR=/path"
  exit 1
fi

strict_compare="${OPENCODE_COMPARE_STRICT:-1}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
upstream_dir="${OPENCODE_UPSTREAM_DIR:-/tmp/opencode-upstream}"
evidence_root="${OPENCODE_BENCH_EVIDENCE_DIR:-/tmp/opencode-sandbox-evidence}"
fork_evidence="$evidence_root/fork"
upstream_evidence="$evidence_root/upstream"

if [[ -z "${OPENCODE_SANDBOX_USE_REAL_AUTH:-}" && -f "$HOME/.local/share/opencode/auth.json" ]]; then
  export OPENCODE_SANDBOX_USE_REAL_AUTH=1
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

echo "Running fork harness (evidence: $fork_evidence)"
if ! OPENCODE_SANDBOX_REPO_ROOT="$repo_root" OPENCODE_SANDBOX_EVIDENCE_DIR="$fork_evidence" \
  OPENCODE_SANDBOX_OPENCODE_DIR="$repo_root/packages/opencode" \
  OPENCODE_SANDBOX_MODEL="${OPENCODE_SANDBOX_MODEL:-}" \
  bash "$repo_root/.sisyphus/evidence/run-sandbox-tui.sh" "$state"; then
  fork_status=$?
fi

echo "Running upstream harness (evidence: $upstream_evidence)"
if ! OPENCODE_SANDBOX_REPO_ROOT="$repo_root" OPENCODE_SANDBOX_EVIDENCE_DIR="$upstream_evidence" \
  OPENCODE_SANDBOX_OPENCODE_DIR="$upstream_dir/packages/opencode" \
  OPENCODE_SANDBOX_MODEL="${OPENCODE_SANDBOX_MODEL:-}" \
  bash "$repo_root/.sisyphus/evidence/run-sandbox-tui.sh" "$state"; then
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
