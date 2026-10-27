import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { SystemOne } from "../protocols/system-one.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { Protocol } from "../route/protocol.js"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("digitalocean")
const baseURL = "https://inference.do-ai.run/v1"

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings & OpenAIProviderOptionsInput & { readonly apiKey?: string }

export const protocol = Protocol.make({
  id: "digitalocean-chat",
  body: {
    schema: OpenAIChat.protocol.body.schema,
    from: (request) => OpenAIChat.fromRequest(request, { cacheControl: cacheControl() }),
  },
  stream: OpenAIChat.protocol.stream,
})

export const route = Route.make({
  id: "digitalocean",
  provider: id,
  providerMetadataKey: "digitalocean",
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [route]

export const configure = (input: LanguageModelOptions = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const auth = AuthOptions.bearer(input, ["DIGITALOCEAN_ACCESS_TOKEN", "DIGITALOCEAN_API_KEY", "DO_INFERENCE_API_KEY"])
  const configured = route.with({
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth,
  })
  const decisionRoute = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "digitalocean",
    endpoint: { baseURL: endpoint ?? baseURL },
    auth,
    // DigitalOcean serves TypeSafe's Jev, which needs this header for images.
    headers: { "TypeSafe-Danger-Zone-Images": "true", ...input.headers },
    http: input.http,
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    decisionRoute.model({ id: modelID, providerOptions })
  const media = MediaRoute.deployment({ ...input, baseURL: endpoint ?? baseURL }, auth)
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    OpenAIImages.model({ ...media, id: modelID, provider: id, providerOptions })
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<OpenAIProviderOptionsInput>({
        id: modelID,
        compatibility: {
          supportsPromptCacheKey: true,
        },
      }),
    image,
    decision,
    configure,
  }
}

export const provider = configure()
export const decision = provider.decision
export const image = provider.image

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const imageModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings) {
  return {
    apiKey,
    baseURL,
    headers,
    http: { body },
    providerOptions,
  }
}

export * as DigitalOcean from "./digitalocean.js"
