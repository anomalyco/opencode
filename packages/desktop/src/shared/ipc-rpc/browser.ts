import { Browser } from "@opencode-ai/schema/browser"
import { Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))
const bindingID = text(128)
const endpoint = Schema.Struct({
  url: text(16_384),
  username: Schema.optionalKey(text(1_024)),
  password: Schema.optionalKey(text(4_096)),
})
const target = Schema.Struct({ sessionID: text(256).check(Schema.isStartsWith("ses")), endpoint })
const bounds = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })
const layout = Schema.Struct({ visible: Schema.Boolean, bounds: Schema.optionalKey(bounds) })
export const BrowserPaneRequestSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("register"), bindingID, target }),
  Schema.Struct({ type: Schema.Literal("layout"), bindingID, layout: Schema.optionalKey(layout) }),
  Schema.Struct({ type: Schema.Literal("command"), bindingID, command: Browser.Action }),
  Schema.Struct({ type: Schema.Literal("close"), bindingID }),
])
export type BrowserPaneRequest = Schema.Schema.Type<typeof BrowserPaneRequestSchema>

export const BrowserPaneEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("open") }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    error: Schema.optionalKey(Schema.String),
  }),
])
export const BrowserPaneRpc = Rpc.make("BrowserPane", { payload: { request: BrowserPaneRequestSchema } })
