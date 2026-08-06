# Tasks: persona-gate-fanout

Depends on `repo-agent-personas` for the agents to exist.

## Phase 1: Gate-to-persona bindings

- [ ] 1.1 Add `experimental.queue_personas: Record<string, string | false>` to the config schema
  - Defaults: `implement → coder`, `test → tester`, `verify → reviewer`
  - Validation: `bun run typecheck`
- [ ] 1.2 Resolve bindings against the agent registry at run start
  - Present → bound; absent from config and registry → gate unchanged; named but missing → error
  - Validation: unit test over the three outcomes

## Phase 2: The brief names the persona

- [ ] 2.1 Thread the resolved binding for the current gate into `buildBrief`
- [ ] 2.2 Replace the generic fan-out sentence with one naming the gate's agent
  - Still gated on `idlePeers.length > 0`, now also on the binding resolving
  - Validation: brief tests for named / no-agent / no-idle-peer

## Phase 3: Agent gates

- [ ] 3.1 Add an agent-gate kind alongside command gates in `gates.ts`
  - Same pass/fail shape so strike counting, repair turns and quarantine are untouched
- [ ] 3.2 Run the bound subagent via the `task` path, carrying the run's authority ceiling
  - Give it the change, `tasks.md`, and the diff
- [ ] 3.3 Parse the verdict; anything unrecognisable, errored, or timed out fails the gate
  - Validation: unit tests for pass, fail-with-findings, error, timeout, garbage
- [ ] 3.4 Carry fail verdict text into the next brief as the failure detail
- [ ] 3.5 Bind `verify` to the reviewer by default

## Phase 4: Verification

- [ ] 4.1 Queue-mode test: a failing review gate produces a repair turn, not an advance
- [ ] 4.2 Queue-mode test: a reviewer subagent's session denies write and edit
- [ ] 4.3 Queue-mode test: a binding to a missing agent halts at start with a clear reason
- [ ] 4.4 `bun test test/loop/ --timeout 90000` and `bun run typecheck` clean
- [ ] 4.5 Live run of `/auto` on a real change; confirm the reviewer's parts render inline
