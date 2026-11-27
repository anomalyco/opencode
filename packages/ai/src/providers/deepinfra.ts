import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { toConfig } from "./settings.js"

const id = ProviderID.make("deepinfra")
const baseURL = "https://api.deepinfra.com/v1/openai"

/** Connection settings for DeepInfra's embedding models. Language models come from `deepinfra`. */
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

export const deepinfra = Provider.make({
  id,
  baseURL,
  auth: Provider.apiKey("DEEPINFRA_API_KEY"),
  apis: [
    OpenAIChat.api.configure({
      capabilities: {
        output: { maxTokensField: "max_tokens" },
        reasoning: { field: "reasoning_content" },
        cache: { promptCacheKey: true },
      },
    }),
  ],
})

export const media = (input: Config = {}) => {
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint: { baseURL: openAIRoot(input.baseURL) ?? baseURL },
    auth: AuthOptions.bearer(input, "DEEPINFRA_API_KEY"),
    ...mergeTransport(input),
  })
  return {
    id,
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
  }
}

const entrypoint = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(deepinfra)

/** A DeepInfra root URL serves the OpenAI-compatible API under `/openai`. */
export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings = {}) =>
  entrypoint(modelID, { ...settings, baseURL: openAIRoot(settings.baseURL) })

export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

const openAIRoot = (value: string | undefined) => {
  const root = value?.replace(/\/+$/, "")
  if (root === undefined) return undefined
  return root.endsWith("/openai") ? root : `${root}/openai`
}

export * as DeepInfra from "./deepinfra.js"
