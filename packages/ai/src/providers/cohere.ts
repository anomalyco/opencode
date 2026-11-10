import { CohereChat } from "../protocols/cohere-chat.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { ProviderID, type ModelID, type OpenString, type RequestOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { bearerRouteDefaults, toConfig } from "./settings.js"

export const id = ProviderID.make("cohere")
const COMPATIBILITY_BASE_URL = "https://api.cohere.ai/compatibility/v1"
export type ChatOptionsInput = { readonly reasoningEffort?: OpenString<"none" | "high"> }
export type ProviderOptions = CohereChat.ProviderOptionsInput & ChatOptionsInput
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptions
  }
export type Settings<Options = CohereChat.ProviderOptionsInput> = ProviderPackage.Settings &
  Options & { readonly apiKey?: string | false; readonly baseURL?: string }

export const route = CohereChat.route
export const chatRoute = Route.make({
  id: "cohere-chat-completions",
  provider: id,
  providerMetadataKey: "cohere",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: COMPATIBILITY_BASE_URL }),
  framing: OpenAIChat.framing,
})
export const routes = [route, chatRoute]

export const configure = (input: Config = {}) => {
  const options = bearerRouteDefaults(input, "COHERE_API_KEY", CohereChat.DEFAULT_BASE_URL)
  const native = route.with(options)
  const compatibility = { ...options, endpoint: { baseURL: input.baseURL ?? COMPATIBILITY_BASE_URL } }
  const chat = chatRoute.with(compatibility)
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint: compatibility.endpoint,
    auth: options.auth,
    headers: input.headers,
    http: input.http,
  })
  return {
    id,
    model: (modelID: string | ModelID) => native.model<CohereChat.ProviderOptionsInput>({ id: modelID }),
    chat: (modelID: string | ModelID) =>
      chat.model<ChatOptionsInput>({
        id: modelID,
        compatibility: {
          maxTokensField: "max_tokens",
          reasoningField: "reasoning_content",
        },
        capabilities: { tools: { strict: false } },
      }),
    /** Embeddings through the OpenAI-compatible API; the native `/v2/embed` API is not wired up. */
    embedding: (modelID: string | ModelID, providerOptions?: Readonly<Record<string, unknown>>) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
    configure,
  }
}
export const provider = configure()
export const chat = provider.chat
export const embedding = provider.embedding
export const model: ProviderPackage.Model<Settings, CohereChat.ProviderOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)
export const embeddingModel = (modelID: string, settings?: Settings<Readonly<Record<string, unknown>>>) => {
  const input = toConfig(settings)
  return configure(input).embedding(modelID, input.providerOptions)
}
export * as Cohere from "./cohere.js"
