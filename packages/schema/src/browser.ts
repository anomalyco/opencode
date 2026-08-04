export * as Browser from "./browser.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { NonNegativeInt, PositiveInt, statics } from "./schema.js"

const LeaseIDSchema = Schema.String.check(Schema.isPattern(/^brl_[0-9A-Za-z]+$/))
  .pipe(Schema.brand("Browser.LeaseID"))
  .annotate({ identifier: "Browser.LeaseID" })

export const LeaseID = LeaseIDSchema.pipe(
  statics((schema: typeof LeaseIDSchema) => ({
    create: () => schema.make("brl_" + ascending()),
  })),
)
export type LeaseID = typeof LeaseID.Type

export const Ref = Schema.String.check(Schema.isPattern(/^e[1-9][0-9]*$/))
  .pipe(Schema.brand("Browser.Ref"))
  .annotate({ identifier: "Browser.Ref" })
export type Ref = typeof Ref.Type

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(16_384)),
  title: Schema.String.check(Schema.isMaxLength(1_024)),
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  generation: NonNegativeInt,
}).annotate({ identifier: "Browser.State" })

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
]).annotate({ identifier: "Browser.Key" })
export type Key = typeof Key.Type

export const Direction = Schema.Literals(["up", "down", "left", "right"]).annotate({
  identifier: "Browser.Direction",
})
export type Direction = typeof Direction.Type

const generation = { generation: NonNegativeInt }

export const Command = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("navigate"),
    url: Schema.String.check(Schema.isMaxLength(16_384)),
    ...generation,
  }),
  Schema.Struct({ type: Schema.Literal("snapshot"), ...generation }),
  Schema.Struct({ type: Schema.Literal("click"), ref: Ref, ...generation }),
  Schema.Struct({
    type: Schema.Literal("fill"),
    ref: Ref,
    text: Schema.String.check(Schema.isMaxLength(10_000)),
    ...generation,
  }),
  Schema.Struct({ type: Schema.Literal("press"), key: Key, ...generation }),
  Schema.Struct({ type: Schema.Literal("scroll"), direction: Direction, pixels: PositiveInt, ...generation }),
  Schema.Struct({ type: Schema.Literal("screenshot"), ...generation }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Browser.Command" })
export type Command = typeof Command.Type

const NavigateResult = Schema.Struct({
  type: Schema.Literal("navigate"),
  state: State,
}).annotate({ identifier: "Browser.NavigateResult" })

const SnapshotResult = Schema.Struct({
  type: Schema.Literal("snapshot"),
  state: State,
  format: Schema.Literal("opencode.semantic.v1"),
  content: Schema.String.check(Schema.isMaxLength(100_000)),
}).annotate({ identifier: "Browser.SnapshotResult" })

const ClickResult = Schema.Struct({
  type: Schema.Literal("click"),
  state: State,
}).annotate({ identifier: "Browser.ClickResult" })

const FillResult = Schema.Struct({
  type: Schema.Literal("fill"),
  state: State,
}).annotate({ identifier: "Browser.FillResult" })

const PressResult = Schema.Struct({
  type: Schema.Literal("press"),
  state: State,
}).annotate({ identifier: "Browser.PressResult" })

const ScrollResult = Schema.Struct({
  type: Schema.Literal("scroll"),
  state: State,
}).annotate({ identifier: "Browser.ScrollResult" })

const ScreenshotResult = Schema.Struct({
  type: Schema.Literal("screenshot"),
  state: State,
  mediaType: Schema.Literal("image/png"),
  data: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(5 * 1_024 * 1_024)),
  width: PositiveInt,
  height: PositiveInt,
}).annotate({ identifier: "Browser.ScreenshotResult" })

export const Result = Schema.Union([
  NavigateResult,
  SnapshotResult,
  ClickResult,
  FillResult,
  PressResult,
  ScrollResult,
  ScreenshotResult,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Browser.Result" })
export type Result = typeof Result.Type

export const ErrorCode = Schema.Literals([
  "not_attached",
  "stale_ref",
  "invalid_url",
  "navigation_failed",
  "timeout",
  "aborted",
  "page_crashed",
  "result_too_large",
  "overloaded",
  "protocol",
  "internal",
]).annotate({ identifier: "Browser.ErrorCode" })
export type ErrorCode = typeof ErrorCode.Type

const Failure = Schema.Struct({
  type: Schema.Literal("failure"),
  code: ErrorCode,
  message: Schema.String.check(Schema.isMaxLength(1_024)),
}).annotate({ identifier: "Browser.Failure" })

const Success = Schema.Struct({
  type: Schema.Literal("success"),
  result: Result,
}).annotate({ identifier: "Browser.Success" })

export const Outcome = Schema.Union([Success, Failure])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Browser.Outcome" })
export type Outcome = typeof Outcome.Type
