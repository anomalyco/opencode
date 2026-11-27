import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { toConfig } from "./settings.js"

const id = ProviderID.make("fireworks")
const baseURL = "https://api.fireworks.ai/inference/v1"

/** Connection settings for Fireworks' embedding models. Language models come from `fireworks`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const fireworks = Provider.make({
  id,
  baseURL,
  auth: Provider.apiKey("FIREWORKS_API_KEY"),
  apis: [OpenAIChat.api.configure({ id: "fireworks-chat", capabilities: { cache: { promptCacheKey: true } } })],
})

export const media = (input: Config = {}) => {
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint: { baseURL: input.baseURL ?? baseURL },
    auth: AuthOptions.bearer(input, "FIREWORKS_API_KEY"),
    ...mergeTransport(input),
  })
  return {
    id,
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
  }
}

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(fireworks)

export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

export * as Fireworks from "./fireworks.js"
