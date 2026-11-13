import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { bearerRouteDefaults, toConfig } from "./settings.js"

export const id = ProviderID.make("fireworks")
const baseURL = "https://api.fireworks.ai/inference/v1"

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

export const route = Route.make({
  id: "fireworks-chat",
  provider: id,
  providerMetadataKey: "fireworks",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [route]

export const configure = (input: Config = {}) => {
  const options = bearerRouteDefaults(input, "FIREWORKS_API_KEY", baseURL)
  const configured = route.with(options)
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint: options.endpoint,
    auth: options.auth,
    headers: input.headers,
    http: input.http,
  })
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<OpenAIProviderOptionsInput>({ id: modelID, capabilities: { promptCacheKey: true } }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
    configure,
  }
}

export const provider = configure()

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)

export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).embedding(modelID, input.providerOptions)
}

export * as Fireworks from "./fireworks.js"
