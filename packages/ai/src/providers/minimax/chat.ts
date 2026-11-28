import { Effect, Schema } from "effect"
import { OpenAIChat } from "../../protocols/openai-chat.js"
import { ProviderShared } from "../../protocols/shared.js"
import { Provider } from "../../provider.js"
import { shared, type ChatOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ChatOptionsInput>

const ChatOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Struct({ type: Schema.String })),
  reasoningSplit: Schema.optional(Schema.Boolean),
})

export const chatCompletions = OpenAIChat.api
  .extend({
    id: "minimax-chat",
    body: Effect.fnUntraced(function* (request, base) {
      const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatOptions))(
        request.providerOptions ?? {},
      )
      return {
        ...(yield* base(request)),
        thinking: options.thinking,
        // MiniMax otherwise embeds <think> tags in ordinary assistant text.
        reasoning_split: options.reasoningSplit ?? true,
      }
    }),
  })
  .configure({ baseURL: "https://api.minimax.io/v1", capabilities: { tools: { strict: false } } })

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(
  Provider.make({ ...shared, apis: [chatCompletions] }),
)
