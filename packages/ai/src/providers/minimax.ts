import { MiniMaxImages, type MiniMaxImageOptions } from "../protocols/minimax-images.js"
import { MiniMaxVideo, type MiniMaxVideoOptions } from "../protocols/minimax-video.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import { chatCompletions } from "./minimax/chat.js"
import { messages } from "./minimax/messages.js"
import { responses } from "./minimax/responses.js"
import {
  shared,
  type ChatOptionsInput,
  type MessagesOptionsInput,
  type ResponsesOptionsInput,
  type Settings,
} from "./minimax/shared.js"
import { toConfig } from "./settings.js"

export type {
  ChatOptionsInput,
  MessagesOptionsInput,
  ProviderOptionsInput,
  ResponsesOptionsInput,
  Settings,
} from "./minimax/shared.js"
export type { MiniMaxImageOptions, MiniMaxVideoOptions }

export const id = ProviderID.make("minimax")

export const minimax = Provider.make({ ...shared, apis: [messages, chatCompletions, responses] })

export const model = Provider.entrypoint<Settings<MessagesOptionsInput>, MessagesOptionsInput>(minimax)
export const chatModel = Provider.entrypoint<Settings<ChatOptionsInput>, ChatOptionsInput>(minimax, "chat-completions")
export const responsesModel = Provider.entrypoint<Settings<ResponsesOptionsInput>, ResponsesOptionsInput>(
  minimax,
  "responses",
)

/** Connection settings for MiniMax's media models. Language models come from `minimax`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export const media = (input: Config = {}) => {
  const deployment = MediaRoute.deployment(input, AuthOptions.bearer(input, "MINIMAX_API_KEY"))
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    MiniMaxImages.model({ ...deployment, id: modelID, providerOptions })
  // H3 is under /v2 and Hailuo under /v1, so video drops the version a shared `baseURL` carries for the other APIs.
  const videoBaseURL = deployment.baseURL?.replace(/(\/v1)?\/*$/, "")
  const video = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    MiniMaxVideo.model({ ...deployment, baseURL: videoBaseURL, id: modelID, providerOptions })
  return { id, image, video }
}

const defaultMedia = media()

export const imageModel = (modelID: string, settings?: Settings<MiniMaxImageOptions>) => {
  const input = toConfig<Settings<{}>>(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const videoModel = (modelID: string, settings?: Settings<MiniMaxVideoOptions>) => {
  const input = toConfig<Settings<{}>>(settings)
  return media(input).video(modelID, input.providerOptions)
}

export const image = defaultMedia.image
export const video = defaultMedia.video

export * as MiniMax from "./minimax.js"
