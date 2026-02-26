# Codex Queue/Steer Architecture Analysis

> Deep-dive into OpenAI Codex CLI's queue/steer mechanism for mid-turn user interaction.
> Source: `references/codex/` submodule

---

## Overview

Codex implements a **dual-input model** that lets users interact with the agent **during** an active turn, not just between turns:

| Action | Keybinding | Behavior | When Turn Active |
|--------|-----------|----------|-----------------|
| **Queue** | `Enter` | Enqueue message for next turn boundary | Message waits in queue, displayed in UI |
| **Steer** | `⌘Enter` / `Enter` (steer-mode) | Inject input into active turn immediately | Message sent to model in current context |

---

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│  TUI Layer (tui/src/)                           │
│  ┌─────────────────────────────────────────┐    │
│  │ ChatComposer                            │    │
│  │  Enter → InputResult::Submitted (steer) │    │
│  │  Tab   → InputResult::Queued            │    │
│  └─────────────────┬───────────────────────┘    │
│                     │                            │
│  ┌─────────────────▼───────────────────────┐    │
│  │ QueuedUserMessages widget               │    │
│  │  Shows queued messages with "↳" prefix  │    │
│  │  Alt+Up to pop back into composer       │    │
│  └─────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  App Server Protocol (app-server-protocol/)     │
│                                                  │
│  turn/start  → TurnStartParams  (new turn)      │
│  turn/steer  → TurnSteerParams  (mid-turn)      │
│                                                  │
│  TurnSteerParams {                               │
│    thread_id: String,                            │
│    input: Vec<UserInput>,                        │
│    expected_turn_id: String,  // guard            │
│  }                                               │
│                                                  │
│  TurnSteerResponse {                             │
│    turn_id: String,  // confirms active turn     │
│  }                                               │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  App Server (app-server/src/)                   │
│  codex_message_processor.rs                     │
│                                                  │
│  async fn turn_steer(&self, req_id, params) {   │
│    let thread = load_thread(params.thread_id);  │
│    thread.steer_input(                          │
│      mapped_items,                              │
│      Some(&params.expected_turn_id)             │
│    );                                           │
│    // Returns turn_id or error:                  │
│    // "no active turn to steer"                  │
│  }                                               │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Core Engine (core/src/codex.rs)                │
│                                                  │
│  Session::steer_input(input, expected_turn_id)  │
│    1. Validate input not empty                   │
│    2. Lock active_turn mutex                     │
│    3. Verify active turn exists                  │
│    4. Check expected_turn_id matches             │
│    5. Lock turn_state                            │
│    6. push_pending_input(input)  ← KEY STEP     │
│    7. Return active turn_id                      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Turn State (core/src/state/turn.rs)            │
│                                                  │
│  struct TurnState {                              │
│    pending_input: Vec<ResponseInputItem>,        │
│  }                                               │
│                                                  │
│  push_pending_input(item) → appends to vec      │
│  take_pending_input()     → drains vec           │
│  has_pending_input()      → checks non-empty     │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Task Loop (core/src/codex.rs ~L4970)           │
│                                                  │
│  loop {                                          │
│    // At each iteration, drain pending input     │
│    let pending = sess.get_pending_input().await; │
│    if !pending.is_empty() {                      │
│      // Record as conversation items             │
│      // → injected into model context            │
│      for item in pending {                       │
│        record_user_prompt_and_emit_turn_item();  │
│      }                                           │
│    }                                             │
│    // ... send to model, process response ...    │
│    // On ResponseEvent::Completed:               │
│    needs_follow_up |= has_pending_input();       │
│    // If follow_up needed → loop continues       │
│  }                                               │
└─────────────────────────────────────────────────┘
```

---

## Core Mechanism: `steer_input`

The heart of steer is `Session::steer_input()` in `core/src/codex.rs`:

```rust
pub async fn steer_input(
    &self,
    input: Vec<UserInput>,
    expected_turn_id: Option<&str>,
) -> Result<String, SteerInputError> {
    if input.is_empty() {
        return Err(SteerInputError::EmptyInput);
    }
    let mut active = self.active_turn.lock().await;
    let Some(active_turn) = active.as_mut() else {
        return Err(SteerInputError::NoActiveTurn(input));
    };
    let Some((active_turn_id, _)) = active_turn.tasks.first() else {
        return Err(SteerInputError::NoActiveTurn(input));
    };
    if let Some(expected_turn_id) = expected_turn_id
        && expected_turn_id != active_turn_id
    {
        return Err(SteerInputError::ExpectedTurnMismatch {
            expected: expected_turn_id.to_string(),
            actual: active_turn_id.clone(),
        });
    }
    let mut turn_state = active_turn.turn_state.lock().await;
    turn_state.push_pending_input(input.into());
    Ok(active_turn_id.clone())
}
```

### Key Design Decisions

1. **Non-blocking injection**: `steer_input` just pushes to a `Vec<ResponseInputItem>` — it doesn't interrupt or cancel the model. The model's active response completes naturally.

2. **Consumption at loop boundary**: The task loop checks `pending_input` at the **top of each iteration**. After the model finishes a response, if pending input exists, it gets recorded as conversation items and the model is called again with the updated context.

3. **`needs_follow_up` flag**: When a model response completes (`ResponseEvent::Completed`), if there's pending input, the loop sets `needs_follow_up = true` and continues instead of ending the turn.

4. **Turn ID validation**: The `expected_turn_id` field prevents race conditions — the steer request fails if the turn has changed between the user pressing Enter and the server processing the request.

---

## Error Types

```rust
pub enum SteerInputError {
    NoActiveTurn(Vec<UserInput>),      // No model turn running
    ExpectedTurnMismatch {              // Turn changed since request
        expected: String,
        actual: String,
    },
    EmptyInput,                         // Nothing to inject
}
```

When `NoActiveTurn` occurs, the app-server falls back — the input that failed to steer gets queued for the next `turn/start`.

---

## Queue vs Steer: Detailed Comparison

### Queue (Tab / Enter in legacy mode)

1. User types message, presses Tab (or Enter in non-steer mode)
2. TUI returns `InputResult::Queued { text, text_elements }`
3. Message stored in `QueuedUserMessages.messages: Vec<String>`
4. Rendered in UI with `↳` prefix, dimmed/italic
5. User can pop with Alt+Up to edit
6. When current turn completes → queued messages become the next `turn/start`

### Steer (Enter in steer mode / ⌘Enter)

1. User types message, presses Enter
2. TUI returns `InputResult::Submitted { text, text_elements }`
3. App sends `turn/steer` RPC to server
4. Server calls `thread.steer_input()` → pushes to `pending_input`
5. Model's current response continues to completion
6. At next task loop iteration, pending input is drained and recorded
7. Model sees the user's steer message in context → generates follow-up
8. **All within the same turn** — no new turn boundary

### Critical Difference

| Aspect | Queue | Steer |
|--------|-------|-------|
| **Timing** | After turn ends | During active turn |
| **Turn boundary** | Creates new turn | Same turn continues |
| **Model sees it** | On next turn start | At next loop iteration |
| **Cancels response** | No (waits) | No (appends to context) |
| **UI display** | Queued messages widget | Injected into chat transcript |
| **Fallback** | N/A | Falls back to queue if no active turn |

---

## Turn Lifecycle with Steer

```
Turn Start (user submits prompt)
  │
  ├─→ Model generates response...
  │     │
  │     │  ← User presses Enter (steer)
  │     │     → steer_input() pushes to pending_input
  │     │
  │     ▼
  │   Response completes
  │     │
  │     ├─→ has_pending_input()? YES
  │     │     → needs_follow_up = true
  │     │
  │     ▼
  │   Loop continues → drain pending_input
  │     → Record steered message as conversation item
  │     → Model sees: [original prompt, response, steered message]
  │     → Model generates new response with full context
  │     │
  │     ├─→ has_pending_input()? NO
  │     │     → needs_follow_up = false
  │     ▼
  │   Turn Complete
  │
  └─→ Queued messages (if any) → next turn/start
```

---

## Turn Completion & Leftover Input

When a task finishes (`task_finished()` in `core/src/tasks/mod.rs`):

```rust
// 1. Lock active turn
let mut active = self.active_turn.lock().await;
// 2. Take any remaining pending input
let pending_input = ts.take_pending_input();
// 3. Clear active turn
*active = None;
// 4. Record leftover input as conversation items
if !pending_input.is_empty() {
    record_conversation_items(&turn_context, &pending_response_items);
}
// 5. Emit TurnComplete event
```

This ensures steered input is **never lost** — even if the turn ends before the pending input could be consumed by the model loop.

---

## Feature Flag: `steer_enabled`

Steer is gated behind `Feature::Steer` in the TUI:

```rust
// When steer_enabled == true:
//   Enter → Submitted (steer immediately)
//   Tab   → Queued (wait for turn end)
//
// When steer_enabled == false (legacy):
//   Enter → Queued
//   Tab   → Queued
```

---

## Implications for OpenCode

### What OpenCode Currently Has
- Session/turn model with `processor.ts` handling model interaction
- Parallel agents via `task.ts` tool
- No mid-turn input injection

### What Queue/Steer Would Add
1. **Pending input buffer** on the session/turn state
2. **Steer RPC** that pushes to the buffer while model is running
3. **Loop-boundary drain** that checks for pending input after each model response
4. **Follow-up continuation** instead of ending the turn when input is pending
5. **UI queue widget** showing messages waiting for the current turn to finish
6. **Fallback path**: steer → queue if no active turn

### Key Implementation Points
- `steer_input()` is a **lock-based, non-cancelling** approach — it doesn't abort the model stream
- Pending input is consumed at the **top of the agentic loop**, not mid-stream
- The model sees steered input as additional conversation items on its next iteration
- `expected_turn_id` prevents stale steer requests from affecting wrong turns
- Queued messages are a purely UI-side concept until they become a `turn/start`

---

## References

- Protocol types: `codex-rs/app-server-protocol/src/protocol/v2.rs`
- Core steer: `codex-rs/core/src/codex.rs` (L3377-3406)
- Turn state: `codex-rs/core/src/state/turn.rs` (L77-163)
- Task loop drain: `codex-rs/core/src/codex.rs` (L4970-5000)
- Follow-up flag: `codex-rs/core/src/codex.rs` (L6364)
- Task completion: `codex-rs/core/src/tasks/mod.rs` (L190-230)
- App server handler: `codex-rs/app-server/src/codex_message_processor.rs`
- TUI queue widget: `codex-rs/tui/src/bottom_pane/queued_user_messages.rs`
- TUI composer: `codex-rs/tui/src/public_widgets/composer_input.rs`
