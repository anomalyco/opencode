import { Effect, Encoding, Schema } from "effect"
import { Headers } from "effect/unstable/http"
import { Route } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { HttpTransport } from "../route/transport/index.js"
import { LLMEvent, LLMRequest, type JsonSchema, type ToolDefinition } from "../schema/index.js"
import { OpenResponses } from "./open-responses.js"
import { optionalArray, ProviderShared } from "./shared.js"
import { OpenAIImage } from "./utils/openai-image.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"
import { ToolSchemaProjection } from "./utils/tool-schema.js"
import { Lifecycle } from "./utils/lifecycle.js"
import { OpenResponsesChannel } from "./open-responses-channel.js"

const ADAPTER = "openai-responses"
const NAME = "OpenAI Responses"
const WEBSOCKET_PROTOCOL_HEADER = "responses_websockets=2026-02-06"
const WEBSOCKET_ROTATE_AFTER_MS = 55 * 60 * 1000
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = OpenResponses.PATH

const OpenAIResponsesImageGenerationTool = Schema.Struct({
  type: Schema.tag("image_generation"),
  action: Schema.optional(Schema.Literals(["auto", "generate", "edit"])),
  background: Schema.optional(Schema.Literals(["auto", "opaque", "transparent"])),
  input_fidelity: Schema.optional(Schema.Literals(["low", "high"])),
  output_compression: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  output_format: Schema.optional(Schema.Literals(["png", "jpeg", "webp"])),
  partial_images: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  quality: Schema.optional(Schema.Literals(["auto", "low", "medium", "high"])),
  size: Schema.optional(OpenAIImage.Size),
})

const OpenAIResponsesLocalShellTool = Schema.Struct({ type: Schema.tag("local_shell") })

const OpenAIResponsesTools = Schema.Union([
  OpenResponses.Tool,
  OpenAIResponsesImageGenerationTool,
  OpenAIResponsesLocalShellTool,
])

const OpenAIResponsesToolChoice = Schema.Union([
  OpenResponses.ToolChoice,
  Schema.Struct({ type: Schema.tag("image_generation") }),
])

const OpenAIResponsesLocalShellAction = Schema.Struct({
  type: Schema.tag("exec"),
  command: Schema.Array(Schema.String),
  timeout_ms: Schema.optional(Schema.NullOr(Schema.Number)),
  user: Schema.optional(Schema.NullOr(Schema.String)),
  working_directory: Schema.optional(Schema.NullOr(Schema.String)),
  env: Schema.Record(Schema.String, Schema.String),
})

const OpenAIResponsesLocalShellCall = Schema.Struct({
  type: Schema.tag("local_shell_call"),
  id: Schema.optionalKey(Schema.String),
  call_id: Schema.String,
  action: OpenAIResponsesLocalShellAction,
  status: Schema.Literals(["in_progress", "completed", "incomplete"]),
})

const OpenAIResponsesLocalShellCallOutput = Schema.Struct({
  type: Schema.tag("local_shell_call_output"),
  id: Schema.String,
  output: Schema.String,
})

const OpenAIResponsesInputItem = Schema.Union([
  OpenResponses.InputItem,
  OpenAIResponsesLocalShellCall,
  OpenAIResponsesLocalShellCallOutput,
])

const OpenAIResponsesCoreFields = {
  ...OpenResponses.coreFields,
  input: Schema.Array(OpenAIResponsesInputItem),
  tools: optionalArray(OpenAIResponsesTools),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
}

const OpenAIResponsesBody = Schema.Struct({
  ...OpenAIResponsesCoreFields,
  stream: Schema.Literal(true),
})
export type OpenAIResponsesBody = Schema.Schema.Type<typeof OpenAIResponsesBody>

const extension = {
  id: ADAPTER,
  name: NAME,
} satisfies OpenResponses.Extension

const nativeImageToolInput = (tool: ToolDefinition) => {
  const native = tool.native?.openai
  return ProviderShared.isRecord(native) && native.type === "image_generation" ? native : undefined
}

const nativeImageTool = (tool: ToolDefinition) => {
  const native = nativeImageToolInput(tool)
  return Schema.is(OpenAIResponsesImageGenerationTool)(native) ? native : undefined
}

const nativeLocalShellToolInput = (tool: ToolDefinition) => {
  const native = tool.native?.openai
  return ProviderShared.isRecord(native) && native.type === "local_shell" ? native : undefined
}

const lowerTool = Effect.fn("OpenAIResponses.lowerTool")(function* (tool: ToolDefinition, inputSchema: JsonSchema) {
  const native = nativeImageToolInput(tool)
  if (native !== undefined) {
    if (Schema.is(OpenAIResponsesImageGenerationTool)(native)) return native
    return yield* ProviderShared.invalidRequest("OpenAI Responses image generation tool options are invalid")
  }
  const localShell = nativeLocalShellToolInput(tool)
  if (localShell !== undefined) {
    if (Schema.is(OpenAIResponsesLocalShellTool)(localShell)) return localShell
    return yield* ProviderShared.invalidRequest("OpenAI Responses local shell tool options are invalid")
  }
  return yield* OpenResponses.lowerTool(NAME, tool, inputSchema)
})

const lowerToolChoice = Effect.fn("OpenAIResponses.lowerToolChoice")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
  tools: ReadonlyArray<ToolDefinition>,
) {
  if (
    toolChoice.type === "tool" &&
    tools.some((tool) => tool.name === toolChoice.name && nativeLocalShellToolInput(tool) !== undefined)
  )
    return yield* ProviderShared.invalidRequest("OpenAI Responses cannot select the local shell tool by name")
  return yield* ProviderShared.matchToolChoice(NAME, toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (name) =>
      tools.some((tool) => tool.name === name && nativeImageTool(tool) !== undefined)
        ? ({ type: "image_generation" } as const)
        : { type: "function" as const, name },
  })
})

const localShellCalls = (request: LLMRequest) =>
  new Map(
    request.messages.flatMap((message) =>
      message.role !== "assistant"
        ? []
        : message.content.flatMap((part) => {
            if (part.type !== "tool-call") return []
            const metadata = part.providerMetadata?.[request.model.route.providerMetadataKey ?? "openai"]
            if (!ProviderShared.isRecord(metadata) || metadata.itemType !== "local_shell_call") return []
            return [[part.id, part] as const]
          }),
    ),
  )

const lowerLocalShellHistory = (request: LLMRequest, input: OpenAIResponsesBody["input"]) => {
  const calls = localShellCalls(request)
  return input.map((item) => {
    if (!("type" in item) || (item.type !== "function_call" && item.type !== "function_call_output")) return item
    const call = calls.get(item.call_id)
    if (!call) return item
    if (item.type === "function_call") {
      const input = ProviderShared.isRecord(call.input) ? call.input.action : undefined
      const metadata = call.providerMetadata?.[request.model.route.providerMetadataKey ?? "openai"]
      const status = ProviderShared.isRecord(metadata) ? metadata.status : undefined
      return { type: "local_shell_call" as const, id: item.id, call_id: item.call_id, action: input, status }
    }
    return { type: "local_shell_call_output" as const, id: item.call_id, output: item.output }
  })
}

const decodeBody = ProviderShared.validateWith(Schema.decodeUnknownEffect(OpenAIResponsesBody))
const decodeLocalShellCall = Schema.decodeUnknownEffect(OpenAIResponsesLocalShellCall)

const fromRequest = Effect.fn("OpenAIResponses.fromRequest")(function* (request: LLMRequest) {
  const body = yield* OpenResponses.fromRequestWithExtension(
    LLMRequest.update(request, { tools: [], toolChoice: undefined }),
    extension,
  )
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema
  const allowedTools =
    typeof body.tool_choice === "object" && body.tool_choice.type === "allowed_tools" ? body.tool_choice : undefined
  if (
    allowedTools &&
    request.tools.some(
      (tool) =>
        nativeLocalShellToolInput(tool) !== undefined &&
        allowedTools.tools.some((choice) => choice.name === tool.name),
    )
  )
    return yield* ProviderShared.invalidRequest("OpenAI Responses allowed tools cannot include the local shell tool")
  return yield* decodeBody({
    ...body,
    input: lowerLocalShellHistory(request, body.input),
    tools:
      request.tools.length === 0
        ? undefined
        : yield* Effect.forEach(request.tools, (tool) =>
            lowerTool(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility)),
          ),
    tool_choice:
      body.tool_choice ?? (request.toolChoice ? yield* lowerToolChoice(request.toolChoice, request.tools) : undefined),
  })
})

const hostedToolResult = Effect.fn("OpenAIResponses.hostedToolResult")(function* (item: ResponsesHostedTools.Item) {
  const isError = item.error !== undefined && item.error !== null
  if (item.type === "image_generation_call" && item.result) {
    yield* Effect.fromResult(Encoding.decodeBase64(item.result)).pipe(
      Effect.mapError(() => ProviderShared.eventError(ADAPTER, "OpenAI Responses returned invalid image base64")),
    )
    const format = item.output_format ?? "png"
    return {
      type: "content" as const,
      value: [
        {
          type: "file" as const,
          uri: `data:image/${format};base64,${item.result}`,
          mime: `image/${format}`,
        },
      ],
    }
  }
  return isError ? { type: "error" as const, value: item.error } : { type: "json" as const, value: item }
})

const HOSTED_TOOLS = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  web_search_preview_call: { name: "web_search_preview", input: (item) => item.action ?? {} },
  file_search_call: { name: "file_search", input: (item) => ({ queries: item.queries ?? [] }) },
  code_interpreter_call: {
    name: "code_interpreter",
    input: (item) => ({ code: item.code, container_id: item.container_id }),
  },
  computer_call: { name: "computer_use", input: (item) => item.action ?? {} },
  image_generation_call: { name: "image_generation", input: () => ({}), result: hostedToolResult },
  mcp_call: {
    name: "mcp",
    input: (item) => ({ server_label: item.server_label, name: item.name, arguments: item.arguments }),
  },
} as const satisfies ResponsesHostedTools.Definitions

const onLocalShellCallDone = Effect.fn("OpenAIResponses.onLocalShellCallDone")(function* (
  state: OpenResponses.ParserState,
  item: OpenResponses.StreamItem,
) {
  const call = yield* decodeLocalShellCall(item).pipe(
    Effect.mapError(() => ProviderShared.eventError(ADAPTER, "OpenAI Responses local_shell_call is malformed")),
  )
  if (!call.id) return yield* ProviderShared.eventError(ADAPTER, "OpenAI Responses local_shell_call is missing id")
  const events: LLMEvent[] = []
  const lifecycle = Lifecycle.stepStart(state.lifecycle, events)
  events.push(
    LLMEvent.toolCall({
      id: call.call_id,
      name: "local_shell",
      input: { action: call.action },
      providerMetadata: OpenResponses.providerMetadata(state, {
        itemId: call.id,
        itemType: "local_shell_call",
        status: call.status,
      }),
    }),
  )
  return [{ ...state, lifecycle, hasFunctionCall: true }, events] satisfies OpenResponses.StepResult
})

const step = (state: OpenResponses.ParserState, event: OpenResponses.Event) => {
  if (event.type === "response.reasoning_text.delta" || event.type === "response.reasoning_summary.delta")
    return event.item_id
      ? Effect.succeed(OpenResponses.onReasoningDelta(state, event, event.item_id))
      : ProviderShared.eventError(ADAPTER, `${event.type} is missing item_id`)
  if (event.type === "response.reasoning_text.done" || event.type === "response.reasoning_summary.done")
    return event.item_id
      ? Effect.succeed(OpenResponses.onReasoningDone(state, event))
      : ProviderShared.eventError(ADAPTER, `${event.type} is missing item_id`)
  if (event.type === "response.output_item.done" && event.item?.type === "local_shell_call")
    return onLocalShellCallDone(state, event.item)
  if (event.type === "response.output_item.done" && event.item && ResponsesHostedTools.isItem(event.item, HOSTED_TOOLS))
    return ResponsesHostedTools.onDone(state, event.item, HOSTED_TOOLS)
  return OpenResponses.step(state, event)
}

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAIResponsesBody,
    from: fromRequest,
  },
  stream: {
    event: OpenResponses.protocol.stream.event,
    initial: (request) => OpenResponses.initial(request, extension),
    step,
    terminal: OpenResponses.terminal,
  },
})

const endpoint = Endpoint.path<OpenAIResponsesBody>(PATH, { baseURL: DEFAULT_BASE_URL })
const auth = Auth.none

export const httpTransport = HttpTransport.sseJson.with<OpenAIResponsesBody>()
export const channelTransport = OpenResponsesChannel.transport<OpenAIResponsesBody>
export const transport = channelTransport({
  id: ADAPTER,
  name: NAME,
  rotateAfterMs: WEBSOCKET_ROTATE_AFTER_MS,
  headers: (headers) => Headers.set(headers, "openai-beta", headers["openai-beta"] ?? WEBSOCKET_PROTOCOL_HEADER),
})

export const route = Route.make({
  id: ADAPTER,
  provider: "openai",
  providerMetadataKey: "openai",
  protocol,
  endpoint,
  auth,
  transport,
  defaults: { providerOptions: { store: false } },
})

export * as OpenAIResponses from "./openai-responses.js"
