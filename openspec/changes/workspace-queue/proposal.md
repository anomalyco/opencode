# Drain a whole workspace of repos, not one repo at a time

## Why

`loop-spec-queue` made one repo's backlog drain reliably: implement → test → verify →
commit, done derived from checkboxes on disk, stuck changes quarantined instead of
halting, no push. It works, and it stops at the repo boundary.

The actual backlog does not. There are hundreds of planned tasks spread across roughly
thirty repos under one workspace directory, each with its own `openspec/changes`. Today
draining them means starting a run inside each repo by hand and coming back when it
finishes — which is the same "wait for me to say what's next" that queue mode was built
to remove, moved up one level.

Three things make this worth building now rather than deferring to skein:

1. **The boundary is real but misplaced.** "One queue, one repo, one working tree" is a
   correctness constraint about *edits*, not about *scheduling*. Two repos are two working
   trees, so running them at the same time is safe in a way that running two changes in
   one repo is not. Nothing exploits that today.
2. **Idle capacity goes unused.** The fleet has five llama-skein hosts. A single-repo run
   uses one of them for its main loop and can delegate subagents to the rest, but when
   that repo's backlog is thin the remaining hosts sit idle while twenty-nine other
   backlogs wait.
3. **Starting in the wrong place is currently a dead end.** Starting Auto in the workspace
   directory now reports which repos are below it (fixed in `loop-spec-queue`), which is
   an improvement over silently claiming the backlog was drained — but it still means the
   obvious action from the obvious place does nothing.

## What Changes

### 1. A workspace run that drives per-repo queue runs

A new **workspace queue** takes a workspace directory, discovers the repos beneath it that
have eligible openspec work, and drives one existing per-repo queue run for each. It adds
scheduling; it does not reimplement gates, quarantine, completion, or the authority
ceiling, all of which stay exactly where they are.

Discovery is disk-derived like everything else in the queue: a directory one level below
the root (configurable depth) containing `openspec/changes` with at least one eligible
change. No registry, no config listing repos.

### 2. Repos run concurrently, bounded by real capacity

Repos are independent working trees, so the driver runs several at once. Concurrency is
not a fixed number: it is bounded by the fleet capacity that actually exists, probed with
the same `LocalPlacement` machinery subagent placement already uses, and by an explicit
maximum. When no local provider is idle the driver falls back to serial.

### 3. Gate configuration resolves per repo

`experimental.queue_gate` is currently read from one config, which cannot describe thirty
repos whose test commands and package layouts differ. Gate options resolve from the
repo's own config first, then the workspace's defaults, then the built-ins. This is the
one place the existing design genuinely does not scale, and it must be fixed for the
driver to be usable at all.

### 4. Auto mode in a workspace starts a workspace run

Selecting Auto in a directory that is a workspace rather than a repo starts a workspace
run over the repos beneath it, instead of failing with a list. Auto in a repo keeps
starting a single-repo run. The optional standing instruction applies to every repo in
the run.

### 5. One report for the whole run

The run reports per repo: changes completed, changes quarantined with cause, branches
created and awaiting review, and whether a tracker sync ran. A workspace run that touched
twelve repos must be readable in one place, not reconstructed from twelve separate loop
records.

## Capabilities

### New Capabilities

- `workspace-queue`: discovery, scheduling and aggregated reporting for per-repo queue
  runs across a workspace of repositories.

### Modified Capabilities

- `loop-spec-queue`: gate options resolve per repo rather than from a single config.

## Dependencies

- `loop-spec-queue` — the per-repo engine this schedules. Already implemented.

## Non-Goals

- **No cross-host dispatch.** This coordinates repos on one machine, using remote
  inference where placement offers it. Deciding which *hosts* run which work stays
  skein's job; the line is workspace orchestration here, fleet orchestration there.
- **No push, tag, publish or deploy** — the per-repo authority ceiling is inherited
  unchanged, and the driver adds nothing to it.
- **No parallel changes within one repo.** The one-tree constraint is unchanged;
  concurrency is strictly across repos.
- **No cross-repo dependency ordering.** If repo B's work depends on repo A's, this will
  not know. Ordering is priority and staleness only.
- **No new tracker integration.** `--sync` stays per repo (and already supports
  `-provider beads`); the driver only aggregates what each run reports.
- **No monorepo sub-package discovery.** A repo is a directory with `openspec/changes`,
  not a package within one.

## Impact

- New: `packages/opencode/src/loop/workspace-queue/` (discovery, scheduler, report).
- Modified: `packages/opencode/src/loop/loop.ts` (gate options resolve per repo),
  `packages/opencode/src/loop/spec-queue/queue.ts` (reuse `nearbyOpenspecRepos`).
- Modified: `packages/tui/src/component/auto-mode-apply.ts` and
  `src/util/auto-mode.ts` (Auto picks workspace vs repo run).
- Modified: `packages/core/src/v1/config/config.ts` (workspace queue defaults).
- SDK: workspace run creation and status.
