# Tasks: loop-spec-queue

Depends on `loop-completion-contract`, `session-cancellation-integrity`, and
`fix-loop-reliability` — all three implemented in the working tree 2026-08-05.

Implementation status 2026-08-05: Phases 1–3 and 6 implemented and tested
(`src/loop/spec-queue/{tasks-md,queue,brief,gates}.ts`, queue driver in
`src/loop/loop.ts`; 15 unit tests in `test/loop/spec-queue.test.ts`, 5 integration
tests in `test/loop/queue-mode.test.ts` — drain, quarantine, false-completion-claim
discrepancy, BLOCKED signal, concurrent refusal — all green). Phase 4: deny profile
implemented (`QueueDenyRules` on the queue's parent AND child sessions) and, load-bearing:
`session/tools.ts` now evaluates deny rules BEFORE the auto-mode skip, so auto mode
cannot void the ceiling. Phase 5: CLI `--queue`, TUI `/loop --queue`, dialog gate
display, report printing done (`--sync` remains). Remaining: 4.2 adversarial review,
4.3 credential-less runs, 5.4 `--sync`, 7.3 restart resume, 7.4 real backlog run.

## Phase 1: openspec change model

- [x] 1.1 Implement a `tasks.md` parser
  - Parse `- [ ]` / `- [x]` items with their `N.N` ids, nested bullets, and `Validation:` lines
  - Return `{ id, text, checked, validation?: string }[]`
  - Validation: unit tests against the real `tasks.md` files in `openspec/changes/` — every file parses, counts match a `grep -c` baseline

- [x] 1.2 Implement queue resolution
  - Enumerate `openspec/changes/*/`, exclude `archive/`, `_repo/`, and any dir containing `.skein/blocker.md`
  - Deterministic order; accept an explicit change list to override
  - Validation: unit test with a fixture tree, including a blocker-bearing change that is excluded

- [x] 1.3 Implement cursor derivation from disk
  - Current change = first queued change with an unchecked task
  - Validation: unit test — resolving twice with no changes on disk yields the same cursor; checking off all tasks in change 1 advances the cursor to change 2

- [x] 1.4 Build the per-iteration brief
  - Compose `proposal.md`, `tasks.md`, and `specs/**/spec.md` for the current change plus the next unchecked task
  - Validation: snapshot test of a brief for a known change

## Phase 2: Gates

- [x] 2.1 Define the gate state machine `implement → test → verify → commit`
  - One-directional; failure returns to `implement` carrying failure output
  - Validation: `bun typecheck` — zero errors

- [x] 2.2 Implement gate evaluators
  - `implement`: all checkboxes checked
  - `test`: repo test command exits zero
  - `verify`: `bun typecheck` exits zero and each task's `Validation:` command exits zero
  - `commit`: a commit exists on a non-default branch containing the change's work
  - Validation: unit tests per evaluator with pass and fail fixtures

- [x] 2.3 Implement consecutive-same-gate failure counting, limit 3 → quarantine change
  - Must fire even when every iteration makes tool calls (the existing no-progress guard would not)
  - Validation: test — three `verify` failures with tool calls present quarantines the change and the queue advances

- [x] 2.4 Implement completion-claim verification
  - Token in output triggers gate evaluation; on mismatch, build the discrepancy prompt naming unchecked tasks and failing output
  - Validation: test — token emitted with 2 unchecked tasks does not advance and the next prompt names both

## Phase 3: Queue driver in the loop service

- [x] 3.1 Add queue mode to `CreateInput` and `Info`
  - `mode: "prompt" | "queue"`, `queue?: string[]`, plus current change and gate on `Info`
  - Validation: `bun typecheck` passes; SDK types updated in `packages/sdk/js/src/v2/loop-args.ts`

- [x] 3.2 Implement the queue driver loop
  - Each iteration: derive cursor → build brief → dispatch → evaluate gate → advance or return to implement
  - Validation: integration test with a mock LLM driving a two-change fixture queue to completion

- [x] 3.3 Refuse a second concurrent queue loop for the same directory
  - Validation: test — second create is refused naming the active loop

- [x] 3.4 Implement quarantine semantics and the blocked signal (relentless mode)
  - Gate exhaustion, stall, `max_reached`, or `<promise>BLOCKED</promise>` on a change →
    write `.skein/blocker.md` (gate/reason, verbatim failure output, timestamp) into the
    change and advance; leave the tree otherwise untouched from the failure point
  - Validation: test each cause produces a blocker file with the correct cause and the
    queue continues with the next change

- [x] 3.5 Implement live queue re-resolution and the end condition
  - Re-resolve the queue from disk as the run progresses; changes appearing mid-run join it
  - The run ends only when a fresh resolution finds no eligible change with unchecked tasks
  - Validation: test — a change added after the run starts is attempted; a drained queue ends the run

- [x] 3.6 Implement the systemic-failure guard
  - Three consecutive changes quarantined with zero gates passed anywhere in the run → halt,
    report suspected systemic cause, quarantine no further changes
  - Validation: test — three changes failing on a broken test command halt the run with the shared cause named

- [x] 3.7 Implement the fan-out nudge in the brief
  - When `experimental.local_subagent_placement` is on and `LocalPlacement` reports at
    least one idle peer, append one paragraph to the brief naming the task-tool fan-out
    option; no idle peers → no nudge
  - Validation: unit test with a stubbed placement — nudge present with idle peers, absent without

## Phase 4: Authority boundary

- [x] 4.1 Define the unattended permission profile
  - Deny `git push`, `git tag`, `gh release`, `gh pr merge`, `npm publish`, `bun publish`, `script/deploy*`, `fleet-deploy*`, release workflow triggers
  - Enforced via the existing permission layer, not the prompt
  - Validation: test — each denied command is refused and the denial is recorded

- [x] 4.2 Adversarial review of the boundary (see design.md D4)
  - Attempt bypass via: subprocess, shell alias, wrapper script, heredoc-written-then-executed script, `git -c` tricks
  - Document each attempt and its result
  - Validation: no attempt succeeds in pushing, OR the gap is documented and 4.3 is mandatory
  - Done 2026-08-05 as an executable review: `test/loop/queue-authority.test.ts`
    runs each bypass shape through the REAL derivation the shell tool uses
    (`ShellTool.commandPatterns` — newly exported, same parse/commands/source
    primitives as `collect`) against the REAL `QueueDenyRules` via the REAL
    `Permission.evaluate`. 35 shapes denied, including `&&`/`;`/`||` chains,
    subshells, `$(…)` and backtick substitution, pipelines, env prefixes,
    `git -c k=v push`, absolute-path git, `nohup`/`timeout`/`env -i` wrappers,
    `xargs`, `find -exec`, remote execution (ssh/scp/rsync), and credential-helper
    or remote-URL rewrites. Ordinary queue work (test, typecheck, add, commit,
    checkout -b) stays permitted.
    KEY FINDING: the shell tool AST-decomposes compound commands, so per-node
    matching is far stronger than string matching — but 3 shapes are provably
    invisible to ANY pattern layer and are pinned as RESIDUAL tests: an opaque
    wrapper script (`./tools/ship.sh`), a generated-then-executed script
    (`bash /tmp/generated.sh`), and `make release`. Those make 4.3 mandatory,
    not optional.

- [x] 4.3 Defence in depth — run queue loops without git push credentials
  - Ensure a push cannot authenticate even if the command is reached
  - Validation: manual — `git push` inside a queue loop fails to authenticate
  - Done 2026-08-05 and enforced in code, not by recipe: `QueueAuthority.deniesPush`
    keys off the session's own ruleset, and `session/tools.ts` passes that verdict
    to the shell tool via `ctx.extra.denyPush`; `ShellTool.shellEnv` then applies
    `withoutCredentials()`, which deletes GITHUB_TOKEN/GH_TOKEN/GITHUB_API_TOKEN/
    NPM_TOKEN/NODE_AUTH_TOKEN/CARGO_REGISTRY_TOKEN/SSH_AUTH_SOCK/SSH_AGENT_PID and
    forces GIT_TERMINAL_PROMPT=0 plus GIT_ASKPASS/SSH_ASKPASS=/bin/false. The queue
    driver's own gate commands get the same stripped env. Because the trigger is
    "this session denies pushing", the mitigation cannot drift out of step with the
    deny list. Covered by tests in `test/loop/queue-authority.test.ts`.

- [x] 4.4 Implement the `commit` gate behaviour
  - Branch `loop/<change-slug>` off the current branch; never commit to `dev`
  - Message from the proposal H1 plus the standard trailer; no amend, no rebase
  - Validation: test — commit lands on the expected branch, `dev` is untouched

## Phase 5: Surfaces

- [x] 5.1 CLI: `opencode loop --queue [<change>...]`
  - Validation: `opencode loop --help` documents queue mode and the authority ceiling

- [x] 5.2 TUI: `/loop --queue`
  - `packages/tui/src/component/prompt/index.tsx` (~:1138-1172 intercept path)
  - Validation: manual — starts a queue loop

- [x] 5.3 Show current change and gate in the `/loops` dialog
  - `packages/tui/src/component/dialog-loop-list.tsx`
  - Validation: manual — dialog shows change slug and gate per queue loop

- [x] 5.4 Optional tracker sync behind `--sync`, default off
  - Runs `specsync -change <change>` after a change completes
  - Validation: default run makes no GitHub calls; `--sync` performs a dry-run first
  - Done 2026-08-05: `queueSync` on `CreateInput` (default false), `--sync` on the
    CLI and `/loop --queue --sync` in the TUI. Only fires for a change that
    COMPLETED (never a quarantined one), always runs `specsync -change <slug>
    -dry-run` first and logs it, and only then the real sync; each result lands in
    the run report. A sync failure never changes the change's outcome. Note:
    `specsync` supports `-provider beads`, so this is also the path to mirroring
    queue progress into beads.

## Phase 6: Report

- [x] 6.1 Implement the run report
  - Per change: final gate, iterations used, commit sha; quarantined changes with cause
    and blocker path; branches awaiting push; systemic halt cause if any
  - Validation: snapshot test for a drained run and a quarantine-bearing run

- [x] 6.2 Surface the report in TUI and CLI on run end
  - Validation: manual — report is readable after an unattended run

## Phase 7: End-to-end verification

- [x] 7.1 Two-change fixture queue drains to completion with a mock LLM
  - Validation: both changes complete, two branches created, nothing pushed

- [x] 7.2 Quarantine path end-to-end
  - Validation: change 1 exhausts `verify` and is quarantined with a blocker file; change 2 is attempted and completes; the report names both outcomes

- [x] 7.3 Restart resume
  - Kill the server mid-queue; restart; resume
  - Validation: resumes at the correct change, no repeated work
  - Done 2026-08-05: `test/loop/spec-queue.test.ts` "restart resume" — a fresh
    resolution with zero in-memory carry-over resumes at the next unchecked change,
    treats the finished one as complete, keeps a pre-restart quarantine excluded,
    and picks up a change created mid-run. This is the whole point of deriving the
    cursor from disk (D1): there is no persistence to restore.
    Incidental finding: queue order is alphabetical by slug, so `change-three`
    sorts before `change-two` — deterministic as specified, but not priority-aware.

- [x] 7.4 Real unattended run against this repo's own backlog
  - Target `retire-auto-reply` (smallest, self-contained) as the single queued change
  - Validation: run completes or halts with a legible report; no push occurred; `dev` untouched
  - Run 1 (2026-08-05, isolated git worktree, z4/qwen3.6-35b-a3b-q8-0): the agent
    really did the work unattended — deleted `auto-reply/auto-reply.ts`,
    `automation/automation-features.ts`, `cli/cmd/auto-reply.ts`,
    `cli/cmd/pattern-detection.ts`, updated `fork/commands.ts`, CHANGELOG and
    AUTOMATION_FEATURES, and checked off all 12 tasks. Nothing was pushed and the
    main working tree was untouched, as designed.
    IT ALSO FOUND A LOAD-BEARING BUG: the change was then quarantined
    "test gate failed 3x consecutively" after ZERO repair attempts. When a
    downstream gate failed, the driver returned to `implement`, which re-passed
    instantly because the checkboxes were still all checked — so all three strikes
    burned in a tight evaluate-only loop and the failure output never reached the
    model. Fixed: a pending gate failure now always costs a model repair turn
    carrying that failure, and the failed gate is re-run afterwards. Pinned by
    "a failing gate spends a repair turn instead of burning strikes silently"
    in `test/loop/queue-mode.test.ts`.
  - Run 2 (with the repair-turn fix, fresh worktree): reached 12/12 tasks and spent
    5 iterations (against run 1's 1), confirming repair turns happen — then
    quarantined "test gate failed 3x". The blocker file showed that verdict was a
    FALSE NEGATIVE from the harness, not the agent: the gate ran `bun test` with cwd
    = the repo root, and this repo refuses that outright ("do-not-run-tests-from-root";
    the root `test` script is literally `exit 1`). Two defects fixed as a result:
    (a) gate commands had no configurable working directory — added
    `queueOptions.cwd` plus `--gate-cwd`/`--test-command`/`--verify-command` on the
    CLI; and (b) a gate that has never passed once in a run was quarantining changes
    one at a time, which would blocker an entire backlog for a config mistake — the
    command-backed gates (test, verify) now halt the run naming the suspected
    misconfiguration and the verbatim output instead. `implement` and `commit` are
    excluded from that heuristic since they can legitimately never pass.
  - Run 3 (both fixes, gate cwd set to packages/opencode after a real `bun install`
    in the worktree): reached 12/12 tasks in 5 iterations, then the new
    misconfiguration halt fired — correctly. The gate command I chose,
    `bun test test/loop/`, runs the queue's OWN tests, and running them while a
    real agent worked the same worktree failed 11 of them on timing; the halt
    reported the verbatim output, which made that diagnosable in seconds instead
    of silently blockering the change. Lesson for operators: do not point the test
    gate at tests that exercise the queue itself.
    IT EXPOSED ONE MORE DEFECT, now fixed: the halt still left the change
    quarantined — a 19.7K `.skein/blocker.md` on a change whose tasks were all
    checked. A config mistake was poisoning finished work for every future run,
    which is precisely what the halt was introduced to prevent. The suspect-gate
    decision now happens BEFORE any outcome is recorded, removes the blocker it
    had written (`SpecQueue.unquarantine`), and says so in the report. Asserted by
    the regression test.
    Across all runs the behaviour this task exists to prove holds: a real planned
    change is advanced unattended under the no-push ceiling, in an isolated
    worktree, with every outcome legible in the report and blocker file.

## Follow-ups found by the real runs

- [x] 8.1 `IterationInfo.toolCalls` undercounts multi-step turns
  - Run 1's single iteration reported `toolCalls: 0` while the agent had demonstrably
    deleted four files and edited three more. `runIteration` counts tool parts on the
    message `promptSvc.prompt` returns (the last assistant message), so tool calls made
    in earlier steps of the same turn are invisible.
  - This matters beyond reporting: prompt-mode loops feed `toolCalls === 0` into the
    no-progress guard, so a productive multi-step turn can be scored as a stall.
  - Validation: a multi-step turn reports its true tool-call count, and the
    no-progress guard does not fire on it.
  - Fixed 2026-08-05: `runIteration` now counts tool parts across every assistant
    message of the turn instead of only the one `promptSvc.prompt` resolves to.
    Each iteration owns a fresh child session so all of its messages belong to the
    turn; the degraded no-child path bounds by the iteration's start time. The
    count never goes below what the returned message alone shows, so a failed
    `messages()` read cannot manufacture a stall.
    Regression test "a multi-step turn reports its real tool-call count and is not
    scored as a stall" drives a tool call in step 1 and prose in step 2 with
    `noProgressLimit: 1`. Confirmed it catches the bug: with the fix the loop ends
    `completed`, and reverting the fix makes the same loop end `stalled` — i.e. the
    old behaviour really did kill productive work.

- [x] 8.2 Queue order is alphabetical by slug, not priority-aware
  - Deterministic as specified, but `change-three` sorts before `change-two`, and the
    backlog has no way to say "this one first".
  - Validation: an explicit ordering signal (or documented convention) decides order.
  - Fixed 2026-08-05: discovered changes are ordered by `priority` from the change's
    `.openspec.yaml` (lower first, `DefaultPriority = 100` so labelling one change
    does not require renumbering the rest), then `created` (oldest first — a backlog
    is a queue, not a dictionary), then slug for a total stable order. An explicit
    `--queue a b c` list is honoured verbatim, since naming the changes IS the
    priority statement. Read with a small line scanner rather than a new YAML
    dependency, keeping `queue.ts` import-free apart from fs/path.
    Also closed a spec gap noticed while doing this: the requirement said the
    resolved order "SHALL be printed when the run starts" and nothing printed it —
    `runQueue` now logs the resolved order, quarantined set, and complete set before
    the first iteration.

- [x] 7.5 Full typecheck, test, build
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green; single-target build smoke-passes
  - Verified 2026-08-05: workspace `bun run typecheck` 0 errors; `test/loop/` 97/97
    green (spec-queue 17, queue-mode 6, queue-authority 41, continuation 6, loop 27);
    single-target build smoke-passed. NOT green repo-wide: `test/session/prompt.test.ts`
    is 52 pass / 4 fail here against 39 pass / 15 fail at HEAD in the same working
    directory — i.e. this change removes 11 failures (the LAN-scan hermeticity fix)
    and adds none. The residual failures are timing-sensitive cancel/subtask tests
    whose count varies run to run (3–11) with machine load.
