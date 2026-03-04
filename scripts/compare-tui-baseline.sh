#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"

state="${1:-}"
if [[ -z "$state" ]]; then
  echo "Usage: $0 <error|final|stream|tool|warning|idle>"
  echo "Env: OPENCODE_UPSTREAM_DIR=/path OPENCODE_BENCH_EVIDENCE_DIR=/path"
  exit 1
fi

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
  origin_branch="main"
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
