import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import { OpenResponses } from "./open-responses.js"
import { JsonObject, ProviderShared } from "./shared.js"
import { OpenResponsesOptions } from "./utils/open-responses-options.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"

const Options = Schema.Struct({
  reasoningEffort: Schema.optional(OpenResponsesOptions.ReasoningEffort),
  enableThinking: Schema.optional(Schema.Boolean),
  store: Schema.optional(Schema.Boolean),
  previousResponseId: Schema.optional(Schema.String),
  conversation: Schema.optional(Schema.String),
})
export type OptionsInput = typeof Options.Type
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
  enable_thinking: Options.fields.enableThinking,
  previous_response_id: Options.fields.previousResponseId,
  conversation: Options.fields.conversation,
  stream: Schema.Literal(true),
})
const adapter = {
  id: "alibaba-responses",
  name: "Alibaba Responses",
  nativeTool: (native) => ProviderShared.validateWith(Schema.decodeUnknownEffect(NativeTool))(native.alibaba),
  restoreHostedToolItem: (item: unknown) => (Schema.is(WebExtractorItem)(item) ? item : undefined),
} satisfies OpenResponses.ProviderAdapter

const tools = {
  web_search_call: ResponsesHostedTools.common.web_search_call,
  code_interpreter_call: { name: "code_interpreter", input: (item) => ({ code: item.code }) },
} satisfies ResponsesHostedTools.Definitions

export const protocol = Protocol.make({
  id: adapter.id,
  body: {
    schema: Body,
    from: Effect.fn("AlibabaResponses.fromRequest")(function* (req) {
      const opts = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(req.providerOptions ?? {})
      const body = yield* OpenResponses.fromRequestWithAdapter(req, adapter)
      const choice = body.tool_choice
      return {
        ...body,
        enable_thinking: opts.enableThinking,
        previous_response_id: opts.previousResponseId,
        conversation: opts.conversation,
        // Model Studio expresses named selection through allowed_tools.
        tool_choice:
          typeof choice === "object" && choice.type === "function"
            ? { type: "allowed_tools" as const, mode: "required" as const, tools: [choice] }
            : choice,
      }
    }),
  },
  stream: ResponsesHostedTools.stream(adapter, tools, (state, event) => {
    if (event.type !== "response.output_item.done" || event.item?.type !== "web_extractor_call") return undefined
    return Schema.decodeUnknownEffect(WebExtractorItem)(event.item).pipe(
      Effect.mapError((cause) =>
        ProviderShared.eventError(
          adapter.id,
          "Alibaba returned an invalid web extraction item",
          ProviderShared.encodeJson(event),
          cause,
        ),
      ),
      Effect.flatMap((item) =>
        ResponsesHostedTools.onDone(state, item, {
          web_extractor_call: { name: "web_extractor", input: () => ({ urls: item.urls, goal: item.goal }) },
        }),
      ),
    )
  }),
})

export * as AlibabaResponses from "./alibaba-responses.js"
