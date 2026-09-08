import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import type { LanguageModelCompatibility, LLMRequest } from "../schema/index.js"
import { OpenAIChat } from "./openai-chat.js"
import { ProviderShared } from "./shared.js"

export type ReasoningEffort = "low" | "high" | "max" | "none" | "minimal" | "medium" | "xhigh" | (string & {})

export type OptionsInput = {
  readonly reasoningEffort?: ReasoningEffort
  readonly thinking?: {
    readonly type?: "enabled" | "disabled" | (string & {})
    /** False retains historical reasoning; omission preserves the endpoint's default. */
    readonly clear_thinking?: boolean
  }
  readonly toolStream?: boolean
  readonly doSample?: boolean
  readonly responseFormat?: { readonly type: "text" | "json_object" | (string & {}) }
  readonly requestID?: string
  readonly userID?: string
}

const Options = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.String),
  thinking: Schema.optional(
    Schema.Struct({ type: Schema.optional(Schema.String), clear_thinking: Schema.optional(Schema.Boolean) }),
  ),
  toolStream: Schema.optional(Schema.Boolean),
  doSample: Schema.optional(Schema.Boolean),
  responseFormat: Schema.optional(Schema.Struct({ type: Schema.String })),
  requestID: Schema.optional(Schema.String),
  userID: Schema.optional(Schema.String),
})

const Body = Schema.Struct({
  ...OpenAIChat.bodyFields,
  thinking: Options.fields.thinking,
  do_sample: Options.fields.doSample,
  response_format: Options.fields.responseFormat,
  request_id: Options.fields.requestID,
  user_id: Options.fields.userID,
})

const fromRequest = Effect.fn("ZAIChat.fromRequest")(function* (request: LLMRequest) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(request.providerOptions ?? {})
  const body = yield* OpenAIChat.protocol.body.from(request)
  return {
    ...body,
    thinking: options.thinking,
    // Tool streaming was introduced in GLM-4.6; older models must not receive the opt-in.
    tool_stream:
      options.toolStream ??
      (body.tools?.length && /^glm-(?:4\.[67]|5(?:[.-]|$))/i.test(request.model.id) ? true : undefined),
    do_sample: options.doSample,
    response_format: options.responseFormat,
    request_id: options.requestID,
    user_id: options.userID,
  }
})

export const compatibility = {
  maxTokensField: "max_tokens",
  supportsStore: false,
  supportsStrictMode: false,
  reasoningField: "reasoning_content",
  zaiToolStream: false,
} satisfies LanguageModelCompatibility

export const protocol = Protocol.make({
  id: "zai-chat",
  body: { schema: Body, from: fromRequest },
  stream: OpenAIChat.protocol.stream,
})

export * as ZAIChat from "./zai-chat.js"
