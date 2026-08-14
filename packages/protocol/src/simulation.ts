import { Effect, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

const JsonRpcID = Schema.Union([Schema.String, Schema.Number, Schema.Null])
const decodeJson = Schema.decodeUnknownSync(Schema.Json)

// Generated schema unions lose mapped tuple types even though both come from the same operation tuple.
// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion, typescript-eslint/no-unnecessary-type-parameters
const decoded = <Type>(value: unknown) => value as Type

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

  export type Response =
    | {
        readonly jsonrpc: "2.0"
        readonly id: string | number | null
        readonly result: Schema.Schema.Type<typeof Schema.Json>
        readonly error?: never
      }
    | {
        readonly jsonrpc: "2.0"
        readonly id: string | number | null
        readonly error: Schema.Schema.Type<typeof ErrorObject>
        readonly result?: never
      }
  export const Response = decoded<Schema.Decoder<Response>>(
    Schema.Struct({
      jsonrpc: Schema.Literal("2.0"),
      id: JsonRpcID,
      result: Schema.optionalKey(Schema.Json),
      error: Schema.optionalKey(ErrorObject),
    }).check(
      Schema.makeFilter((response) =>
        "result" in response === "error" in response
          ? "JSON-RPC responses must contain exactly one of result or error"
          : undefined,
      ),
    ),
  )

  export const decodeRequest = Schema.decodeUnknownSync(Request)

  export function success(id: Request["id"], result: unknown): Response | undefined {
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

export class SimulationRequestError extends Schema.TaggedErrorClass<SimulationRequestError>()(
  "SimulationRequestError",
  {
    method: Schema.String,
    code: Schema.Number,
    message: Schema.String,
    data: Schema.optionalKey(Schema.Json),
  },
) {}

const request = <
  const Tag extends string,
  Payload extends Schema.Top | Schema.Struct.Fields = typeof Schema.Void,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: Tag,
  options?: {
    readonly payload?: Payload
    readonly success?: Success
  },
) => Rpc.make(tag, { ...options, error: SimulationRequestError })

function operation<const Tag extends string, Success extends Schema.Decoder<unknown>>(method: Tag, success: Success) {
  return {
    method,
    success,
    request: Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal(method) }),
    rpc: request(method, { success }),
  }
}

function operationWithPayload<
  const Tag extends string,
  Payload extends Schema.Decoder<unknown>,
  Success extends Schema.Decoder<unknown>,
>(method: Tag, payload: Payload, success: Success) {
  return {
    method,
    payload,
    success,
    request: Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal(method), params: payload }),
    rpc: request(method, { payload, success }),
  }
}

function operationWithRpcPayload<
  const Tag extends string,
  Payload extends Schema.Decoder<unknown>,
  RpcPayload extends Schema.Decoder<unknown>,
  Success extends Schema.Decoder<unknown>,
>(method: Tag, payload: Payload, rpcPayload: RpcPayload, success: Success) {
  return {
    method,
    payload,
    success,
    request: Schema.Struct({ ...JsonRpc.RequestFields, method: Schema.Literal(method), params: payload }),
    rpc: request(method, { payload: rpcPayload, success }),
  }
}

function notification<const Method extends string, Payload extends Schema.Decoder<unknown>>(
  method: Method,
  payload: Payload,
) {
  return {
    method,
    payload,
    schema: Schema.Struct({
      jsonrpc: Schema.Literal("2.0"),
      method: Schema.Literal(method),
      params: payload,
    }),
  }
}

type OperationRequest<Operation> = Operation extends {
  readonly method: infer Method extends string
  readonly payload: infer Payload extends Schema.Top
}
  ? Omit<JsonRpc.Request, "method" | "params"> & {
      readonly method: Method
      readonly params: Schema.Schema.Type<Payload>
    }
  : Operation extends { readonly method: infer Method extends string }
    ? Omit<JsonRpc.Request, "method" | "params"> & { readonly method: Method }
    : never

type EndpointRequest<Operations extends ReadonlyArray<{ readonly method: string }>> =
  | Handshake.Request
  | OperationRequest<Operations[number]>

type EndpointNotification<Notifications extends ReadonlyArray<{ readonly schema: Schema.Top }>> = Schema.Schema.Type<
  Notifications[number]["schema"]
>

function endpoint<
  const Operations extends ReadonlyArray<{
    readonly method: string
    readonly success: Schema.Top
    readonly rpc: Rpc.Any
    readonly request: Schema.Decoder<unknown>
    readonly payload?: Schema.Decoder<unknown>
  }>,
  const Notifications extends ReadonlyArray<{
    readonly method: string
    readonly payload: Schema.Decoder<unknown>
    readonly schema: Schema.Decoder<unknown>
  }>,
  const Capabilities extends ReadonlyArray<Handshake.Capability>,
>(
  operations: Operations,
  notifications: Notifications,
  features: ReadonlyArray<Handshake.Capability>,
  Capabilities: Capabilities,
) {
  const requests: ReadonlyArray<Schema.Decoder<unknown>> = [
    Handshake.Request,
    ...operations.map((operation) => operation.request),
  ]
  const Request = Schema.Union(requests)
  const Notification =
    notifications.length === 0 ? Schema.Never : Schema.Union(notifications.map((notification) => notification.schema))
  const decodeRequest = Schema.decodeUnknownSync(Request)
  const decodeRequestEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(Request))
  const decodeNotification = Schema.decodeUnknownSync(Notification)
  const decodeNotificationEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(Notification))
  const handshake = request("simulation.handshake", { payload: Handshake.Params, success: Handshake.Response })
  const rpcs = RpcGroup.make(handshake, ...operations.map((operation) => operation.rpc)) as RpcGroup.RpcGroup<
    typeof handshake | Operations[number]["rpc"]
  >
  const derived = [
    ...operations.map((operation) => operation.method),
    ...notifications.map((notification) => notification.method),
    ...features,
  ]
  if (
    new Set(Capabilities).size !== Capabilities.length ||
    derived.length !== Capabilities.length ||
    derived.some((capability) => !Capabilities.includes(capability))
  )
    throw new Error("Simulation capabilities must exactly match endpoint operations")
  return {
    Capabilities,
    Request: decoded<Schema.Decoder<EndpointRequest<Operations>>>(Request),
    Notification: decoded<Schema.Decoder<EndpointNotification<Notifications>>>(Notification),
    decodeRequest: (input: unknown) => decoded<EndpointRequest<Operations>>(decodeRequest(input)),
    decodeRequestEffect: (input: string) =>
      decodeRequestEffect(input).pipe(Effect.map(decoded<EndpointRequest<Operations>>)),
    decodeNotification: (input: unknown) => decoded<EndpointNotification<Notifications>>(decodeNotification(input)),
    decodeNotificationEffect: (input: string) =>
      decodeNotificationEffect(input).pipe(Effect.map(decoded<EndpointNotification<Notifications>>)),
    rpcs,
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
    offeredVersions: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))).check(
      Schema.isMinLength(1),
      Schema.isUnique(),
    ),
    requiredCapabilities: Schema.Array(Capability).check(Schema.isUnique()),
    optionalCapabilities: Schema.Array(Capability).check(Schema.isUnique()),
  })
  export interface Params extends Schema.Schema.Type<typeof Params> {}

  export const Response = Schema.Struct({
    protocolVersion: ProtocolVersion,
    role: EndpointRole,
    server: Identity,
    capabilities: Schema.Array(Capability).check(Schema.isUnique()),
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
  export const KeyModifiers = Schema.Struct({
    ctrl: Schema.optional(Schema.Boolean),
    shift: Schema.optional(Schema.Boolean),
    meta: Schema.optional(Schema.Boolean),
    super: Schema.optional(Schema.Boolean),
    hyper: Schema.optional(Schema.Boolean),
  })
  export interface KeyModifiers extends Schema.Schema.Type<typeof KeyModifiers> {}

  export const SemanticClickTarget = Schema.Struct({
    id: Schema.NonEmptyString,
    instance: Schema.optionalKey(Schema.NonEmptyString),
    element: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  })
  export interface SemanticClickTarget extends Schema.Schema.Type<typeof SemanticClickTarget> {}

  export const Action = Schema.Union([
    Schema.Struct({ type: Schema.Literal("ui.type"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("ui.press"), key: Schema.String, modifiers: Schema.optional(KeyModifiers) }),
    Schema.Struct({ type: Schema.Literal("ui.enter") }),
    Schema.Struct({ type: Schema.Literal("ui.arrow"), direction: Schema.Literals(["up", "down", "left", "right"]) }),
    Schema.Struct({ type: Schema.Literal("ui.focus"), target: Schema.Number }),
    Schema.Struct({
      type: Schema.Literal("ui.click"),
      target: Schema.Number,
      x: Schema.Number,
      y: Schema.Number,
      semantic: Schema.optionalKey(SemanticClickTarget),
    }),
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

  export const TypeParams = Schema.Struct({ text: Schema.String })
  export interface TypeParams extends Schema.Schema.Type<typeof TypeParams> {}

  export const MatchesParams = Schema.Struct({ text: Schema.String })
  export interface MatchesParams extends Schema.Schema.Type<typeof MatchesParams> {}

  export const PressParams = Schema.Struct({ key: Schema.String, modifiers: Schema.optional(KeyModifiers) })
  export interface PressParams extends Schema.Schema.Type<typeof PressParams> {}

  export const pressParams = (key: string, modifiers?: KeyModifiers): PressParams => ({
    key,
    ...(modifiers === undefined ? {} : { modifiers }),
  })

  export const ArrowParams = Schema.Struct({ direction: Schema.Literals(["up", "down", "left", "right"]) })
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

  export const ResizeParams = Schema.Struct({ cols: Schema.Number, rows: Schema.Number })
  export interface ResizeParams extends Schema.Schema.Type<typeof ResizeParams> {}
}

const FrontendOperations = [
  operation("ui.state", Frontend.State),
  operation("ui.snapshot", Frontend.SemanticSnapshot),
  operation("ui.capture", Frontend.CapturedFrame),
  operationWithPayload("ui.matches", Frontend.MatchesParams, Frontend.Matches),
  operation("ui.recording.finish", Frontend.RecordingFinish),
  operationWithPayload("ui.type", Frontend.TypeParams, Frontend.State),
  operationWithPayload("ui.press", Frontend.PressParams, Frontend.State),
  operation("ui.enter", Frontend.State),
  operationWithPayload("ui.arrow", Frontend.ArrowParams, Frontend.State),
  operationWithPayload("ui.focus", Frontend.FocusParams, Frontend.State),
  operationWithPayload("ui.click", Frontend.ClickParams, Frontend.State),
  operationWithPayload("ui.resize", Frontend.ResizeParams, Frontend.State),
] as const
const FrontendCapabilities = [
  "ui.type",
  "ui.press",
  "ui.enter",
  "ui.arrow",
  "ui.focus",
  "ui.click",
  "ui.click.semantic",
  "ui.resize",
  "ui.matches",
  "ui.state",
  "ui.snapshot",
  "ui.capture",
  "ui.recording.finish",
] as const
const FrontendEndpoint = endpoint(FrontendOperations, [], ["ui.click.semantic"], FrontendCapabilities)
type FrontendRequest = EndpointRequest<typeof FrontendOperations>

export namespace Frontend {
  export const Capabilities: typeof FrontendCapabilities = FrontendEndpoint.Capabilities
  export type Capability = (typeof Capabilities)[number]
  export const Request: Schema.Decoder<FrontendRequest> = FrontendEndpoint.Request
  export type Request = FrontendRequest
  export const decodeRequest: (input: unknown) => Request = FrontendEndpoint.decodeRequest
  export const decodeRequestEffect: (input: string) => Effect.Effect<Request, Schema.SchemaError> =
    FrontendEndpoint.decodeRequestEffect
}

export namespace Backend {
  export const Item = Schema.Union([
    Schema.Struct({ type: Schema.Literal("textDelta"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("reasoningDelta"), text: Schema.String }),
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
    Schema.Struct({ type: Schema.Literal("raw"), chunk: Schema.Json }),
  ])
  export type Item = Schema.Schema.Type<typeof Item>

  export const FinishReason = Schema.Literals(["stop", "tool-calls", "length", "content-filter"])
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
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ? undefined : "simulated tool names must be provider-safe",
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
        if (new Set(names).size !== names.length) return "simulated tool registrations must have unique exposed names"
        if (
          tools.some(
            (tool) =>
              tool.name === "execute" && tool.options?.namespace === undefined && tool.options?.codemode === false,
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

  export const ToolProgress = Schema.Record(Schema.String, Schema.Json)
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

  export const ToolFinishParams = Schema.Struct({ id: Schema.String, output: ToolOutput })
  export interface ToolFinishParams extends Schema.Schema.Type<typeof ToolFinishParams> {}

  export const ToolFailParams = Schema.Struct({ id: Schema.String, message: Schema.String })
  export interface ToolFailParams extends Schema.Schema.Type<typeof ToolFailParams> {}

  export const ToolInvocation = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    input: Schema.Json,
    context: Schema.Struct({
      sessionID: Schema.String,
      agent: Schema.String,
      messageID: Schema.String,
      id: Schema.String,
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

  export const ChunkParams = Schema.Struct({ id: Schema.String, items: Schema.Array(Item) })
  export interface ChunkParams extends Schema.Schema.Type<typeof ChunkParams> {}

  export const FinishParams = Schema.Struct({
    id: Schema.String,
    reason: FinishReason.pipe(Schema.withDecodingDefault(Effect.succeed("stop" as const))),
  })
  export interface FinishParams extends Schema.Schema.Type<typeof FinishParams> {}

  export const FinishPayload = Schema.Struct({
    id: Schema.String,
    reason: Schema.optionalKey(FinishReason),
  })
  export interface FinishPayload extends Schema.Schema.Type<typeof FinishPayload> {}

  export const DisconnectParams = Schema.Struct({ id: Schema.String })
  export interface DisconnectParams extends Schema.Schema.Type<typeof DisconnectParams> {}

  export const ProviderInvocation = Schema.Struct({ id: Schema.String, url: Schema.String, body: Schema.Json })
  export interface ProviderInvocation extends Schema.Schema.Type<typeof ProviderInvocation> {}

  export const Pending = Schema.Struct({ invocations: Schema.Array(ProviderInvocation) })
  export interface Pending extends Schema.Schema.Type<typeof Pending> {}

  export const NetworkLogEntry = Schema.Struct({
    time: Schema.Number,
    method: Schema.String,
    url: Schema.String,
    matched: Schema.Boolean,
  })
  export interface NetworkLogEntry extends Schema.Schema.Type<typeof NetworkLogEntry> {}
}

const BackendOperations = [
  operation("llm.attach", Backend.Attached),
  operation("llm.pending", Backend.Pending),
  operationWithPayload("llm.chunk", Backend.ChunkParams, Backend.Ok),
  operationWithRpcPayload("llm.finish", Backend.FinishParams, Backend.FinishPayload, Backend.Ok),
  operationWithPayload("llm.disconnect", Backend.DisconnectParams, Backend.Ok),
  operationWithPayload("tool.attach", Backend.ToolAttachParams, Backend.Attached),
  operationWithPayload("tool.update", Backend.ToolUpdateParams, Backend.Ok),
  operationWithPayload("tool.finish", Backend.ToolFinishParams, Backend.Ok),
  operationWithPayload("tool.fail", Backend.ToolFailParams, Backend.Ok),
] as const
const BackendNotifications = [
  notification("llm.request", Backend.ProviderInvocation),
  notification("tool.invocation", Backend.ToolInvocation),
  notification("tool.cancel", Backend.ToolCancellation),
] as const
const BackendCapabilities = [
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
] as const
const BackendEndpoint = endpoint(BackendOperations, BackendNotifications, ["llm.tool-input-delta"], BackendCapabilities)
type BackendRequest = EndpointRequest<typeof BackendOperations>
type BackendNotification = EndpointNotification<typeof BackendNotifications>

export namespace Backend {
  export const Capabilities: typeof BackendCapabilities = BackendEndpoint.Capabilities
  export const Request: Schema.Decoder<BackendRequest> = BackendEndpoint.Request
  export type Request = BackendRequest
  export const decodeRequest: (input: unknown) => Request = BackendEndpoint.decodeRequest
  export const decodeRequestEffect: (input: string) => Effect.Effect<Request, Schema.SchemaError> =
    BackendEndpoint.decodeRequestEffect
  export const Notification: Schema.Decoder<BackendNotification> = BackendEndpoint.Notification
  export type Notification = BackendNotification
  export const decodeNotification: (input: unknown) => Notification = BackendEndpoint.decodeNotification
  export const decodeNotificationEffect: (input: string) => Effect.Effect<Notification, Schema.SchemaError> =
    BackendEndpoint.decodeNotificationEffect
}

export const UiRpcs = FrontendEndpoint.rpcs
export const BackendRpcs = BackendEndpoint.rpcs
