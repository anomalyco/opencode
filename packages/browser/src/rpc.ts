export * as Browser from "./rpc.js"

import { Session } from "@opencode-ai/plugin/effect"
import { Rpc } from "@opencode-ai/plugin/rpc"
import { Schema } from "effect"

export const Ref = Schema.String.check(Schema.isPattern(/^@?e[1-9][0-9]*$/))
  .pipe(Schema.brand("Browser.Ref"))
  .annotate({ identifier: "Browser.Ref" })
export type Ref = typeof Ref.Type

export const State = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(16_384)),
  title: Schema.String.check(Schema.isMaxLength(1_024)),
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type State = typeof State.Type

export const Key = Schema.Literals([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Space",
])
export type Key = typeof Key.Type
export const Direction = Schema.Literals(["up", "down", "left", "right"])
export type Direction = typeof Direction.Type

export const Action = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["open", "snapshot", "screenshot", "back", "forward", "reload", "stop"]) }),
  Schema.Struct({ type: Schema.Literal("navigate"), url: Schema.String.check(Schema.isMaxLength(16_384)) }),
  Schema.Struct({ type: Schema.Literal("click"), ref: Ref }),
  Schema.Struct({ type: Schema.Literal("fill"), ref: Ref, text: Schema.String.check(Schema.isMaxLength(10_000)) }),
  Schema.Struct({ type: Schema.Literal("press"), key: Key }),
  Schema.Struct({
    type: Schema.Literal("evaluate"),
    script: Schema.String.check(Schema.isMaxLength(100_000)).annotate({
      description: "JavaScript to evaluate in the page. The result is JSON-serialized.",
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("scroll"),
    direction: Direction,
    pixels: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(2000)),
  }),
])
export type Action = typeof Action.Type

export const Command = Schema.Struct({ action: Action, generation: State.fields.generation })
export type Command = typeof Command.Type
export const Result = Schema.Union([
  Schema.Struct({ type: Schema.Literal("state"), state: State }),
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    state: State,
    content: Schema.String.check(Schema.isMaxLength(100_000)),
  }),
  Schema.Struct({
    type: Schema.Literal("evaluate"),
    state: State,
    content: Schema.String.check(Schema.isMaxLength(100_000)),
  }),
  Schema.Struct({
    type: Schema.Literal("screenshot"),
    state: State,
    data: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(5 * 1_024 * 1_024)),
  }),
]).pipe(Schema.toTaggedUnion("type"))
export type Result = typeof Result.Type
export const Outcome = Schema.Union([
  Schema.Struct({ type: Schema.Literal("success"), result: Result }),
  Schema.Struct({ type: Schema.Literal("failure"), message: Schema.String.check(Schema.isMaxLength(1_024)) }),
]).pipe(Schema.toTaggedUnion("type"))
export type Outcome = typeof Outcome.Type

const attachment = { sessionID: Session.ID, connectionID: Schema.String }
const errors = { unavailable: Schema.Struct({}) }
export const Control = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attached"), connectionID: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("command"),
    connectionID: Schema.String,
    requestID: Schema.String,
    command: Command,
  }),
  Schema.Struct({ type: Schema.Literal("cancel"), connectionID: Schema.String, requestID: Schema.String }),
]).pipe(Schema.toTaggedUnion("type"))
export type Control = typeof Control.Type

export const Definition = Rpc.define({
  id: "experimental.browser",
  methods: {
    attach: { input: Schema.Struct(attachment), output: Schema.Void, errors },
    state: { input: Schema.Struct({ ...attachment, state: Schema.NullOr(State) }), output: Schema.Void, errors },
    result: {
      input: Schema.Struct({ ...attachment, requestID: Schema.String, outcome: Outcome }),
      output: Schema.Void,
      errors,
    },
  },
  events: { control: { schema: Control } },
})
