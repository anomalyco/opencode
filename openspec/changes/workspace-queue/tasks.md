# Tasks: workspace-queue

Depends on `loop-spec-queue` (implemented). Phase 1 is the load-bearing one: without
per-repo gate configuration a workspace run halts on almost every repo, so nothing after
it is worth building until 1.x is green.

## Phase 1: Per-repo gate configuration

- [ ] 1.1 Determine how a queue run gets its repository's config
  - `Config` is instance-scoped (`InstanceState`), so `config.get()` answers for the
    instance's directory — see design D2. Establish whether a loop can be created in
    another repo's workspace/instance context via the existing
    `WorkspaceRoutingMiddleware` already present on the loop endpoints
  - Write down the answer in design.md before writing code; if per-instance creation is
    impractical, take the documented fallback (read `<repo>/opencode.json` for gate
    options only) and say so explicitly
  - Validation: a short written finding in design.md, plus a spike proving a queue run in
    repo B reads repo B's `experimental.queue_gate`

- [ ] 1.2 Implement per-repo gate resolution: repo config, then workspace defaults, then built-ins
  - Validation: unit test with two fixture repos declaring different test commands — each
    resolves its own, and a repo declaring only a test command inherits the workspace verify command

- [ ] 1.3 Add workspace-level defaults to config
  - `experimental.workspace_queue`: `{ depth?, max_concurrency?, gate?: { … } }`
  - Validation: `bun run typecheck`; SDK types regenerate with the field

- [ ] 1.4 Prove the failure this phase exists to prevent
  - Validation: a two-repo fixture where the workspace default gate is wrong for one repo
    and right for the other — the correct repo completes rather than both halting

## Phase 2: Discovery and ordering

- [ ] 2.1 Implement repo discovery
  - Subdirectories to configurable depth (default 1) containing `openspec/changes` with at
    least one eligible change; reuse `nearbyOpenspecRepos` and `resolveQueue`
  - Validation: fixture tree with openspec repos, non-repos, a hidden directory, a
    fully-drained repo and a fully-quarantined repo — only the eligible ones are in scope

- [ ] 2.2 Implement repo ordering
  - Explicit list, then configured priority, then least-recently-attempted, then name
  - Least-recently-attempted derives from the newest `loop/<slug>` branch commit date,
    falling back to the oldest eligible change's `created`
  - Validation: unit tests per tier, including the starvation case — a repo with
    continuously available work does not prevent another from ever being attempted

- [ ] 2.3 Report the resolved scope before the first repo starts
  - Validation: the scope, the already-drained repos and the excluded ones are all named

## Phase 3: The driver

- [ ] 3.1 Implement the scheduler over existing per-repo runs
  - Creates ordinary queue runs (design D1) and watches `loop.updated`; does not
    reimplement gates, quarantine or completion
  - Validation: integration test with a mock LLM driving a two-repo fixture to completion

- [ ] 3.2 Implement capacity-bounded concurrency
  - min(configured max, local providers with free capacity), floor 1, re-evaluated as each
    repo starts; probe via `LocalPlacement`/`capacity.ts`
  - Validation: tests with a stubbed capacity source — two idle providers caps at two; no
    idle providers runs serial; never more than one run per repository

- [ ] 3.3 Implement failure isolation and the workspace systemic guard
  - A halted repo is recorded and the run continues; three consecutive halts with no gate
    passing anywhere stops the run with a suspected environmental cause
  - Validation: test both — one bad repo among five, and three identically broken repos

- [ ] 3.4 Implement cancellation
  - Cancelling the workspace run cancels every per-repo run it started
  - Validation: test — after cancel, no queue run for any of its repos remains live

- [ ] 3.5 Confirm the authority ceiling is inherited and not widened
  - Validation: test asserting each per-repo run carries the deny profile, plus an
    adversarial case that the workspace layer adds no allow rule of its own

## Phase 4: Report

- [ ] 4.1 Implement the aggregated report
  - Per repo: completed, quarantined with cause, branches awaiting review, sync outcome,
    halt cause; separating repos this run attempted from those already drained
  - Validation: snapshot tests for a fully drained run, a run with a halted repo, and a
    run stopped by the systemic guard

- [ ] 4.2 Surface it in the TUI and CLI on run end
  - Validation: manual — the report is readable after an unattended run without opening
    individual loop records

## Phase 5: Surfaces

- [ ] 5.1 CLI: `opencode loop --workspace [<repo>...]`
  - Validation: `opencode loop --help` documents workspace mode and that it never pushes

- [ ] 5.2 TUI: Auto in a workspace directory starts a workspace run
  - Repo directory keeps starting a single-repo run; the standing instruction applies to
    every repo; leaving Auto stops the workspace run and all of its per-repo runs
  - Validation: unit test on the mode-reconcile logic for the workspace case, mirroring
    the existing `auto-mode-reconcile` tests

- [ ] 5.3 Show workspace progress in the loops dialog and the status pill
  - Which repo is being worked, and how many of the scope remain
  - Validation: manual

## Phase 6: End-to-end verification

- [ ] 6.1 Two-repo fixture workspace drains to completion with a mock LLM
  - Validation: both repos complete, branches created in each, nothing pushed

- [ ] 6.2 Halt path end-to-end
  - Validation: one repo halts on a misconfigured gate, the other completes, and the
    report names both outcomes

- [ ] 6.3 Restart resume
  - Kill the server mid-run; restart; start the workspace run again
  - Validation: already-drained repos are skipped and no work is repeated

- [ ] 6.4 Real unattended run against this machine's own workspace
  - Target a small set of real repos rather than all of them on the first run
  - Validation: run completes or halts with a legible report; no push occurred; every
    touched repo's default branch untouched
  - Expect this to find something the tests did not — every previous phase of the queue
    work did (repair turns, gate cwd, blocker poisoning), and a real run is the only place
    those surfaced

- [ ] 6.5 Full typecheck, test, build
  - Validation: `bun run typecheck` zero errors; `bun test test/loop/` green;
    single-target build smoke-passes
