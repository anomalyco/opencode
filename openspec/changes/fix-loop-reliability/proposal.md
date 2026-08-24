# Fix loop reliability with per-iteration sessions and adaptive continuation

## Why

The `/loop` feature is supposed to act as an autonomous continuation driver — the
user writes `/loop please keep working` and the model keeps making progress until
it signals done. In practice three compounding problems make it unreliable:

**1. Same session for every iteration (design defect, never fixed)**
The original spec (tui-loop-command D3) required each iteration to create a child
session of a loop-parent session. The implementation reused the same session instead.
This means every iteration injects the continuation prompt into an ever-growing
conversation: after 10 iterations the model has 20+ messages of prior loop context
in its window. The model sees its own previous iterations, gets confused about
where it is in the task, and starts repeating itself or contradicting prior work.

**2. Static continuation prompt regardless of previous iteration outcome**
Every iteration sends `record.info.prompt` verbatim — the same string the user typed.
If the model "stalled" (announced a plan, then did nothing — zero tool calls, short
output), the next prompt says nothing useful about why it's being called again. The
model re-reads its own "I'll look at those files" turn and produces an identical
stall. A directive nudge based on what actually happened ("You described a plan but
used no tools — please execute it now") would break the cycle.

**3. Pause fiber busy-polls at 500ms**
When a loop is paused, the `run` fiber loops every 500ms checking a Ref, burning
scheduler capacity for as long as the loop stays paused. A `Deferred` that `resume`
resolves would block the fiber at zero cost and wake it instantly.

## What Changes

### 1. Per-iteration child sessions
Create one **loop-parent session** per loop (existing behavior). For each iteration,
create a **fresh child session** (`session.create({ parentID: loopParentID })`) rather
than re-prompting into the parent. The child inherits the parent's permissions and
agent, runs its LLM interaction, and is left in the history for navigation.

The continuation prompt is injected into the child, not the parent, so:
- The child starts with a clean context window (just the continuation prompt + system
  prompt — no accumulated loop history)
- The parent session becomes a navigation anchor: all child sessions are visible
  in the TUI session list under the parent
- Context never grows across iterations (the compaction problem is gone by design)

The `Info.sessionID` remains the parent session for UI/loop identification. A new
`Info.iterationSessionID` field records the most recent child session, if the caller
needs to navigate to it.

### 2. Adaptive continuation prompt
`runIteration` receives the previous iteration's outcome and selects the prompt text:

| Previous outcome | Injected prompt |
|---|---|
| No previous (first iteration) | `record.info.prompt` as typed |
| Tool calls made, output non-empty | `record.info.prompt` as typed (normal continue) |
| Zero tool calls, short output (stall) | Directive: `"Your previous response described a plan but used no tools. Execute the plan now — start with your first tool call."` |
| Zero tool calls, empty output | Directive: `"Your previous response was empty. Please continue the task with tool calls."` |
| Tool calls made but near-identical output (spinning) | `"You appear to be repeating the same actions. Step back, reassess, and take a different approach."` |

The user-supplied prompt always forms the first message. The directive augments
it in later iterations only, so the model always knows the original goal.

### 3. Replace pause busy-poll with Deferred
Add a `pauseGate: Deferred.Deferred<void>` to the loop `Record_` type. When a loop
transitions to `paused`, `pause()` makes a new Deferred and stores it. The `run`
fiber awaits the Deferred instead of polling. When `resume()` is called, it resolves
the Deferred, waking the fiber immediately.

## Capabilities Modified

- `loop-service`: iteration architecture (per-session children), adaptive prompt,
  pause efficiency.

## Non-Goals

- Durable loop state across server restarts (separate follow-up).
- Changing the COMPLETE signal contract or the noProgressLimit stall detection.
- Modifying the CLI `follow()` polling (separate improvement; bounded by iteration
  count now).
- Changing `maxIterations`, `noProgressLimit` defaults (already fixed in 272beedad).
