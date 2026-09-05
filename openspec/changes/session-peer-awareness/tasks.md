# Tasks: session-peer-awareness

Builds on `fleet-instance-presence`, which already landed the presence record type,
status derivation, and `GET /agents`. Nothing new is discovered or transported here.

## Phase 1: Compute the roster

- [x] 1.1 Add a peer resolver: sessions in a directory that are actually working
  - Sources: `session.list()`, `SessionStatus.list()`, `permission.list()`, `loop.list()`
  - Active means busy, awaiting-permission, stalled, or driven by a live loop
  - Validation: unit tests for active / idle / other-directory
  - Done 2026-08-07: `src/session/peers.ts`, pure like `gates.ts` and `personas.ts` so the
    caller supplies the four sources. 13 unit tests.
- [x] 1.2 Exclude the caller and its whole descendant lineage
  - Walk `parentID` upward; a session whose ancestry reaches the caller is not a peer
  - Validation: unit tests for self, own subagent, sibling's subagent
  - Done 2026-08-07. Also terminates on a parent cycle — this runs on every queue
    iteration, so an inconsistent store must not hang it.

## Phase 2: The tool

- [x] 2.1 Add a `peers` tool returning the roster with id, title, status, agent, model, loop, idle age
  - Metadata only — no message text, prompt, tool call or tool output is reachable
  - Validation: unit test over a populated and an empty roster
  - Done 2026-08-07. An empty roster returns a sentence saying so, not a blank that reads
    like a failure.
  - Known limit: the tool passes no loop state. `Loop` depends on the prompt layer, which
    depends on the tool registry, so importing it from a tool closes a cycle. A
    loop-driven session is busy while it works, so status alone is accurate in practice;
    the queue brief runs inside the loop and passes the real thing.
- [x] 2.2 Register it and give it a description that says when to call it
  - Validation: `bun run typecheck`
  - Done 2026-08-07. The registry now needs `SessionStatus` and `Permission`, added to its
    layer and node graph.

## Phase 3: The brief

- [x] 3.1 Thread active peers into `buildBrief`
  - Resolved inside the loop service, so it sees live loop state the tool cannot
- [x] 3.2 Add a neighbour paragraph, suppressed when there are none
  - Validation: brief tests for peers present / absent / field omitted entirely
- [x] 3.3 Confirm a run is not blocked by an active neighbour
  - By construction: `activePeers` feeds `buildBrief` and nothing else — there is no
    branch anywhere that acts on the roster. Awareness, not enforcement; enforcement is
    `agent-worktree-isolation`'s job.

## Phase 4: Verification

- [x] 4.1 `bun test test/loop/ test/agent/ test/session/ test/tool/` and `bun run typecheck` clean
  - 851 pass. The 9 failures in `test/session/` (5 llm payload, 2 subtask metadata, cancel
    propagation, shell completion) were confirmed pre-existing by running the same suite in
    a clean worktree at HEAD — this change adds none.
  - Fixed in passing: `test/tool/__snapshots__/parameters.test.ts.snap` never contained the
    fork's `provider` param on the `task` tool, so that snapshot had been failing.
- [x] 4.2 Live check: two sessions in one repo, each able to see the other
  - Done 2026-09-05, and it found a real bug: `peers` was constructed in
    `tool/registry.ts`'s `Effect.all({...})` object and given a node-graph layer
    (task 2.2), but was never added to the separate, hand-maintained `builtin`
    array that `ToolRegistry.all()`/`.tools()` actually exposes to the model —
    so despite passing every unit test and typechecking cleanly, no real model
    could ever call it. This had been sitting unverified since 2026-08-07
    because this exact task was left unchecked. Fixed alongside the same bug
    in `send_peer_message` (see `peer-messaging`); both added to `builtin` in
    `packages/opencode/src/tool/registry.ts`.
  - Validation: `packages/opencode/test/session/prompt.test.ts` — "peers tool
    is reachable by the model and reports another active session" — a real
    model turn (via `TestLLMServer`) calls `peers` through the actual
    `ToolRegistry`/`SessionTools.resolve` path and asserts the other session
    appears in its output. Not a mock of the tool — the real registered tool.

## Note: an import cycle this uncovered

`session/peers.ts` needs the status derivation from `agent/presence.ts`, which imports
`Loop` for its schema — and the loop imports peers. That closed a cycle at module-init
time, which surfaces as `Cannot access 'defaultLayer' before initialization` and every loop
test erroring before it runs, not as a compile error. The derivation now lives in
`agent/presence-status.ts`, a leaf with no imports, taking the loop structurally
(`{ status }`) rather than as `Loop.Info` — depending on the whole type would re-close it.
