# Drive openspec changes to completion with a chained loop

## Why

The workflow the user actually wants is: plan several openspec changes, then start one
loop with "keep iterating until all tasks are done, tested, verified, committed and
deployed" and have it work through them. Today `/loop` cannot do this, for four reasons:

1. **It has no notion of "done".** The completion token is never disclosed to the model
   (`loop-completion-contract`), so a loop cannot report success — it burns to
   `max_reached`. There is no definition of done tied to anything on disk.
2. **It has no notion of "next".** One loop targets one session lineage. When the work in
   front of it finishes, it stops. Chaining is manual.
3. **It cannot be trusted to run unattended.** A wedged provider stream parks the loop
   fiber indefinitely and cancel does not abort in-flight work
   (`session-cancellation-integrity`). An 18-hour hang was observed on 2026-07-25.
4. **It has no authority boundary.** "Committed and deployed" is a much larger grant than
   "edit files". A loop that can run arbitrary bash can push and deploy, and an
   unattended agent that ships a bad build to the fleet is a materially different failure
   than one that writes a bad file.

skein already solves the orchestration half — phases, gates, promise tokens, per-change
agent personas. This change brings the useful subset into opencode-skein so a single
`/loop` invocation can drive a queue of changes, while keeping the authority boundary
explicit rather than aspirational.

## What Changes

### 1. A queue mode for loops

`opencode loop --queue [<change>...]` (and `/loop --queue` in the TUI) starts a loop whose
unit of work is an **openspec change**, not a single prompt. With no changes named, the
queue is every active change under `openspec/changes/` — excluding `archive/`, `_repo/`,
and any change holding a `.skein/blocker.md` — in an explicit, printed order.

Each iteration is handed one change and the standing instruction to advance its
`tasks.md`. The change's `proposal.md`, `tasks.md`, and any `specs/**/spec.md` form the
iteration's brief.

### 2. Definition of done comes from disk, not from the model

A change is complete when **every checkbox in its `tasks.md` is checked** and the
validation commands named in those tasks exit zero. The model's completion token is
treated as a _claim_ that triggers verification — never as proof. If the model emits the
token while unchecked tasks remain, the iteration is rejected and the discrepancy is fed
back as the next iteration's prompt.

This also makes the queue cursor **derivable rather than stored**: progress lives in
`tasks.md` on disk, so a queue run survives a server restart without the loop service
needing persistence (loop state is in-memory at `loop.ts:138`). A resumed queue
recomputes its position by reading checkboxes.

### 3. Phase gates per change

Within a change, the loop advances through gates and will not skip one:

| Gate        | Passes when                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `implement` | all `tasks.md` checkboxes checked                                            |
| `test`      | the repo test command exits zero                                             |
| `verify`    | typecheck exits zero and each task's stated `Validation:` command exits zero |
| `commit`    | a commit exists on a non-default branch containing the change's work         |

A gate failure returns the loop to `implement` with the failure output as context. Three
consecutive failures of the same gate halt the queue.

### 4. Authority boundary enforced structurally

The loop runs under a permission profile that **denies** `git push`, `git tag`, deploy
scripts, and the release workflow — enforced through the existing permission system
(the same mechanism that logs `evaluated permission=bash pattern=…`), not by asking the
model nicely. A prompt-level restriction is not a control.

The ceiling is: **edit, test, verify, and commit locally; stop before push.** Reaching
the `commit` gate on the last queued change ends the run with a report of what is staged
for the user to push. `--allow-push` exists but is off by default and out of scope for
unattended use.

Tracker writes are likewise off by default: `--sync` opts into
`specsync -change <change>` after a change completes.

### 5. Relentless semantics: quarantine, don't halt

The queue exists to keep the fleet saturated with useful work. One stuck change must
never idle the whole run.

- A change completing cleanly → advance to the next.
- Any gate failing three times consecutively, a stall, or `max_reached` on one change →
  **quarantine that change** (write `.skein/blocker.md` into it with the gate, the
  verbatim failure output, and a timestamp) and **advance to the next change**. The
  blocker file is the same mechanism queue resolution already excludes on, so the
  quarantined change stays out of this run and every later run until a human (or
  `/skein-interpret-stuck`) clears it.
- The model may quarantine deliberately by emitting `<promise>BLOCKED</promise>` with a
  reason — the escape hatch for "this spec is wrong" rather than grinding against it.
  The reason lands in the blocker file.
- Because the cursor is derived from disk every iteration (design D1), changes added to
  `openspec/changes/` while the run is live join the queue automatically. The run ends
  only when a fresh resolution finds no eligible change with unchecked tasks.
- **Systemic-failure guard**: quarantining is for sick changes, not a sick environment.
  If three consecutive changes are quarantined without a single gate passing anywhere,
  the run halts and reports a suspected systemic cause (broken test runner, dead
  provider) — relentlessly quarantining the whole backlog against a broken harness
  would destroy a night of queue eligibility for nothing.

### 6. Fleet utilization: fan-out nudge in the brief

When `experimental.local_subagent_placement` is enabled and idle local peers exist, the
per-iteration brief SHALL tell the model so, and remind it that the task tool can place
subagents on those peers (implement/test/verify in parallel where the change's tasks
allow it). This is a prompt-level nudge only — placement, slot reservation, and context
fitting stay in the existing `ctx-aware-subagent-placement` machinery.

## Capabilities

### New Capabilities

- `loop-spec-queue`: chained, gated execution of openspec changes under a loop, with a
  disk-derived definition of done and an enforced authority ceiling.

### Modified Capabilities

- `loop-service`: gains queue mode and per-iteration brief construction.

## Dependencies

This change is not shippable before all three of:

- `loop-completion-contract` — without a disclosed token there is no completion signal.
- `session-cancellation-integrity` — an unattended driver that cannot be stopped is not
  shippable.
- `fix-loop-reliability` — per-iteration child sessions; otherwise a queue run
  accumulates every prior iteration in one context window (the observed 114.7K case).

## Non-Goals

- **No deploy.** Explicitly out of the autonomy ceiling for this change.
- No cross-repo or fleet orchestration — one queue, one repo, one working tree. Fleet
  dispatch stays skein's job. (The fan-out nudge in §6 delegates _within_ a change via
  the existing task-tool placement; it is not queue-level orchestration.)
- No parallel execution of changes. Serial only; parallel edits to one working tree need
  worktree isolation, which is a separate change.
- No automatic `openspec archive` — archiving is a human decision after review.
- No replacement of skein's agent personas or meeting/handover machinery.

## Impact

- New: queue driver in `packages/opencode/src/loop/` (queue resolution, gate evaluation,
  brief construction), openspec `tasks.md` parser, permission profile for unattended runs.
- Modified: `packages/opencode/src/loop/loop.ts`, `packages/opencode/src/cli/cmd/loop.ts`,
  `packages/tui/src/component/prompt/index.tsx`, `packages/tui/src/component/dialog-loop-list.tsx`
  (show current change and gate), `packages/sdk/js/src/v2/loop-args.ts`.
- Interacts with the permission system; needs review that the deny-list cannot be bypassed
  via a shell subprocess.
