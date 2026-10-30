import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import type { LLMRequest } from "../schema/index.js"
import { OpenResponses } from "./open-responses.js"
import { JsonObject, optionalNull, ProviderShared } from "./shared.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"
import { ResponsesCompaction } from "./utils/responses-compaction.js"
import { OpenAIFreeform } from "./openai-freeform.js"

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

const Options = Schema.Struct({
  minP: Schema.optional(Schema.Number),
})
export type OptionsInput = typeof Options.Type

const Body = Schema.Struct({
  ...OpenResponses.OpenResponsesBody.fields,
  top_k: Schema.optional(Schema.Number),
  min_p: Schema.optional(Schema.Number),
})

const adapter = {
  id: ADAPTER,
  name: NAME,
  lowerMedia: ({ part, media }) => {
    if (part.media.kind !== "video") return undefined
    const filename = part.filename ?? "file"
    const url = ProviderShared.mediaUrl(part.media)
    if (url) return { type: "input_file", filename, file_url: url }
    return media && { type: "input_file", filename, file_data: media.dataUrl }
  },
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
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(request.providerOptions ?? {})
  const body = yield* OpenResponses.fromRequestWithAdapter(request, adapter)
  // xAI Responses does not support penalties (they are ignored), but does support top_k.
  return {
    ...body,
    presence_penalty: undefined,
    frequency_penalty: undefined,
    top_k: request.generation?.topK,
    min_p: options.minP,
  }
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
    schema: Body,
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
  OpenResponses.lowerTools(ProviderShared.flattenTools(request.tools), adapter, OpenAIFreeform.tools(request)),
)

export * as XAIResponses from "./xai-responses.js"
