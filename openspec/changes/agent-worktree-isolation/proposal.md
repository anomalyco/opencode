# Isolate opencode-skein's own agent execution in per-change git worktrees

## Why

Two or more opencode-skein agents (manually launched TUI instances, or `/loop`
sessions) working in the same checkout will happily switch branches out from
under each other — there is no isolation between concurrent git operations in
one working directory. This is a live, recurring pain, not a hypothetical: the
2026-07-26 incident that motivated `session-summary-write-amplification` also
surfaced **two opencode-skein processes running concurrently against the same
`/Users/andreas/dev/brick-now` checkout**, with no separation between them.

This is not a new problem for the ecosystem — it already has a working
solution one level up. The external `skein` orchestrator creates a dedicated
git worktree per change before dispatching a coder agent, confirmed directly
from this repo's own change handoffs:

- `openspec/changes/error-boundaries-plan/.skein/coder-context.md`:
  `Repo root: /Users/andreas/dev/opencode-worktrees/error-boundaries-plan`
- `openspec/changes/refactor-context-management-to-intr/.skein/coder-context.md`:
  `Repo root: /Users/andreas/dev/opencode-worktrees/refactor-context-management-to-intr`

opencode-skein's own `/loop` and Task-tool build agents have no equivalent.
This gap has already been named twice in the backlog and punted both times:

- `loop-spec-queue`'s Non-Goals: *"No parallel execution of changes. Serial
  only; parallel edits to one working tree need worktree isolation, **which
  is a separate change**."*
- `provider-slot-leases`'s Non-Goals: *"Not leasing anything other than
  provider slots — file locks and **repo/worktree contention between
  instances are a separate problem**."*

This change is that separate change.

## What Changes

1. **A worktree lifecycle module**, `packages/opencode/src/git/worktree.ts`,
   following this repo's existing precedent for shelling out to git
   (`packages/opencode/src/snapshot/index.ts`'s `git()` helper over
   `ChildProcessSpawner`; `script/sync-upstream.ts`'s
   `git worktree add -b <branch> <path> <base>` invocation):
   - `ensure(slug)` — reuse `../opencode-worktrees/<slug>` if it already
     exists (from a previous run, or from `skein` itself — same convention,
     same path, so the two systems never collide); otherwise
     `git worktree add -b <branch> <path> <base>`.
   - `merge(slug)` — from the main checkout, `git merge --no-ff` the
     worktree's branch locally. **Never pushes** — matches `loop-spec-queue`'s
     already-decided authority boundary (edit/test/verify/commit locally,
     stop before push).
   - `cleanup(slug)` — `git worktree remove`, only after a successful merge.
2. **Wired into `/loop`'s start path**, behind an experimental flag
   (`experimental.agent_worktree_isolation`, **default off** — this changes
   where an agent writes files and which branch it operates on, so it stays
   opt-in until proven safe, unlike `local_subagent_placement`'s default-on
   opt-out convention).
3. **Sibling-directory convention documented**: `../opencode-worktrees/<slug>`,
   matching skein's existing layout exactly, so a human or either tool can
   find and reuse the same worktree.

## Non-Goals

- **No "pick the next spec automatically" behavior.** That is
  `loop-spec-queue`'s job, once it exists — this change only makes worktree
  isolation *available* to whatever drives a loop into a change. It does not
  itself decide which change to work on next or call specsync.
- **No blocking on `loop-spec-queue`.** That change has zero implemented
  tasks and is itself gated behind three other unimplemented changes. This
  change is usable standalone: point a loop at one change, it gets a
  worktree.
- **No Task-tool subagent worktrees.** Subagents dispatched via the Task tool
  are mostly read-heavy or make small, short-lived edits; the collision risk
  observed so far is between full `/loop`/build sessions. Revisit only if
  subagents are observed causing the same problem.
- **No cross-host coordination.** This is single-machine, single-checkout
  isolation. Fleet-wide coordination is `fleet-instance-presence` /
  `agent-coordination-bus`'s domain.
- **No file-level locking across processes**, and no attempt to prevent two
  *different* opencode-skein instances from independently choosing the same
  change — `ensure()` reusing an existing worktree by path handles the common
  case (same slug → same directory) but is not a distributed lock.

## Impact

- New: `packages/opencode/src/git/worktree.ts`.
- Modified: `packages/opencode/src/loop/*` (start/stop path, behind the flag).
- Config: new `experimental.agent_worktree_isolation` boolean.
- No effect on any existing behavior when the flag is off (the default).
