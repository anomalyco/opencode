# Tasks: loop-spec-queue

Depends on `loop-completion-contract`, `session-cancellation-integrity`, and
`fix-loop-reliability`. Do not start Phase 3 before those are merged.

## Phase 1: openspec change model

- [ ] 1.1 Implement a `tasks.md` parser
  - Parse `- [ ]` / `- [x]` items with their `N.N` ids, nested bullets, and `Validation:` lines
  - Return `{ id, text, checked, validation?: string }[]`
  - Validation: unit tests against the real `tasks.md` files in `openspec/changes/` — every file parses, counts match a `grep -c` baseline

- [ ] 1.2 Implement queue resolution
  - Enumerate `openspec/changes/*/`, exclude `archive/`, `_repo/`, and any dir containing `.skein/blocker.md`
  - Deterministic order; accept an explicit change list to override
  - Validation: unit test with a fixture tree, including a blocker-bearing change that is excluded

- [ ] 1.3 Implement cursor derivation from disk
  - Current change = first queued change with an unchecked task
  - Validation: unit test — resolving twice with no changes on disk yields the same cursor; checking off all tasks in change 1 advances the cursor to change 2

- [ ] 1.4 Build the per-iteration brief
  - Compose `proposal.md`, `tasks.md`, and `specs/**/spec.md` for the current change plus the next unchecked task
  - Validation: snapshot test of a brief for a known change

## Phase 2: Gates

- [ ] 2.1 Define the gate state machine `implement → test → verify → commit`
  - One-directional; failure returns to `implement` carrying failure output
  - Validation: `bun typecheck` — zero errors

- [ ] 2.2 Implement gate evaluators
  - `implement`: all checkboxes checked
  - `test`: repo test command exits zero
  - `verify`: `bun typecheck` exits zero and each task's `Validation:` command exits zero
  - `commit`: a commit exists on a non-default branch containing the change's work
  - Validation: unit tests per evaluator with pass and fail fixtures

- [ ] 2.3 Implement consecutive-same-gate failure counting, limit 3 → halt queue
  - Must fire even when every iteration makes tool calls (the existing no-progress guard at `loop.ts:301-321` would not)
  - Validation: test — three `verify` failures with tool calls present halts the queue

- [ ] 2.4 Implement completion-claim verification
  - Token in output triggers gate evaluation; on mismatch, build the discrepancy prompt naming unchecked tasks and failing output
  - Validation: test — token emitted with 2 unchecked tasks does not advance and the next prompt names both

## Phase 3: Queue driver in the loop service

- [ ] 3.1 Add queue mode to `CreateInput` and `Info`
  - `mode: "prompt" | "queue"`, `queue?: string[]`, plus current change and gate on `Info`
  - Validation: `bun typecheck` passes; SDK types updated in `packages/sdk/js/src/v2/loop-args.ts`

- [ ] 3.2 Implement the queue driver loop
  - Each iteration: derive cursor → build brief → dispatch → evaluate gate → advance or return to implement
  - Validation: integration test with a mock LLM driving a two-change fixture queue to completion

- [ ] 3.3 Refuse a second concurrent queue loop for the same directory
  - Validation: test — second create is refused naming the active loop

- [ ] 3.4 Implement halt semantics and the blocked signal
  - Halt on gate exhaustion, stall, `max_reached`, error, or `<promise>BLOCKED</promise>`
  - Leave the working tree untouched from the halt point
  - Validation: test each halt cause produces a halt with the correct reported cause

## Phase 4: Authority boundary

- [ ] 4.1 Define the unattended permission profile
  - Deny `git push`, `git tag`, `gh release`, `gh pr merge`, `npm publish`, `bun publish`, `script/deploy*`, `fleet-deploy*`, release workflow triggers
  - Enforced via the existing permission layer, not the prompt
  - Validation: test — each denied command is refused and the denial is recorded

- [ ] 4.2 Adversarial review of the boundary (see design.md D4)
  - Attempt bypass via: subprocess, shell alias, wrapper script, heredoc-written-then-executed script, `git -c` tricks
  - Document each attempt and its result
  - Validation: no attempt succeeds in pushing, OR the gap is documented and 4.3 is mandatory

- [ ] 4.3 Defence in depth — run queue loops without git push credentials
  - Ensure a push cannot authenticate even if the command is reached
  - Validation: manual — `git push` inside a queue loop fails to authenticate

- [ ] 4.4 Implement the `commit` gate behaviour
  - Branch `loop/<change-slug>` off the current branch; never commit to `dev`
  - Message from the proposal H1 plus the standard trailer; no amend, no rebase
  - Validation: test — commit lands on the expected branch, `dev` is untouched

## Phase 5: Surfaces

- [ ] 5.1 CLI: `opencode loop --queue [<change>...]`
  - Validation: `opencode loop --help` documents queue mode and the authority ceiling

- [ ] 5.2 TUI: `/loop --queue`
  - `packages/tui/src/component/prompt/index.tsx` (~:1138-1172 intercept path)
  - Validation: manual — starts a queue loop

- [ ] 5.3 Show current change and gate in the `/loops` dialog
  - `packages/tui/src/component/dialog-loop-list.tsx`
  - Validation: manual — dialog shows change slug and gate per queue loop

- [ ] 5.4 Optional tracker sync behind `--sync`, default off
  - Runs `specsync -change <change>` after a change completes
  - Validation: default run makes no GitHub calls; `--sync` performs a dry-run first

## Phase 6: Report

- [ ] 6.1 Implement the run report
  - Per change: final gate, iterations used, commit sha; halting change with verbatim failure output; branches awaiting push; remaining unattempted changes
  - Validation: snapshot test for a completed run and a halted run

- [ ] 6.2 Surface the report in TUI and CLI on run end
  - Validation: manual — report is readable after an unattended run

## Phase 7: End-to-end verification

- [ ] 7.1 Two-change fixture queue drains to completion with a mock LLM
  - Validation: both changes complete, two branches created, nothing pushed

- [ ] 7.2 Halt path end-to-end
  - Validation: queue halts on change 1's `verify` gate, change 2 untouched and reported unattempted

- [ ] 7.3 Restart resume
  - Kill the server mid-queue; restart; resume
  - Validation: resumes at the correct change, no repeated work

- [ ] 7.4 Real unattended run against this repo's own backlog
  - Target `retire-auto-reply` (smallest, self-contained) as the single queued change
  - Validation: run completes or halts with a legible report; no push occurred; `dev` untouched

- [ ] 7.5 Full typecheck, test, build
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green; single-target build smoke-passes
