import * as Schema from "effect/Schema"

const NonNegativeMilliseconds = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)

const PositiveInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
)

const NonNegativeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
)

export const StreamOptions = Schema.Struct({
  delay: Schema.optionalKey(NonNegativeMilliseconds),
  chunkSize: Schema.optionalKey(PositiveInteger),
})
export interface StreamOptions extends Schema.Schema.Type<typeof StreamOptions> {}

export const Text = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  options: Schema.optionalKey(StreamOptions),
})
export interface Text extends Schema.Schema.Type<typeof Text> {}

export const Reasoning = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  options: Schema.optionalKey(StreamOptions),
})
export interface Reasoning extends Schema.Schema.Type<typeof Reasoning> {}

export const Pause = Schema.Struct({
  type: Schema.Literal("pause"),
  milliseconds: NonNegativeMilliseconds,
})
export interface Pause extends Schema.Schema.Type<typeof Pause> {}

export const ToolCall = Schema.Struct({
  type: Schema.Literal("toolCall"),
  index: NonNegativeInteger,
  id: Schema.String,
  name: Schema.String,
  input: Schema.Json,
  options: Schema.optionalKey(StreamOptions),
})
export interface ToolCall extends Schema.Schema.Type<typeof ToolCall> {}
export type ToolCallInput = Omit<ToolCall, "type" | "options">

export const Raw = Schema.Struct({
  type: Schema.Literal("raw"),
  chunk: Schema.Json,
})
export interface Raw extends Schema.Schema.Type<typeof Raw> {}

export const FinishReason = Schema.Literals([
  "stop",
  "tool-calls",
  "length",
  "content-filter",
])
export type FinishReason = Schema.Schema.Type<typeof FinishReason>

export const Finish = Schema.Struct({
  type: Schema.Literal("finish"),
  reason: Schema.optionalKey(FinishReason),
})
export interface Finish extends Schema.Schema.Type<typeof Finish> {}

export const Disconnect = Schema.Struct({
  type: Schema.Literal("disconnect"),
})
export interface Disconnect extends Schema.Schema.Type<typeof Disconnect> {}

export const Output = Schema.Union([
  Text,
  Reasoning,
  Pause,
  ToolCall,
  Raw,
  Finish,
  Disconnect,
])
export type Output = Schema.Schema.Type<typeof Output>

export const text = (text: string, options?: StreamOptions): Text =>
  Text.make({
    type: "text",
    text,
    ...(options === undefined ? {} : { options }),
  })

export const reasoning = (text: string, options?: StreamOptions): Reasoning =>
  Reasoning.make({
    type: "reasoning",
    text,
    ...(options === undefined ? {} : { options }),
  })

export const pause = (milliseconds: number): Pause =>
  Pause.make({ type: "pause", milliseconds })

export const toolCall = (
  call: ToolCallInput,
  options?: StreamOptions,
): ToolCall =>
  ToolCall.make({
    ...call,
    type: "toolCall",
    ...(options === undefined ? {} : { options }),
  })

export const raw = (chunk: Schema.Json): Raw => Raw.make({ type: "raw", chunk })

export const finish = (reason?: FinishReason): Finish =>
  Finish.make({
    type: "finish",
    ...(reason === undefined ? {} : { reason }),
  })

export const disconnect = (): Disconnect => Disconnect.make({ type: "disconnect" })
