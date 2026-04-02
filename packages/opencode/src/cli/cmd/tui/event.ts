import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { PositiveInt } from "@/util/schema"
import { Effect, Schema } from "effect"

const DEFAULT_TOAST_DURATION = 5000

export const TuiEvent = {
  PromptAppend: BusEvent.define("tui.prompt.append", Schema.Struct({ text: Schema.String })),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    Schema.Struct({
      command: Schema.Union([
        Schema.Literals([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
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
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    Schema.Struct({
      title: Schema.optional(Schema.String),
      message: Schema.String,
      variant: Schema.Literals(["info", "success", "warning", "error"]),
      duration: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_TOAST_DURATION))).annotate({
        description: "Duration in milliseconds",
      }),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    Schema.Struct({
      sessionID: SessionID.annotate({ description: "Session ID to navigate to" }),
    }),
  ),
  SessionNew: BusEvent.define(
    "tui.session.new",
    z.object({
      message: z.string().describe("Initial message to send in the new session"),
      sessionID: SessionID.zod.describe("Session ID of the current session to abort"),
    }),
  ),
}
