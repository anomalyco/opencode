# Tasks: persona-gate-fanout

Depends on `repo-agent-personas` for the agents to exist.

## Phase 1: Gate-to-persona bindings

- [x] 1.1 Add `experimental.queue_personas: Record<string, string | false>` to the config schema
  - Defaults: `implement → coder`, `test → tester`, `verify → reviewer`
  - Validation: `bun run typecheck`
  - Done 2026-08-06 in `packages/core/src/v1/config/config.ts`.
- [x] 1.2 Resolve bindings against the agent registry at run start
  - Present → bound; absent from config and registry → gate unchanged; named but missing → error
  - Validation: unit test over the three outcomes
  - Done 2026-08-06: `spec-queue/personas.ts` (`resolvePersonas`), pure and import-free
    like `gates.ts`, so the driver supplies the registry. 6 unit tests.

## Phase 2: The brief names the persona

- [x] 2.1 Thread the resolved binding for the current gate into `buildBrief`
- [x] 2.2 Replace the generic fan-out sentence with one naming the gate's agent
  - Still gated on `idlePeers.length > 0`, now also on the binding resolving
  - Validation: brief tests for named / no-agent / no-idle-peer
  - Done 2026-08-06. The nudge now says `subagent_type "coder"` and adds "one call per
    independent slice, keep work that shares a file in one call".

## Phase 3: Agent gates

- [x] 3.1 Add an agent-gate kind alongside command gates in `gates.ts`
  - Same pass/fail shape so strike counting, repair turns and quarantine are untouched
  - Done 2026-08-06 as `AgentGates` + `runAgentGate` in the driver; the gate's result is
    the same `{passed, output}` shape, so `fail()` is unchanged.
- [x] 3.2 Run the bound subagent via the `task` path, carrying the run's authority ceiling
  - Give it the change, `tasks.md`, and the diff
  - Done 2026-08-06. Child session of the running one, so its parts render inline where
    the user is already looking. Permission is `deriveSubagentSessionPermission` (parent
    denies + external_directory + todowrite/task denies) PLUS the persona's own denies,
    put on the session rather than left to agent selection alone.
- [x] 3.3 Parse the verdict; anything unrecognisable, errored, or timed out fails the gate
  - Validation: unit tests for pass, fail-with-findings, error, timeout, garbage
  - Done 2026-08-06: `readVerdict`. Only the last 400 characters are authoritative, so a
    review that quotes its own instructions and then concludes is read by its conclusion.
- [x] 3.4 Carry fail verdict text into the next brief as the failure detail
- [x] 3.5 Bind `verify` to the reviewer by default
  - Also: agent-bound gates are excluded from the suspect-misconfigured-gate heuristic. A
    reviewer that says NEEDS_WORK three times is working; only a command that never
    succeeded once is suspect.

## Phase 4: Verification

- [x] 4.1 Queue-mode test: a failing review gate produces a repair turn, not an advance
  - Asserts the verdict text reaches a later prompt body, and that the run is NOT
    reported as a suspected misconfiguration
- [x] 4.2 Queue-mode test: a reviewer subagent's session denies write and edit
- [x] 4.3 Queue-mode test: a binding to a missing agent halts at start with a clear reason
  - Asserts zero LLM calls — nothing is attempted
- [x] 4.4 `bun test test/loop/ --timeout 90000` and `bun run typecheck` clean
  - 135/135 loop tests pass; workspace typecheck clean
- [ ] 4.5 Live run of `/auto` on a real change; confirm the reviewer's parts render inline
