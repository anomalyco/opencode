# Tasks: workspace-queue

Depends on `loop-spec-queue` (implemented). Phase 1 is load-bearing: without per-repo gate
configuration a run halts on nearly every repository, so nothing after it is worth
building until 1.x is green.

Phase 2 is a dependency on the **specsync** repo, not work here. The contract is written
down so both sides can be built independently, and the disk fallback (Phase 3) keeps this
change useful before it lands.

## Phase 1: Per-repo gate configuration

- [ ] 1.1 Determine how a run gets its repository's configuration
  - `Config` is instance-scoped, so `config.get()` answers for the instance's directory
    (design D5). Establish whether a run can be created in another repository's
    workspace/instance context using the `WorkspaceRoutingMiddleware` already present on
    the loop endpoints
  - Record the finding in design.md before writing code; if per-instance creation is
    impractical, take the documented fallback (read `<repo>/opencode.json` for gate options
    only) and say so explicitly
  - Validation: a written finding in design.md, plus a spike proving a run in repo B reads
    repo B's `experimental.queue_gate`

- [ ] 1.2 Implement per-repo gate resolution: repository config, then built-in defaults
  - Validation: unit test with two fixture repos declaring different test commands — each
    resolves its own, and a repo declaring none uses the built-ins

- [ ] 1.3 Prove the failure this phase exists to prevent
  - Validation: a two-repo fixture where the gate config is right for one repo and wrong
    for the other — the correct repo completes rather than both halting

## Phase 2: The specsync contract (external repo)

- [ ] 2.1 Agree and document the query contract
  - `specsync <query> -json` emits an ordered array, most claimable first, each entry
    naming the repository path, change slug, tracker item, and why it is claimable.
    Ordering is the tracker's; opencode does not re-sort
  - Claimable means: right stage, no open blocking dependency, not already in progress
  - Validation: the contract is written in design.md and agreed with the specsync side

- [ ] 2.2 Cross-repository aggregation in specsync
  - specsync already resolves bindings and stages per repository (`changes -json` exposes
    stage, priority and progress today); the gap is answering across repositories
  - Validation: one invocation returns claimable work spanning more than one repository

- [ ] 2.3 Claim and release through specsync
  - Transition an item to in-progress and back, so two runners cannot take the same work
  - Validation: a claimed item is not returned to a second caller

## Phase 3: The runner

- [ ] 3.1 Implement the work-source client with the disk fallback
  - Ask specsync; where a repository has no binding, fall back to its openspec changes.
    No configuration selects between them — the presence of a binding does
  - Validation: tests for both paths, and that a synced repository is not also picked up
    by the fallback

- [ ] 3.2 Resolve an item to a repository and change, or skip it with a reason
  - Validation: test — a resolvable item starts a run; an item naming a repository absent
    from this machine is skipped and reported

- [ ] 3.3 Drive the existing per-repository run
  - Creates ordinary runs (design D1) and watches `loop.updated`; does not reimplement
    gates, quarantine or completion
  - Validation: integration test with a mock LLM driving two fixture repositories

- [ ] 3.4 Capacity-bounded concurrency
  - min(local providers with free capacity), floor 1, re-evaluated as each item starts;
    probe via `LocalPlacement`/`capacity.ts`; never two runs for one repository
  - Validation: tests with a stubbed capacity source for each of those three rules

- [ ] 3.5 Failure isolation and the environmental guard
  - A halted item is recorded and released and the run continues; several consecutive
    halts with no gate passing anywhere stops the run with a suspected environmental cause
  - Validation: test both — one bad item among five, and three identically broken ones

- [ ] 3.6 Cancellation
  - Cancelling stops every per-repository run it started and releases their claims
  - Validation: test — after cancel, no run remains live and no item remains in progress

- [ ] 3.7 Confirm the authority ceiling is inherited and not widened
  - Validation: test that each run carries the deny profile, plus an adversarial case that
    this layer adds no allow rule of its own

## Phase 4: Report

- [ ] 4.1 Aggregated report
  - Per item: repository and change, outcome, halt cause, branches awaiting review, and
    skipped items with the reason
  - Validation: snapshot tests for a drained run, a run with a halted item, and a run
    stopped by the environmental guard

- [ ] 4.2 Distinguish "drained" from "found nothing"
  - Validation: test — no work source and no openspec anywhere reports nothing found, not
    work complete

## Phase 5: Surfaces

- [ ] 5.1 `/auto` uses the work source when there is one
  - Inside a repository with a binding, and from a workspace directory, `/auto` works
    planned items rather than only the local openspec tree
  - Validation: manual — `/auto` in a workspace directory works items across repositories

- [ ] 5.2 CLI parity
  - Validation: `opencode loop --help` documents that auto never pushes and where its work
    comes from

- [ ] 5.3 Show progress in the work dialog and the status indicator
  - Which repository and change is being worked, and how much remains
  - Validation: manual

## Phase 6: End-to-end verification

- [ ] 6.1 Two-repository fixture drains to completion with a mock LLM
  - Validation: both complete, branches created in each, nothing pushed

- [ ] 6.2 Halt path end-to-end
  - Validation: one repository halts on a misconfigured gate, the other completes, and the
    report names both

- [ ] 6.3 Restart resume
  - Kill the server mid-run; restart; run again
  - Validation: already-complete work is skipped and nothing is repeated

- [ ] 6.4 Real unattended run against this machine's own repositories
  - Target a small set first rather than everything
  - Validation: completes or halts with a legible report; no push; every touched
    repository's default branch untouched
  - Expect this to find something the tests did not. Every previous phase of this work did
    — repair turns, gate cwd, blocker poisoning — and each surfaced only in a real run

- [ ] 6.5 Full typecheck, test, build
  - Validation: `bun run typecheck` zero errors; `bun test test/loop/` green; single-target
    build smoke-passes
