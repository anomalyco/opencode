import { Effect, Schema } from "effect"
import type { AIError, LLMRequest } from "../schema/index.js"
import { OpenAIChat } from "./openai-chat.js"
import { ProviderShared } from "./shared.js"
import { OpenResponsesOptions } from "./utils/open-responses-options.js"

export type ReasoningEffort = OpenResponsesOptions.ReasoningEffort

const Options = Schema.Struct({
  reasoningEffort: Schema.optional(OpenResponsesOptions.ReasoningEffort),
  thinking: Schema.optional(
    Schema.Struct({
      type: Schema.optional(ProviderShared.knownString<"enabled" | "disabled">()),
      /** False retains historical reasoning; omission preserves the endpoint's default. */
      clear_thinking: Schema.optional(Schema.Boolean),
    }),
  ),
  toolStream: Schema.optional(Schema.Boolean),
  doSample: Schema.optional(Schema.Boolean),
  responseFormat: Schema.optional(Schema.Struct({ type: ProviderShared.knownString<"text" | "json_object">() })),
  requestID: Schema.optional(Schema.String),
  userID: Schema.optional(Schema.String),
})
export type OptionsInput = typeof Options.Type

// Tool streaming was introduced in GLM-4.6; later versions inherit support.
const supportsToolStreaming = (modelID: string) => {
  const match = /(?:^|\/)glm-(\d+)(?:\.(\d+))?(?:-|$)/i.exec(modelID)
  return match !== null && (Number(match[1]) > 4 || (Number(match[1]) === 4 && Number(match[2] ?? 0) >= 6))
}

const fromRequest = Effect.fn("ZAIChat.fromRequest")(function* (
  request: LLMRequest,
  base: (request: LLMRequest) => Effect.Effect<OpenAIChat.OpenAIChatBody, AIError>,
) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(request.providerOptions ?? {})
  const body = yield* base(request)
  return {
    ...body,
    thinking: options.thinking,
    tool_stream:
      options.toolStream ?? (body.tools?.length && supportsToolStreaming(request.model.id) ? true : undefined),
    do_sample: options.doSample,
    response_format: options.responseFormat,
    request_id: options.requestID,
    user_id: options.userID,
  }
})

/** Z.AI's Chat Completions dialect. */
export const api = OpenAIChat.api.extend({
  id: "zai-chat",
  body: fromRequest,
  capabilities: {
    tools: { strict: false, stream: false },
    reasoning: { field: "reasoning_content" },
    output: { maxTokensField: "max_tokens" },
  },
})

export * as ZAIChat from "./zai-chat.js"
