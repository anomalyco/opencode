import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Llm from "../llm/index.js"

const JsonRpcID = Schema.Union([Schema.String, Schema.Number, Schema.Null])
const decodeJson = Schema.decodeUnknownSync(Schema.Json)

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

  export function success(
    id: Request["id"],
    result: unknown,
  ): Response | undefined {
    if (id === undefined) return undefined
    return { jsonrpc: "2.0", id, result: decodeJson(result) }
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
}

export namespace Frontend {
  export const Capabilities = [
    "ui.type",
    "ui.press",
    "ui.enter",
    "ui.arrow",
    "ui.focus",
    "ui.click",
    "ui.click.semantic",
    "ui.resize",
    "ui.matches",
    "ui.screenshot",
    "ui.state",
    "ui.snapshot",
    "ui.capture",
    "ui.recording.finish",
  ] as const satisfies ReadonlyArray<Handshake.Capability>
  export type Capability = typeof Capabilities[number]

  export const KeyModifiers = Schema.Struct({
    ctrl: Schema.optional(Schema.Boolean),
    shift: Schema.optional(Schema.Boolean),
    meta: Schema.optional(Schema.Boolean),
    super: Schema.optional(Schema.Boolean),
    hyper: Schema.optional(Schema.Boolean),
  })
  export interface KeyModifiers
    extends Schema.Schema.Type<typeof KeyModifiers> {}

  export const SemanticClickTarget = Schema.Struct({
    id: Schema.NonEmptyString,
    instance: Schema.optionalKey(Schema.NonEmptyString),
    element: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  })
  export interface SemanticClickTarget
    extends Schema.Schema.Type<typeof SemanticClickTarget> {}

  export const Action = Schema.Union([
    Schema.Struct({ type: Schema.Literal("ui.type"), text: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("ui.press"),
      key: Schema.String,
      modifiers: Schema.optional(KeyModifiers),
    }),
    Schema.Struct({ type: Schema.Literal("ui.enter") }),
    Schema.Struct({
      type: Schema.Literal("ui.arrow"),
      direction: Schema.Literals(["up", "down", "left", "right"]),
    }),
    Schema.Struct({ type: Schema.Literal("ui.focus"), target: Schema.Number }),
    Schema.Struct({
      type: Schema.Literal("ui.click"),
      target: Schema.Number,
      x: Schema.Number,
      y: Schema.Number,
      semantic: Schema.optionalKey(SemanticClickTarget),
    }),
    Schema.Struct({
      type: Schema.Literal("ui.resize"),
      cols: Schema.Number,
      rows: Schema.Number,
    }),
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

  export const SemanticNode = Schema.Struct({
    id: Schema.NonEmptyString,
    instance: Schema.optionalKey(Schema.NonEmptyString),
    parent: Schema.optionalKey(Schema.NonEmptyString),
    role: Schema.NonEmptyString,
    label: Schema.optionalKey(Schema.NonEmptyString),
    element: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    focused: Schema.optionalKey(Schema.Boolean),
    selected: Schema.optionalKey(Schema.Boolean),
    expanded: Schema.optionalKey(Schema.Boolean),
    disabled: Schema.optionalKey(Schema.Boolean),
  })
  export interface SemanticNode extends Schema.Schema.Type<typeof SemanticNode> {}

  export const SemanticSnapshot = Schema.Struct({
    format: Schema.Literal("opencode-ui-snapshot-v1"),
    nodes: Schema.Array(SemanticNode).check(
      Schema.makeFilter((nodes) => {
        const ids = new Set(nodes.map((node) => node.id))
        if (ids.size !== nodes.length) return "semantic node ids must be unique"
        if (new Set(nodes.map((node) => node.element)).size !== nodes.length)
          return "semantic node elements must be unique"
        if (nodes.some((node) => node.parent !== undefined && !ids.has(node.parent)))
          return "semantic node parents must reference another node"
        const parents = new Map(nodes.map((node) => [node.id, node.parent]))
        for (const node of nodes) {
          const visited = new Set<string>()
          let current: string | undefined = node.id
          while (current !== undefined) {
            if (visited.has(current)) return "semantic node hierarchy must be acyclic"
            visited.add(current)
            current = parents.get(current)
          }
        }
        return undefined
      }),
    ),
  })
  export interface SemanticSnapshot extends Schema.Schema.Type<typeof SemanticSnapshot> {}

  export const Screenshot = Schema.String
  export type Screenshot = Schema.Schema.Type<typeof Screenshot>

  export const Color = Schema.Tuple([
    Schema.Number,
    Schema.Number,
    Schema.Number,
    Schema.Number,
  ])
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
  export interface CapturedFrame
    extends Schema.Schema.Type<typeof CapturedFrame> {}

  export const RecordingFinish = Schema.String
  export type RecordingFinish = Schema.Schema.Type<typeof RecordingFinish>

  export const Matches = Schema.Boolean
  export type Matches = Schema.Schema.Type<typeof Matches>

  export const ScreenshotParams = Schema.Struct({
    name: Schema.optional(Schema.String),
  })
  export interface ScreenshotParams
    extends Schema.Schema.Type<typeof ScreenshotParams> {}

  export const TypeParams = Schema.Struct({ text: Schema.String })
  export interface TypeParams extends Schema.Schema.Type<typeof TypeParams> {}

  export const MatchesParams = Schema.Struct({ text: Schema.String })
  export interface MatchesParams
    extends Schema.Schema.Type<typeof MatchesParams> {}

  export const PressParams = Schema.Struct({
    key: Schema.String,
    modifiers: Schema.optional(KeyModifiers),
  })
  export interface PressParams extends Schema.Schema.Type<typeof PressParams> {}

  export const pressParams = (
    key: string,
    modifiers?: KeyModifiers,
  ): PressParams => ({
    key,
    ...(modifiers === undefined ? {} : { modifiers }),
  })

  export const ArrowParams = Schema.Struct({
    direction: Schema.Literals(["up", "down", "left", "right"]),
  })
  export interface ArrowParams extends Schema.Schema.Type<typeof ArrowParams> {}

  export const FocusParams = Schema.Struct({ target: Schema.Number })
  export interface FocusParams extends Schema.Schema.Type<typeof FocusParams> {}

  export const ClickParams = Schema.Struct({
    target: Schema.Number,
    x: Schema.Number,
    y: Schema.Number,
    semantic: Schema.optionalKey(SemanticClickTarget),
  })
  export interface ClickParams extends Schema.Schema.Type<typeof ClickParams> {}

  export const ResizeParams = Schema.Struct({
    cols: Schema.Number,
    rows: Schema.Number,
  })
  export interface ResizeParams
    extends Schema.Schema.Type<typeof ResizeParams> {}

  export const Request = Schema.Union([
    Handshake.Request,
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.type"),
      params: TypeParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.press"),
      params: PressParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.arrow"),
      params: ArrowParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.focus"),
      params: FocusParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.click"),
      params: ClickParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.resize"),
      params: ResizeParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.matches"),
      params: MatchesParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.screenshot"),
      params: Schema.optional(ScreenshotParams),
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literals([
        "ui.enter",
        "ui.state",
        "ui.snapshot",
        "ui.recording.finish",
      ]),
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("ui.capture"),
    }),
  ])
  export type Request = Schema.Schema.Type<typeof Request>
  export const decodeRequest = Schema.decodeUnknownSync(Request)
}

export namespace Backend {
  export const Capabilities = [
    "llm.attach",
    "llm.chunk",
    "llm.finish",
    "llm.disconnect",
    "llm.pending",
    "llm.request",
    "llm.tool-input-delta",
    "tool.attach",
    "tool.update",
    "tool.finish",
    "tool.fail",
    "tool.invocation",
    "tool.cancel",
  ] as const satisfies ReadonlyArray<Handshake.Capability>

  export const Item = Schema.Union([
    Schema.Struct({ type: Schema.Literal("textDelta"), text: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("reasoningDelta"),
      text: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal("toolInputStart"),
      index: Schema.Number,
      id: Schema.String,
      name: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal("toolInputDelta"),
      index: Schema.Number,
      text: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal("toolCall"),
      index: Schema.Number,
      id: Schema.String,
      name: Schema.String,
      input: Schema.Json,
    }),
    Llm.Raw,
  ])
  export type Item = Schema.Schema.Type<typeof Item>

  export const FinishReason = Llm.FinishReason
  export type FinishReason = Schema.Schema.Type<typeof FinishReason>

  export const ToolContent = Schema.Union([
    Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("file"),
      data: Schema.String,
      mime: Schema.NonEmptyString,
      name: Schema.optionalKey(Schema.String),
    }),
  ])
  export type ToolContent = Schema.Schema.Type<typeof ToolContent>

  const ToolName = Schema.NonEmptyString.check(
    Schema.makeFilter((name) =>
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
        ? undefined
        : "simulated tool names must be provider-safe",
    ),
  )
  const ToolNamespace = Schema.NonEmptyString.check(
    Schema.makeFilter((namespace) =>
      namespace.split(".").every((segment) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment))
        ? undefined
        : "simulated tool namespaces must contain provider-safe segments",
    ),
  )

  export const ToolRegistration = Schema.Struct({
    name: ToolName,
    description: Schema.String,
    inputSchema: Schema.Record(Schema.String, Schema.Json),
    outputSchema: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
    permission: Schema.optionalKey(Schema.NonEmptyString),
    options: Schema.optionalKey(
      Schema.Struct({
        namespace: Schema.optionalKey(ToolNamespace),
        codemode: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  })
  export interface ToolRegistration extends Schema.Schema.Type<typeof ToolRegistration> {}

  export const ToolAttachParams = Schema.Struct({
    tools: Schema.Array(ToolRegistration).check(
      Schema.makeFilter((tools) => {
        const names = tools.map(exposedToolName)
        if (names.some((name) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)))
          return "simulated tool names including namespaces must be provider-safe"
        if (new Set(names).size !== names.length)
          return "simulated tool registrations must have unique exposed names"
        if (
          tools.some(
            (tool) =>
              tool.name === "execute" &&
              tool.options?.namespace === undefined &&
              tool.options?.codemode === false,
          )
        )
          return 'direct simulated tool name "execute" is reserved'
        return undefined
      }),
    ),
  })
  export interface ToolAttachParams extends Schema.Schema.Type<typeof ToolAttachParams> {}

  export function exposedToolName(registration: ToolRegistration) {
    return registration.options?.namespace === undefined
      ? registration.name
      : `${registration.options.namespace.replaceAll(".", "_")}_${registration.name}`
  }

  export const ToolProgress = Schema.Struct({
    structured: Schema.Record(Schema.String, Schema.Json),
    content: Schema.optionalKey(Schema.Array(ToolContent)),
  })
  export interface ToolProgress extends Schema.Schema.Type<typeof ToolProgress> {}

  export const ToolOutput = Schema.Struct({
    structured: Schema.Json,
    content: Schema.Array(ToolContent),
  })
  export interface ToolOutput extends Schema.Schema.Type<typeof ToolOutput> {}

  export const ToolUpdateParams = Schema.Struct({
    id: Schema.String,
    sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    update: ToolProgress,
  })
  export interface ToolUpdateParams extends Schema.Schema.Type<typeof ToolUpdateParams> {}

  export const ToolFinishParams = Schema.Struct({
    id: Schema.String,
    output: ToolOutput,
  })
  export interface ToolFinishParams extends Schema.Schema.Type<typeof ToolFinishParams> {}

  export const ToolFailParams = Schema.Struct({
    id: Schema.String,
    message: Schema.String,
  })
  export interface ToolFailParams extends Schema.Schema.Type<typeof ToolFailParams> {}

  export const ToolInvocation = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    input: Schema.Json,
    context: Schema.Struct({
      sessionID: Schema.String,
      agent: Schema.String,
      messageID: Schema.String,
      callID: Schema.String,
    }),
  })
  export interface ToolInvocation extends Schema.Schema.Type<typeof ToolInvocation> {}

  export const ToolCancellation = Schema.Struct({
    id: Schema.String,
    reason: Schema.Literal("interrupted"),
  })
  export interface ToolCancellation extends Schema.Schema.Type<typeof ToolCancellation> {}

  export const Attached = Schema.Struct({ attached: Schema.Literal(true) })
  export interface Attached extends Schema.Schema.Type<typeof Attached> {}

  export const Ok = Schema.Struct({ ok: Schema.Literal(true) })
  export interface Ok extends Schema.Schema.Type<typeof Ok> {}

  export const ChunkParams = Schema.Struct({
    id: Schema.String,
    items: Schema.Array(Item),
  })
  export interface ChunkParams extends Schema.Schema.Type<typeof ChunkParams> {}

  export const FinishPayload = Schema.Struct({
    id: Schema.String,
    reason: Schema.optionalKey(FinishReason),
  })
  export interface FinishPayload
    extends Schema.Schema.Type<typeof FinishPayload> {}

  export const FinishParams = Schema.Struct({
    id: Schema.String,
    reason: FinishReason.pipe(
      Schema.withDecodingDefault(Effect.succeed("stop" as const)),
    ),
  })
  export interface FinishParams extends Schema.Schema.Type<
    typeof FinishParams
  > {}

  export const DisconnectParams = Schema.Struct({ id: Schema.String })
  export interface DisconnectParams extends Schema.Schema.Type<
    typeof DisconnectParams
  > {}

  export const Request = Schema.Union([
    Handshake.Request,
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("llm.chunk"),
      params: ChunkParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("llm.finish"),
      params: FinishParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("llm.disconnect"),
      params: DisconnectParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("tool.attach"),
      params: ToolAttachParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("tool.update"),
      params: ToolUpdateParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("tool.finish"),
      params: ToolFinishParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literal("tool.fail"),
      params: ToolFailParams,
    }),
    Schema.Struct({
      ...JsonRpc.RequestFields,
      method: Schema.Literals(["llm.attach", "llm.pending"]),
    }),
  ])
  export type Request = Schema.Schema.Type<typeof Request>
  export const decodeRequest = Schema.decodeUnknownSync(Request)

  export const OpenedExchange = Schema.Struct({
    id: Schema.String,
    url: Schema.String,
    body: Schema.Json,
  })
  export interface OpenedExchange
    extends Schema.Schema.Type<typeof OpenedExchange> {}

  export const Pending = Schema.Struct({
    invocations: Schema.Array(OpenedExchange),
  })
  export interface Pending extends Schema.Schema.Type<typeof Pending> {}

  export const NetworkLogEntry = Schema.Struct({
    time: Schema.Number,
    method: Schema.String,
    url: Schema.String,
    matched: Schema.Boolean,
  })
  export interface NetworkLogEntry extends Schema.Schema.Type<
    typeof NetworkLogEntry
  > {}
}
