import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIImages, type OpenAIImageSizing } from "../protocols/openai-images.js"
import { ImageSizing } from "../protocols/utils/image-sizing.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeProviderOptions, type ModelID, type ProviderOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("togetherai")
const baseURL = "https://api.together.xyz/v1"

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
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
  id: "togetherai-chat",
  provider: id,
  providerMetadataKey: "togetherai",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [route]

// Together takes `width` and `height` instead of `size`.
const imageSizing: OpenAIImageSizing = (request) => {
  if (!ImageSizing.isRequested(request)) return undefined
  const size = ImageSizing.fit(request, { multiple: 16 })
  return { width: size.width, height: size.height }
}

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const auth = AuthOptions.bearer(input, ["TOGETHER_API_KEY", "TOGETHER_AI_API_KEY"])
  const configured = route.with({ ...defaults, endpoint: { baseURL: endpoint ?? baseURL }, auth })
  const media = MediaRoute.deployment({ ...input, baseURL: endpoint ?? baseURL }, auth)
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<OpenAIProviderOptionsInput>({
        id: modelID,
        compatibility: { maxTokensField: "max_tokens", supportsStrictMode: false },
      }),
    // Together returns hosted URLs unless asked for `base64`.
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenAIImages.model({
        ...media,
        id: modelID,
        provider: id,
        providerOptions: mergeProviderOptions({ response_format: "base64" }, providerOptions),
        sizing: imageSizing,
        imageInput: "none",
      }),
    configure,
  }
}

export const provider = configure()
export const image = provider.image

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
