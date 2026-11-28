import { CohereChat } from "../protocols/cohere-chat.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { mergeTransport, ProviderID, type ModelID, type RequestOptions } from "../schema/index.js"
import { chatCompletions } from "./cohere/chat.js"
import {
  compatibilityBaseURL,
  shared,
  type ChatOptionsInput,
  type Settings as SharedSettings,
} from "./cohere/shared.js"
import { toConfig } from "./settings.js"

export type { ChatOptionsInput } from "./cohere/shared.js"
export type ProviderOptions = CohereChat.ProviderOptionsInput & ChatOptionsInput
/** Connection settings for Cohere's embedding models. Language models come from `cohere`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptions
  }
export type Settings<Options = CohereChat.ProviderOptionsInput> = SharedSettings<Options>

export const cohere = Provider.make({ ...shared, apis: [CohereChat.api, chatCompletions] })

export const media = (input: Config = {}) => {
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: ProviderID.make("cohere"),
    endpoint: { baseURL: input.baseURL ?? compatibilityBaseURL },
    auth: AuthOptions.bearer(input, "COHERE_API_KEY"),
    ...mergeTransport(input),
  })
  return {
    /** Embeddings through the OpenAI-compatible API; the native `/v2/embed` API is not wired up. */
    embedding: (modelID: string | ModelID, providerOptions?: Readonly<Record<string, unknown>>) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
  }
}

export const embedding = media().embedding

export const model = Provider.entrypoint<Settings, CohereChat.ProviderOptionsInput>(cohere)
export const chatModel = Provider.entrypoint<Settings<ChatOptionsInput>, ChatOptionsInput>(cohere, "chat-completions")
export const embeddingModel = (modelID: string, settings?: Settings<Readonly<Record<string, unknown>>>) => {
  const input = toConfig(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

export * as Cohere from "./cohere.js"
