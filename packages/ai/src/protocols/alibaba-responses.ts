import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import { LLMRequest } from "../schema/index.js"
import type { AlibabaChat } from "./alibaba-chat.js"
import { OpenResponses } from "./open-responses.js"
import { JsonObject, optionalArray, ProviderShared } from "./shared.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"
import { ToolSchemaProjection } from "./utils/tool-schema.js"

export type OptionsInput = {
  readonly reasoningEffort?: AlibabaChat.ReasoningEffort
  readonly enableThinking?: boolean
  readonly store?: boolean
  readonly previousResponseId?: string
  readonly conversation?: string
}

const Options = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.String),
  enableThinking: Schema.optional(Schema.Boolean),
  store: Schema.optional(Schema.Boolean),
  previousResponseId: Schema.optional(Schema.String),
  conversation: Schema.optional(Schema.String),
})
const NativeTool = Schema.Struct({ type: Schema.Literals(["web_search", "web_extractor", "code_interpreter"]) })
const WebExtractorItem = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.Literal("web_extractor_call"),
    id: Schema.String,
    urls: Schema.optional(Schema.Array(Schema.String)),
    goal: Schema.optional(Schema.String),
  }),
  [JsonObject],
)
const Body = Schema.Struct({
  ...OpenResponses.coreFields,
  input: Schema.Array(Schema.Union([OpenResponses.InputItem, WebExtractorItem])),
  tools: optionalArray(Schema.Union([OpenResponses.Tool, NativeTool])),
  enable_thinking: Options.fields.enableThinking,
  previous_response_id: Options.fields.previousResponseId,
  conversation: Options.fields.conversation,
  stream: Schema.Literal(true),
})
const adapter = {
  id: "alibaba-responses",
  name: "Alibaba Responses",
  restoreHostedToolItem: (item: unknown) => (Schema.is(WebExtractorItem)(item) ? item : undefined),
} satisfies OpenResponses.ProviderAdapter

const fromRequest = Effect.fn("AlibabaResponses.fromRequest")(function* (request: LLMRequest) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(request.providerOptions ?? {})
  const projected = ProviderShared.flattenToolRequest(request)
  const choice = request.toolChoice ? yield* OpenResponses.lowerToolChoice(adapter.name, request.toolChoice) : undefined
  return yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Body))({
    ...(yield* OpenResponses.lowerConversation(projected.request, adapter)),
    ...OpenResponses.lowerGeneration(request),
    enable_thinking: options.enableThinking,
    previous_response_id: options.previousResponseId,
    conversation: options.conversation,
    tools:
      projected.tools.length === 0
        ? undefined
        : yield* Effect.forEach(projected.tools, (tool) =>
            Effect.gen(function* () {
              if (tool.native !== undefined)
                return yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(NativeTool))(tool.native.alibaba)
              return yield* OpenResponses.lowerTool(
                adapter.name,
                tool,
                ToolSchemaProjection.modelCompatibility(tool.inputSchema, request.model.compatibility?.toolSchema),
              )
            }),
          ),
    // Model Studio expresses named selection through allowed_tools.
    tool_choice:
      typeof choice === "object"
        ? { type: "allowed_tools" as const, mode: "required" as const, tools: [choice] }
        : choice,
  })
})

const hostedTools = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  code_interpreter_call: { name: "code_interpreter", input: (item) => ({ code: item.code }) },
} satisfies ResponsesHostedTools.Definitions

export const protocol = Protocol.make({
  id: adapter.id,
  body: { schema: Body, from: fromRequest },
  stream: {
    event: OpenResponses.protocol.stream.event,
    initial: (request) => OpenResponses.initial(request, adapter),
    step: (state, input) =>
      Effect.gen(function* () {
        const event = OpenResponses.normalize(state, input)
        if (event.type === "response.output_item.done" && event.item?.type === "web_extractor_call") {
          const item = yield* Schema.decodeUnknownEffect(WebExtractorItem)(event.item).pipe(
            Effect.mapError((cause) =>
              ProviderShared.eventError(
                adapter.id,
                "Alibaba returned an invalid web extraction item",
                ProviderShared.encodeJson(event),
                cause,
              ),
            ),
          )
          return yield* ResponsesHostedTools.onDone(state, item, {
            web_extractor_call: { name: "web_extractor", input: () => ({ urls: item.urls, goal: item.goal }) },
          })
        }
        if (
          event.type === "response.output_item.done" &&
          event.item &&
          ResponsesHostedTools.isItem(event.item, hostedTools)
        )
          return yield* ResponsesHostedTools.onDone(state, event.item, hostedTools)
        return yield* OpenResponses.step(state, event)
      }),
    terminal: OpenResponses.terminal,
  },
})

export * as AlibabaResponses from "./alibaba-responses.js"
