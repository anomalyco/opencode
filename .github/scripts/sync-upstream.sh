#!/usr/bin/env bash
#
# Incremental upstream sync with remembered conflict resolutions.
#
# Pipeline per run:
#   1. Restore the persisted rerere cache (remembered hunk resolutions).
#   2. Fetch upstream and merge it into a sync branch in bounded batches.
#   3. For each batch's conflicts:
#        a. rerere auto-replays any resolution we've recorded before (zero touch).
#        b. resolve-conflicts.sh applies conflict-rules.conf (ours/theirs/escalate).
#        c. bun.lock is reconciled with `bun install` if it was touched.
#      Anything still unresolved -> escalate (stop, leave for a human).
#   4. Validate the merged result with a FULL-workspace typecheck (catches
#      semantic breaks that no textual rule can see).
#   5. Persist any newly-recorded rerere resolutions back to the store so the
#      next run remembers them.
#
# Default is a DRY RUN: it resolves, validates, and reports, but never pushes.
#
# Usage:
#   .github/scripts/sync-upstream.sh [options]
#     --push                 push the sync branch when everything is clean+green
#     --batch-size N         commits per merge batch (default: 70)
#     --max-batches N        stop after N batches (default: unlimited)
#     --upstream-ref REF     upstream ref to sync from (default: dev)
#     --target-commit SHA    merge only up to this upstream commit (testing)
#     --no-typecheck         skip the full-workspace typecheck (faster local loops)
#
set -euo pipefail

# ---- config / defaults -------------------------------------------------------
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/sst/opencode.git}"
UPSTREAM_REF="dev"
TARGET_BRANCH="${TARGET_BRANCH:-dev}"
SYNC_BRANCH="${SYNC_BRANCH:-sync/upstream}"
BATCH_SIZE=70
MAX_BATCHES=0            # 0 = unlimited
TARGET_COMMIT=""
DO_PUSH=0
DO_TYPECHECK=1
RR_STORE="${RR_STORE:-.sync/rr-cache}"   # persisted rerere memory (committed/shared)
RESOLVE_SCRIPT="$(dirname "$0")/resolve-conflicts.sh"
SUMMARY_FILE="${SUMMARY_FILE:-/tmp/sync-upstream-summary.md}"

while [ $# -gt 0 ]; do
  case "$1" in
    --push) DO_PUSH=1 ;;
    --batch-size) BATCH_SIZE="$2"; shift ;;
    --max-batches) MAX_BATCHES="$2"; shift ;;
    --upstream-ref) UPSTREAM_REF="$2"; shift ;;
    --target-commit) TARGET_COMMIT="$2"; shift ;;
    --no-typecheck) DO_TYPECHECK=0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

log() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }

# ---- preflight ---------------------------------------------------------------
log "Preflight"
# Only block on uncommitted changes to TRACKED files; untracked files (e.g. the
# script itself, the rr-cache store) don't interfere with a merge.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes to tracked files. Commit or stash first." >&2
  exit 1
fi
git config rerere.enabled true
git config rerere.autoupdate true
info "rerere enabled (autoupdate on)"

# ---- restore remembered resolutions -----------------------------------------
log "Restore rerere memory"
mkdir -p .git/rr-cache
if [ -d "$RR_STORE" ] && [ -n "$(ls -A "$RR_STORE" 2>/dev/null || true)" ]; then
  cp -r "$RR_STORE"/. .git/rr-cache/
  info "restored $(find "$RR_STORE" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ') recorded resolution(s) from $RR_STORE"
else
  info "no persisted resolutions yet ($RR_STORE empty/absent)"
fi

# ---- fetch upstream ----------------------------------------------------------
log "Fetch upstream"
git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_REPO" 2>/dev/null || \
  git remote set-url "$UPSTREAM_REMOTE" "$UPSTREAM_REPO"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_REF" --quiet
UPSTREAM_TIP="$(git rev-parse "${UPSTREAM_REMOTE}/${UPSTREAM_REF}")"
[ -n "$TARGET_COMMIT" ] && UPSTREAM_TIP="$(git rev-parse "$TARGET_COMMIT")"
info "syncing toward ${UPSTREAM_TIP:0:9}"

# ---- create / reset the sync branch from the target branch -------------------
log "Prepare sync branch"
git checkout -B "$SYNC_BRANCH" "$TARGET_BRANCH" --quiet
PENDING="$(git rev-list --count "${SYNC_BRANCH}..${UPSTREAM_TIP}")"
info "$PENDING upstream commit(s) to merge (batch size $BATCH_SIZE)"
if [ "$PENDING" -eq 0 ]; then
  echo "Already up to date."
  [ -n "${SYNC_GITHUB_OUTPUT:-}" ] && printf 'result=uptodate\nsafe_to_push=no\nneeds_review=no\n' >> "$SYNC_GITHUB_OUTPUT"
  exit 0
fi

# ---- batched merge loop ------------------------------------------------------
ALL_RESOLVED=()
ALL_ESCALATED=()
NEEDS_REVIEW=0
batch=0
while true; do
  remaining="$(git rev-list --count "HEAD..${UPSTREAM_TIP}")"
  [ "$remaining" -eq 0 ] && break
  batch=$((batch + 1))
  needs_review_batch=0
  if [ "$MAX_BATCHES" -ne 0 ] && [ "$batch" -gt "$MAX_BATCHES" ]; then
    info "reached --max-batches $MAX_BATCHES; stopping early"
    break
  fi

  # pick the batch target: BATCH_SIZE commits ahead on the first-parent path,
  # or the tip if fewer remain.
  if [ "$remaining" -le "$BATCH_SIZE" ]; then
    target="$UPSTREAM_TIP"
  else
    target="$(git rev-list --reverse --first-parent "HEAD..${UPSTREAM_TIP}" | sed -n "${BATCH_SIZE}p")"
  fi
  log "Batch $batch -> ${target:0:9}  ($(git log -1 --format='%s' "$target"))"

  set +e
  git merge --no-edit "$target"
  merge_rc=$?
  set -e

  if [ "$merge_rc" -ne 0 ]; then
    # rerere (autoupdate) has already staged any remembered resolutions.
    # Hand whatever remains to the rule engine.
    if git diff --name-only --diff-filter=U | grep -q .; then
      info "unresolved after rerere; applying conflict-rules.conf"
      RESOLVE_OUT="/tmp/resolve-out-$batch"
      GITHUB_OUTPUT="$RESOLVE_OUT" SUMMARY_FILE="/tmp/resolve-summary-$batch.md" \
        bash "$RESOLVE_SCRIPT" || true
      # shellcheck disable=SC1090
      can_complete="$(grep '^can_complete_merge=' "$RESOLVE_OUT" | tail -1 | cut -d= -f2)"
      esc="$(grep '^escalated_files=' "$RESOLVE_OUT" | tail -1 | cut -d= -f2-)"
      if [ "$can_complete" != "true" ]; then
        # Don't abort. Keep all the auto-resolved + rerere-replayed work and
        # commit the partial merge with conflict markers left ONLY in the
        # escalated files, so the branch is pushable and a review PR shows a
        # human exactly what to finish. Stop merging further batches after this.
        [ -n "$esc" ] && ALL_ESCALATED+=("$esc")
        NEEDS_REVIEW=1
        needs_review_batch=1
        log "ESCALATION — keeping partial merge for review (markers remain in escalated files)"
        info "escalated: $esc"
        git add -u   # stage escalated files as-is (with their conflict markers)
      fi
    fi
  fi

  # NOTE: bun.lock is reconciled ONCE after the whole batch loop (below), not
  # per-batch. A per-batch check is unreliable because when bun.lock resolves to
  # "ours" the staged blob equals HEAD and looks unchanged, even though upstream
  # bumped package.json and the lockfile really does need regenerating.

  # safety: OUTSIDE an escalation, markers must never survive (guards against a
  # stale rerere replay leaving a half-resolved file). Exclude .sync/rr-cache:
  # rerere *preimage* files legitimately contain conflict markers (that's what a
  # recorded conflict IS), so scanning them would always false-positive.
  if [ "$needs_review_batch" -eq 0 ] && \
     git grep -lE "^(<<<<<<<|=======|>>>>>>>)" -- . ':!bun.lock' ':!.sync/rr-cache' >/dev/null 2>&1; then
    echo "Conflict markers present but no escalation recorded — aborting for safety." >&2
    git merge --abort 2>/dev/null || true
    exit 4
  fi

  # complete the batch merge (rerere records any new resolutions on commit)
  if ! git diff --cached --quiet || [ -f .git/MERGE_HEAD ]; then
    git commit --no-edit --no-verify
  fi
  info "batch $batch committed: $(git rev-parse --short HEAD)"

  if [ "$needs_review_batch" -eq 1 ]; then
    info "review required — halting the batch loop here"
    break
  fi
done

# ---- reconcile the lockfile once against the final merged manifests ----------
log "Reconcile lockfile"
bun install >/dev/null 2>&1 || true
if ! git diff --quiet -- bun.lock; then
  git add bun.lock
  git commit --no-verify -m "chore(sync): reconcile bun.lock against merged manifests"
  info "bun.lock reconciled and committed: $(git rev-parse --short HEAD)"
else
  info "bun.lock already consistent with merged manifests"
fi

# ---- validation: full-workspace typecheck (semantic-break gate) --------------
TYPECHECK_OK="skipped"
if [ "$DO_TYPECHECK" -eq 1 ]; then
  log "Validate: full-workspace typecheck"
  if bun turbo typecheck; then TYPECHECK_OK="passed"; else
    TYPECHECK_OK="failed"
    log "TYPECHECK FAILED — semantic break; escalating for manual review"
  fi
fi

# ---- persist newly-recorded resolutions back to the store --------------------
log "Persist rerere memory"
if [ -n "$(ls -A .git/rr-cache 2>/dev/null || true)" ]; then
  mkdir -p "$RR_STORE"
  cp -r .git/rr-cache/. "$RR_STORE"/
  info "saved $(find "$RR_STORE" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ') resolution(s) to $RR_STORE"
  # Commit the updated memory onto the sync branch so it travels with the PR and
  # lands on the target branch when merged — making the cache self-perpetuating.
  git add "$RR_STORE" 2>/dev/null || true
  if ! git diff --cached --quiet; then
    git commit --no-verify -m "chore(sync): update remembered conflict resolutions" >/dev/null
    info "committed updated rerere memory"
  fi
fi

# ---- report ------------------------------------------------------------------
log "Summary"
SAFE=1
[ "${#ALL_ESCALATED[@]}" -gt 0 ] && SAFE=0
[ "$TYPECHECK_OK" = "failed" ] && SAFE=0
NEEDS_REVIEW_OUT="$([ "$NEEDS_REVIEW" -eq 1 ] && echo yes || echo no)"
SAFE_OUT="$([ "$SAFE" -eq 1 ] && echo yes || echo no)"
{
  echo "batches=$batch"
  echo "head=$(git rev-parse --short HEAD)"
  echo "typecheck=$TYPECHECK_OK"
  echo "needs_review=$NEEDS_REVIEW_OUT"
  echo "escalated=${ALL_ESCALATED[*]:-none}"
  echo "safe_to_push=$SAFE_OUT"
} | tee "$SUMMARY_FILE"

# Mirror machine-readable results to the CI step output (the workflow reads
# these to decide which PR to open). Harmless no-op when run locally.
if [ -n "${SYNC_GITHUB_OUTPUT:-}" ]; then
  {
    echo "result=ok"
    echo "head=$(git rev-parse --short HEAD)"
    echo "typecheck=$TYPECHECK_OK"
    echo "needs_review=$NEEDS_REVIEW_OUT"
    echo "safe_to_push=$SAFE_OUT"
    echo "escalated=${ALL_ESCALATED[*]:-none}"
  } >> "$SYNC_GITHUB_OUTPUT"
fi

if [ "$DO_PUSH" -eq 1 ]; then
  # Push the sync branch whether it is merge-ready or needs review. The caller
  # (workflow) opens a normal sync PR when safe_to_push=yes, or a conflict-review
  # PR when needs_review=yes. We never push the target branch.
  log "Push"
  git push origin "$SYNC_BRANCH" --force-with-lease
else
  info "dry run — not pushing (safe_to_push=$SAFE_OUT, needs_review=$NEEDS_REVIEW_OUT)"
fi
