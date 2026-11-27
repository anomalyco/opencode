import { Effect, Schema } from "effect"
import { OpenAIChat } from "../../protocols/openai-chat.js"
import { ProviderShared } from "../../protocols/shared.js"
import { Provider } from "../../provider.js"
import { shared, type ChatOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ChatOptionsInput>

const ChatOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.String),
  thinking: Schema.optional(
    Schema.Struct({ type: Schema.String, keep: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
})

export const chatCompletions = OpenAIChat.api
  .extend({
    id: "moonshot-chat",
    body: Effect.fnUntraced(function* (request, base) {
      const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatOptions))(
        request.providerOptions ?? {},
      )
      return { ...(yield* base(request)), thinking: options.thinking }
    }),
  })
  .configure({
    baseURL: "https://api.moonshot.ai/v1",
    metadataKey: "moonshot",
    capabilities: {
      tools: { strict: false, sanitizer: "moonshot" },
      reasoning: { field: "reasoning_content" },
      output: { maxTokensField: "max_tokens" },
      cache: { promptCacheKey: true },
    },
  })

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(
  Provider.make({ ...shared, apis: [chatCompletions] }),
)
