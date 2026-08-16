export * as SessionBudgetEvent from "./session-budget-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

// D3: budget and overflow observability. Emitted at the engine's context
// arithmetic decision points so consumers (routers, acceptance suites) can
// count thrash and clamps from the bus instead of scraping logs.

// The engine detected that reported usage crossed the usable window and is
// about to act. `tokens` is the provider-reported count that tripped the
// check, `usable`/`reserve` mirror the context-budget endpoint semantics.
export const OverflowDetected = Event.define({
  type: "session.overflow.detected",
  schema: {
    sessionID: SessionID,
    tokens: Schema.Finite,
    usable: Schema.Finite,
    reserve: Schema.Finite,
    action: Schema.Literals(["compact"]),
  },
})

// C6's window-aware clamp reduced the request's output budget below what was
// configured/requested.
export const OutputClamped = Event.define({
  type: "session.output.clamped",
  schema: {
    sessionID: SessionID,
    requested: Schema.Finite,
    granted: Schema.Finite,
  },
})

// B4's structural doom-loop stop removed a tool from the session's next
// requests.
export const ToolStripped = Event.define({
  type: "session.tool.stripped",
  schema: {
    sessionID: SessionID,
    tool: Schema.String,
  },
})

export const Definitions = Event.inventory(OverflowDetected, OutputClamped, ToolStripped)
