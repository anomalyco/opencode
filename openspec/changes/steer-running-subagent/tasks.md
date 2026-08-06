# Tasks: steer-running-subagent

See `design.md` for why delivery is mid-turn and not "after the turn" — the first version
of this plan was wrong and the two ways it was wrong are worth reading before starting.

## Phase 1: The steer channel

- [ ] 1.1 Add a per-instance pending-steer store keyed by session
  - `InstanceState` map `SessionID → string[]`, with a `drain(sessionID)` that empties it
  - Validation: unit test for push/drain/empty
- [ ] 1.2 Drain pending steers at the top of the step loop in `prompt.ts`
  - Persist each as a `SessionV1.User` message with a text part, before the message list is
    rebuilt — same construction as the subtask summary message at `prompt.ts:436`
  - One known delivery point, so a steer is "this step" or "next step", never lost to a race
  - Validation: unit test that a steer pushed mid-turn appears in the next model call's messages
- [ ] 1.3 Do NOT deliver via `session.prompt` on a busy session
  - `Runner.ensureRunning` joins the in-flight run and discards the work — silent loss
  - Validation: a test asserting the busy path is not used

## Phase 2: Find the live children

- [ ] 2.1 Add a lookup for live subagent sessions of a given parent
  - Children of `sessionID` whose runner is busy
  - Return session id, agent name, task description
  - Validation: unit test over live / finished / no children

## Phase 3: Route and SDK

- [ ] 3.1 Add a `session.steer({ sessionID, target, text })` route
  - Resolves the target among live children only; never falls back to the parent
  - Pushes onto the pending-steer store; reports delivery, not completion
  - Validation: unit test for single target, ambiguous target, unknown target
- [ ] 3.2 Regenerate the SDK
  - Note: the generator reformats the whole repo — regenerate on a clean tree and review
    the diff before committing
  - Validation: `bun run typecheck`

## Phase 4: `/nudge` in the TUI

- [ ] 4.1 Intercept `/nudge` in the prompt with exact-verb matching
  - Follows the `isLoopCommand` pattern so `/nudged the thing` is still a message
- [ ] 4.2 No arguments, or an unresolvable target → render the live-children listing
- [ ] 4.3 Add `/nudge` to `isRunControlInput` so it never cancels a running loop
  - Validation: TUI test that a loop survives `/nudge`

## Phase 5: Verification

- [ ] 5.1 Test: a steer reaches the agent's next model call within the same turn
- [ ] 5.2 Test: `/btw` still answers from context and delivers nothing to a subagent
- [ ] 5.3 `bun test` and `bun run typecheck` clean
- [ ] 5.4 Live check during an `/auto` fan-out
