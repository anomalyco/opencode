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

export namespace Handshake {
  export const ProtocolVersion = Schema.Literal(1)
  export type ProtocolVersion = Schema.Schema.Type<typeof ProtocolVersion>

  export const Capability = Schema.NonEmptyString
  export type Capability = Schema.Schema.Type<typeof Capability>

  export const EndpointRole = Schema.Literals(["ui", "backend"])
  export type EndpointRole = Schema.Schema.Type<typeof EndpointRole>

  export const Identity = Schema.Struct({
    name: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
  })
  export interface Identity extends Schema.Schema.Type<typeof Identity> {}

  export const Params = Schema.Struct({
    client: Identity,
    expectedRole: EndpointRole,
    offeredVersions: Schema.Array(
      Schema.Int.check(Schema.isGreaterThan(0)),
    ).check(Schema.isMinLength(1), Schema.isUnique()),
    requiredCapabilities: Schema.Array(Capability).check(Schema.isUnique()),
    optionalCapabilities: Schema.Array(Capability).check(Schema.isUnique()),
  })
  export interface Params extends Schema.Schema.Type<typeof Params> {}

  export const Response = Schema.Struct({
    protocolVersion: ProtocolVersion,
    role: EndpointRole,
    server: Identity,
    capabilities: Schema.Array(Capability),
  })
  export interface Response extends Schema.Schema.Type<typeof Response> {}

  export const Request = Schema.Struct({
    ...JsonRpc.RequestFields,
    method: Schema.Literal("simulation.handshake"),
    params: Params,
  })
  export interface Request extends Schema.Schema.Type<typeof Request> {}

  export interface DispatchAction {
    readonly role: EndpointRole
    readonly server: Identity
    readonly capabilities: ReadonlyArray<Capability>
  }

  export class RoleMismatchError extends Schema.TaggedErrorClass<RoleMismatchError>()(
    "SimulationHandshake.RoleMismatchError",
    {
      expected: EndpointRole,
      actual: EndpointRole,
      message: Schema.String,
    },
  ) {}

  export class UnsupportedProtocolError extends Schema.TaggedErrorClass<UnsupportedProtocolError>()(
    "SimulationHandshake.UnsupportedProtocolError",
    {
      offered: Schema.Array(Schema.Number),
      supported: Schema.Array(ProtocolVersion),
      message: Schema.String,
    },
  ) {}

  export class MissingCapabilityError extends Schema.TaggedErrorClass<MissingCapabilityError>()(
    "SimulationHandshake.MissingCapabilityError",
    {
      missing: Schema.Array(Capability),
      message: Schema.String,
    },
  ) {}

  export function dispatch(action: DispatchAction, params: Params) {
    return Effect.gen(function* () {
      if (params.expectedRole !== action.role) {
        return yield* Effect.fail(
          new RoleMismatchError({
            expected: params.expectedRole,
            actual: action.role,
            message: `Expected simulation endpoint role ${params.expectedRole}, received ${action.role}`,
          }),
        )
      }
      if (!params.offeredVersions.includes(1)) {
        return yield* Effect.fail(
          new UnsupportedProtocolError({
            offered: params.offeredVersions,
            supported: [1],
            message: "No mutually supported simulation protocol version",
          }),
        )
      }
      const installed = new Set(action.capabilities)
      const missing = params.requiredCapabilities.filter((capability) => !installed.has(capability))
      if (missing.length > 0) {
        return yield* Effect.fail(
          new MissingCapabilityError({
            missing,
            message: `Simulation endpoint is missing required capabilities: ${missing.join(", ")}`,
          }),
        )
      }
      return {
        protocolVersion: 1,
        role: action.role,
        server: action.server,
        capabilities: Array.from(installed),
      } satisfies Response
    })
  }
}

export namespace Frontend {
  export const Capabilities = [
    "ui.type",
    "ui.press",
    "ui.enter",
    "ui.arrow",
    "ui.focus",
    "ui.click",
    "ui.resize",
    "ui.matches",
    "ui.screenshot",
    "ui.state",
    "ui.capture",
    "ui.recording.finish",
  ] as const satisfies ReadonlyArray<Handshake.Capability>

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

  export const Color = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number])
  export type Color = Schema.Schema.Type<typeof Color>

  export const CapturedFrame = Schema.Struct({
    cols: Schema.Number,
    rows: Schema.Number,
    cursor: Schema.Tuple([Schema.Number, Schema.Number]),
    lines: Schema.Array(
      Schema.Struct({
        spans: Schema.Array(
          Schema.Struct({
            text: Schema.String,
            fg: Color,
            bg: Color,
            attributes: Schema.Number,
            width: Schema.Number,
          }),
        ),
      }),
    ),
  })
  export interface CapturedFrame extends Schema.Schema.Type<typeof CapturedFrame> {}

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
    Handshake.Request,
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
    Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal("ui.capture") }),
  ])
  export type Request = Schema.Schema.Type<typeof Request>
  export const decodeRequest = Schema.decodeUnknownSync(Request)
  export const decodeRequestEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(Request))
}

export namespace Backend {
  export const Capabilities = [
    "llm.attach",
    "llm.chunk",
    "llm.finish",
    "llm.disconnect",
    "llm.pending",
    "llm.request",
  ] as const satisfies ReadonlyArray<Handshake.Capability>

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
    Handshake.Request,
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
