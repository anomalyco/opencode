import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import type { ModelID, ProviderOptions, RequestOptions } from "../schema/index.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { XAIResponses } from "../protocols/xai-responses.js"
import { XAIImages } from "../protocols/xai-images.js"
import { XAIVideo } from "../protocols/xai-video.js"
import { Provider } from "../provider.js"
import type { OpenAIOptionsInput } from "./openai-options.js"
import type { ProviderPackage } from "../provider-package.js"
import { toConfig } from "./settings.js"

const baseURL = "https://api.x.ai/v1"

export type XAIProviderOptionsInput = OpenAIOptionsInput &
  XAIResponses.OptionsInput & { readonly contextManagement?: never }

/** Connection settings for xAI's media models. Language models come from `xai`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: XAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  XAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export type { XAIImageOptions } from "../protocols/xai-images.js"
export type { XAIVideoOptions } from "../protocols/xai-video.js"

export const chatCompletions = OpenAIChat.api.extend({
  id: "xai-chat",
  headers: ({ request }): Record<string, string> =>
    request.promptCacheKey ? { "x-grok-conv-id": request.promptCacheKey } : {},
})

export const xai = Provider.make({
  id: "xai",
  baseURL,
  auth: Provider.apiKey("XAI_API_KEY"),
  apis: [XAIResponses.api, chatCompletions],
})

export const model = Provider.entrypoint<Settings, XAIProviderOptionsInput, typeof XAIResponses.api.compact>(xai)

export const media = (input: Config = {}) => {
  const deployment = MediaRoute.deployment(input, AuthOptions.bearer(input, "XAI_API_KEY"))
  return {
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      XAIImages.model({ ...deployment, id: modelID, providerOptions }),
    video: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      XAIVideo.model({ ...deployment, id: modelID, providerOptions }),
  }
}

const defaultMedia = media()

export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const videoModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).video(modelID, input.providerOptions)
}
export const image = defaultMedia.image
export const video = defaultMedia.video
