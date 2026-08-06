# Tasks: steer-running-subagent

## Phase 1: Find the live children

- [ ] 1.1 Add a lookup for live subagent sessions of a given parent
  - Children of `sessionID` whose background job or run state is live
  - Return session id, agent name, task description
  - Validation: unit test over live / finished / no children

## Phase 2: Deliver a steer

- [ ] 2.1 Add a `session.steer({ sessionID, target, text })` server route
  - Resolves the target among live children only; never falls back to the parent
  - Delivers via the same `background.extend` path the `task` tool uses for `task_id`
  - Reports delivery, not completion
  - Validation: unit test for single target, ambiguous target, unknown target
- [ ] 2.2 Expose it on the SDK client
  - Validation: `bun run typecheck`

## Phase 3: `/nudge` in the TUI

- [ ] 3.1 Intercept `/nudge` in the prompt with exact-verb matching
  - Follows the `isLoopCommand` pattern so `/nudged the thing` is still a message
- [ ] 3.2 No arguments, or an unresolvable target → render the live-children listing
- [ ] 3.3 Add `/nudge` to `isRunControlInput` so it never cancels a running loop
  - Validation: TUI test that a loop survives `/nudge`

## Phase 4: Verification

- [ ] 4.1 Test: a steer reaches a mid-turn child after its turn completes
- [ ] 4.2 Test: `/btw` still answers from context and delivers nothing to a subagent
- [ ] 4.3 `bun test` and `bun run typecheck` clean
- [ ] 4.4 Live check during an `/auto` fan-out
