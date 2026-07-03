export * as TuiEvent from "./tui-event.js"

import { Effect, Schema } from "effect"
import { optional } from "./schema.js"
import { Event } from "./event.js"
import { PositiveInt } from "./schema.js"
import { SessionID } from "./session-id.js"

const DEFAULT_TOAST_DURATION = 5000

export const PromptAppend = Event.ephemeral({ type: "tui.prompt.append", schema: { text: Schema.String } })

export const CommandExecute = Event.ephemeral({
  type: "tui.command.execute",
  schema: {
    command: Schema.Union([
      Schema.Literals([
        "session.list",
        "session.new",
        "session.share",
        "session.interrupt",
        "session.background",
        "session.compact",
        "session.page.up",
        "session.page.down",
        "session.line.up",
        "session.line.down",
        "session.half.page.up",
        "session.half.page.down",
        "session.first",
        "session.last",
        "prompt.clear",
        "prompt.submit",
        "agent.cycle",
      ]),
      Schema.String,
    ]),
  },
})

export const ToastShow = Event.ephemeral({
  type: "tui.toast.show",
  schema: {
    title: optional(Schema.String),
    message: Schema.String,
    variant: Schema.Literals(["info", "success", "warning", "error"]),
    duration: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_TOAST_DURATION))).annotate({
      description: "Duration in milliseconds",
    }),
  },
})

export const SessionSelect = Event.ephemeral({
  type: "tui.session.select",
  schema: {
    sessionID: SessionID.annotate({ description: "Session ID to navigate to" }),
  },
})

export const Definitions = Event.inventory(PromptAppend, CommandExecute, ToastShow, SessionSelect)
