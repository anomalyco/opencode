import { Effect, Schema } from "effect"

const JsonRpcID = Schema.Union([Schema.String, Schema.Number, Schema.Null])
type Json = Schema.Schema.Type<typeof Schema.Json>

export namespace JsonRpc {
  export const RequestFields = {
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.optional(JsonRpcID),
  }
  export const Request = Schema.Struct({
    ...RequestFields,
    method: Schema.String,
    params: Schema.optional(Schema.Json),
  })
  export interface Request extends Schema.Schema.Type<typeof Request> {}

  export const ErrorObject = Schema.Struct({
    code: Schema.Number,
    message: Schema.String,
    data: Schema.optional(Schema.Json),
  })

  export const Response = Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: JsonRpcID,
    result: Schema.optional(Schema.Json),
    error: Schema.optional(ErrorObject),
  })
  export interface Response extends Schema.Schema.Type<typeof Response> {}

  export const decodeRequest = Schema.decodeUnknownSync(Request)

  export function success(id: Request["id"], result: unknown): Response | undefined {
    if (id === undefined) return undefined
    return { jsonrpc: "2.0", id, result: result as Json }
  }

  export function failure(id: Request["id"], error: unknown): Response {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export namespace Frontend {
  export const KeyModifiers = Schema.Struct({
    ctrl: Schema.optional(Schema.Boolean),
    shift: Schema.optional(Schema.Boolean),
    meta: Schema.optional(Schema.Boolean),
    super: Schema.optional(Schema.Boolean),
    hyper: Schema.optional(Schema.Boolean),
  })
  export interface KeyModifiers extends Schema.Schema.Type<typeof KeyModifiers> {}

  export const Action = Schema.Union([
    Schema.Struct({ type: Schema.Literal("ui.type"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("ui.press"), key: Schema.String, modifiers: Schema.optional(KeyModifiers) }),
    Schema.Struct({ type: Schema.Literal("ui.enter") }),
    Schema.Struct({ type: Schema.Literal("ui.arrow"), direction: Schema.Literals(["up", "down", "left", "right"]) }),
    Schema.Struct({ type: Schema.Literal("ui.focus"), target: Schema.Number }),
    Schema.Struct({ type: Schema.Literal("ui.click"), target: Schema.Number, x: Schema.Number, y: Schema.Number }),
    Schema.Struct({ type: Schema.Literal("ui.resize"), cols: Schema.Number, rows: Schema.Number }),
  ])
  export type Action = Schema.Schema.Type<typeof Action>

  export const Element = Schema.Struct({
    id: Schema.String,
    num: Schema.Number,
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
    focusable: Schema.Boolean,
    focused: Schema.Boolean,
    clickable: Schema.Boolean,
    editor: Schema.Boolean,
  })
  export interface Element extends Schema.Schema.Type<typeof Element> {}

  export const State = Schema.Struct({
    focused: Schema.Struct({
      renderable: Schema.optional(Schema.Number),
      editor: Schema.Boolean,
    }),
    elements: Schema.Array(Element),
  })
  export interface State extends Schema.Schema.Type<typeof State> {}

  export const Screenshot = Schema.String
  export type Screenshot = Schema.Schema.Type<typeof Screenshot>

  export const RecordingFinish = Schema.String
  export type RecordingFinish = Schema.Schema.Type<typeof RecordingFinish>

  export const Matches = Schema.Boolean
  export type Matches = Schema.Schema.Type<typeof Matches>

  export const ScreenshotParams = Schema.Struct({ name: Schema.optional(Schema.String) })
  export interface ScreenshotParams extends Schema.Schema.Type<typeof ScreenshotParams> {}

  export const TypeParams = Schema.Struct({ text: Schema.String })
  export interface TypeParams extends Schema.Schema.Type<typeof TypeParams> {}

  export const MatchesParams = Schema.Struct({ text: Schema.String })
  export interface MatchesParams extends Schema.Schema.Type<typeof MatchesParams> {}

  export const PressParams = Schema.Struct({ key: Schema.String, modifiers: Schema.optional(KeyModifiers) })
  export interface PressParams extends Schema.Schema.Type<typeof PressParams> {}

  export const ArrowParams = Schema.Struct({ direction: Schema.Literals(["up", "down", "left", "right"]) })
  export interface ArrowParams extends Schema.Schema.Type<typeof ArrowParams> {}

  export const FocusParams = Schema.Struct({ target: Schema.Number })
  export interface FocusParams extends Schema.Schema.Type<typeof FocusParams> {}

  export const ClickParams = Schema.Struct({ target: Schema.Number, x: Schema.Number, y: Schema.Number })
  export interface ClickParams extends Schema.Schema.Type<typeof ClickParams> {}

  export const ResizeParams = Schema.Struct({ cols: Schema.Number, rows: Schema.Number })
  export interface ResizeParams extends Schema.Schema.Type<typeof ResizeParams> {}

  export const Request = Schema.Union([
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.type"), params: TypeParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.press"), params: PressParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.arrow"), params: ArrowParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.focus"), params: FocusParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.click"), params: ClickParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.resize"), params: ResizeParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.matches"), params: MatchesParams }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.screenshot"),
      params: Schema.optional(ScreenshotParams),
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literals(["ui.enter", "ui.state", "ui.recording.finish"]),
    }),
  ])
  export type Request = Schema.Schema.Type<typeof Request>
  export const decodeRequest = Schema.decodeUnknownSync(Request)
  export const decodeRequestEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(Request))
}

export namespace Backend {
  export const Item = Schema.Union([
    Schema.Struct({ type: Schema.Literal("textDelta"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("reasoningDelta"), text: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("toolCall"),
      index: Schema.Number,
      id: Schema.String,
      name: Schema.String,
      input: Schema.Json,
    }),
    Schema.Struct({ type: Schema.Literal("raw"), chunk: Schema.Json }),
  ])
  export type Item = Schema.Schema.Type<typeof Item>

  export const FinishReason = Schema.Literals(["stop", "tool-calls", "length", "content-filter"])
  export type FinishReason = Schema.Schema.Type<typeof FinishReason>

  export const ChunkParams = Schema.Struct({ id: Schema.String, items: Schema.Array(Item) })
  export interface ChunkParams extends Schema.Schema.Type<typeof ChunkParams> {}

  export const FinishParams = Schema.Struct({
    id: Schema.String,
    reason: FinishReason.pipe(Schema.withDecodingDefault(Effect.succeed("stop" as const))),
  })
  export interface FinishParams extends Schema.Schema.Type<typeof FinishParams> {}

  export const DisconnectParams = Schema.Struct({ id: Schema.String })
  export interface DisconnectParams extends Schema.Schema.Type<typeof DisconnectParams> {}

  export const Request = Schema.Union([
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("llm.chunk"), params: ChunkParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("llm.finish"), params: FinishParams }),
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("llm.disconnect"), params: DisconnectParams }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literals(["llm.attach", "llm.pending"]),
    }),
  ])
  export type Request = Schema.Schema.Type<typeof Request>
  export const decodeRequest = Schema.decodeUnknownSync(Request)
  export const decodeRequestEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(Request))

  export const ProviderInvocation = Schema.Struct({ id: Schema.String, url: Schema.String, body: Schema.Json })
  export interface ProviderInvocation extends Schema.Schema.Type<typeof ProviderInvocation> {}

  export const NetworkLogEntry = Schema.Struct({
    time: Schema.Number,
    method: Schema.String,
    url: Schema.String,
    matched: Schema.Boolean,
  })
  export interface NetworkLogEntry extends Schema.Schema.Type<typeof NetworkLogEntry> {}
}

export * as SimulationProtocol from "./index"
