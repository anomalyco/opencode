# Execute the work the tracker already says is ready

## Why

The per-repo queue drains one repository reliably. The remaining question is what to work
on next across ~30 repositories — and that question already has an owner:

- **openspec** holds changes and their tasks, per repo.
- **specsync** binds each change to a tracker item and reconciles state back into
  `tasks.md`. Every project here will use it. Its provider today is GitHub Projects
  (`.specsync/board.json` records `project_id`, `item_id`, and the stage→Status mapping),
  with beads as an alternative provider.
- **The board and its issue links** hold priority, status, and the relationships between
  items — including across repositories.

An earlier draft of this change proposed a workspace driver that scanned directories and
introduced `experimental.workspace_queue` with depth, priority and concurrency knobs, plus
a hand-rolled staleness rule for repo ordering. That was wrong, and the objection to it
was right: it rebuilds scheduling that the tracker already does, in a second place, with
new configuration to keep in sync. Worse, it listed cross-repo dependency ordering as a
non-goal when the links that express exactly that already exist.

The actual gap is narrower. specsync is **write-mostly**: it pushes openspec state to the
board and reconciles task state back. Nothing asks the board the one question an
unattended runner needs — *what is claimable right now?* — and nothing turns that answer
into a queue run.

## What Changes

### 1. specsync answers "what is ready" (upstream, not here)

The read path belongs in specsync, which already owns openspec ↔ provider translation in
both directions and already knows each change's binding. Teaching opencode to query GitHub
Projects directly would duplicate that knowledge in a second place — the mess this change
exists to avoid.

specsync gains a query mode that emits, as JSON, the changes whose tracker item is
claimable: right status, not blocked by an open dependency, not already in progress. This
is a dependency on the specsync repo, not work in this one. The contract it must satisfy
is specified here so both sides can be built against it.

### 2. A runner executes ready work

opencode gains a runner that asks the work source for ready items, resolves each to its
repository and openspec change, and runs the **existing** per-repo queue scoped to that
change. The queue is untouched: same gates, same disk-derived completion, same quarantine,
same authority ceiling.

Where a repository has no tracker binding, the fallback is what the queue already does —
the first change with unchecked tasks. No configuration decides this; the presence of a
binding does.

### 3. Claiming happens in the tracker

Marking an item in progress and releasing it uses the tracker's own state, so a second
runner — or a human — does not pick up the same work. There is no private lock file and no
second source of truth about who is doing what.

### 4. Per-repo gate configuration

The one genuinely new setting, and it is not scheduling: test and verify commands differ
per repository, and `Config` is instance-scoped, so one server cannot read thirty
`experimental.queue_gate` blocks through `config.get()`. Gate options resolve from the
repository's own config, then built-ins. Without this a run halts on nearly every repo, so
it lands first.

### 5. Concurrency is a resource bound, not a policy

Repositories are separate working trees, so several can run at once. How many is derived
from probed fleet capacity — the accounting subagent placement already uses — floor one.
Nothing to configure: eight runs against one busy provider queues eight requests and adds
no throughput.

## Capabilities

### New Capabilities

- `auto-across-repos`: executes the work the tracker reports as claimable, resolving each
  item to a repository and openspec change and running the per-repo queue for it.

### Modified Capabilities

- `loop-spec-queue`: gate options resolve per repository rather than from a single config.

## Dependencies

- `loop-spec-queue` — the per-repo engine this feeds. Implemented.
- **specsync query mode** — the read path described above. External repo; this change
  specifies the contract and ships the on-disk fallback so it is useful before that lands.

## Non-Goals

- **No second scheduler.** Priority, status and dependencies stay in the tracker. This
  change SHALL NOT introduce a competing notion of what is next.
- **No new ordering or priority configuration.** If something should go first, that is
  expressed on the board.
- **No direct provider API access from opencode.** Provider translation stays in specsync,
  in one place, for both directions.
- **No changes to how items are created.** specsync owns openspec → tracker.
- **No cross-host dispatch.** One machine, one filesystem; a run here is the unit skein
  would dispatch.
- **No push, tag, publish or deploy**, and no parallel changes within one repository — the
  per-repo ceiling and the one-tree constraint are inherited unchanged.

## Impact

- New: `packages/opencode/src/loop/ready-work/` (work-source client, resolution, runner).
- Modified: `packages/opencode/src/loop/loop.ts` (gate options resolve per repository).
- Modified: TUI auto-mode wiring, so Auto outside a single repo runs ready work.
- Modified: `packages/core/src/v1/config/config.ts` — per-repo gate block only.
- External: specsync gains a query mode (tracked separately, contract specified here).
