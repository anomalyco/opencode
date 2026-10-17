import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import type { LLMRequest } from "../schema/index.js"
import { OpenResponses } from "./open-responses.js"
import { JsonObject, optionalNull, ProviderShared } from "./shared.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"
import { ResponsesCompaction } from "./utils/responses-compaction.js"

const ADAPTER = "xai-responses"
const NAME = "xAI Responses"

const XAIResponsesHostedToolItem = Schema.Union([
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag("x_search_call"),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      action: optionalNull(JsonObject),
    }),
    [JsonObject],
  ),
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag("image_generation_call"),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      result: Schema.optional(Schema.Unknown),
      error: Schema.optional(Schema.Unknown),
    }),
    [JsonObject],
  ),
])

// Hosted search tools run inside the xAI request and are billed per fetched source.
// https://docs.x.ai/developers/tools/overview
export const XSearch = Schema.Struct({
  type: Schema.Literal("x_search"),
  allowed_x_handles: Schema.optional(Schema.Array(Schema.String)),
  excluded_x_handles: Schema.optional(Schema.Array(Schema.String)),
  from_date: Schema.optional(Schema.String),
  to_date: Schema.optional(Schema.String),
  enable_image_understanding: Schema.optional(Schema.Boolean),
  enable_video_understanding: Schema.optional(Schema.Boolean),
})

// Unlike X search, the Responses API takes web search domain lists under `filters`.
export const WebSearch = Schema.Struct({
  type: Schema.Literal("web_search"),
  filters: Schema.optional(
    Schema.Struct({
      allowed_domains: Schema.optional(Schema.Array(Schema.String)),
      excluded_domains: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  enable_image_search: Schema.optional(Schema.Boolean),
  enable_image_understanding: Schema.optional(Schema.Boolean),
})

const NativeTool = Schema.Union([XSearch, WebSearch])

const adapter = {
  id: ADAPTER,
  name: NAME,
  nativeTool: (native) => ProviderShared.validateWith(Schema.decodeUnknownEffect(NativeTool))(native.xai),
  restoreHostedToolItem: (item: unknown) => (Schema.is(XAIResponsesHostedToolItem)(item) ? item : undefined),
} satisfies OpenResponses.ProviderAdapter

const fromRequest = Effect.fn("XAIResponses.fromRequest")(function* (request: LLMRequest) {
  if (request.providerOptions?.contextManagement !== undefined)
    return yield* ProviderShared.unsupportedOperation({
      operation: "in-band-compaction",
      provider: request.model.provider,
      route: request.model.route.id,
      message:
        "xAI requires explicit compaction through LLMClient.compact; automatic context management is not supported",
    })
  return yield* OpenResponses.fromRequestWithAdapter(request, adapter)
})

const HOSTED_TOOLS = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  x_search_call: { name: "x_search", input: (item) => item.action ?? {} },
  file_search_call: { name: "file_search", input: (item) => ({ queries: item.queries ?? [] }) },
  code_interpreter_call: {
    name: "code_interpreter",
    input: (item) => ({ code: item.code, container_id: item.container_id }),
  },
  image_generation_call: { name: "image_generation", input: () => ({}) },
  mcp_call: {
    name: "mcp",
    input: (item) => ({ server_label: item.server_label, name: item.name, arguments: item.arguments }),
  },
} as const satisfies ResponsesHostedTools.Definitions

// Grok speaks the standard Responses reasoning dialect (`reasoning_summary_text.*`,
// handled by the baseline); only its hosted tool vocabulary differs.
const step = (state: OpenResponses.ParserState, input: OpenResponses.Event) => {
  const event = OpenResponses.normalize(state, input)
  if (event.type === "response.output_item.done" && event.item && ResponsesHostedTools.isItem(event.item, HOSTED_TOOLS))
    return ResponsesHostedTools.onDone(state, event.item, HOSTED_TOOLS)
  return OpenResponses.step(state, event)
}

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenResponses.OpenResponsesBody,
    from: fromRequest,
  },
  stream: {
    event: OpenResponses.protocol.stream.event,
    initial: (request) => OpenResponses.initial(request, adapter),
    step,
    terminal: OpenResponses.terminal,
  },
})

export const compact = ResponsesCompaction.make(adapter, (request) =>
  OpenResponses.lowerTools(ProviderShared.flattenTools(request.tools), adapter),
)

export * as XAIResponses from "./xai-responses.js"
