import { ZAIImages } from "../protocols/zai-images.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { Settings } from "./zai/chat.js"
import { toConfig } from "./settings.js"

export { model, zai, type ChatOptionsInput, type Settings } from "./zai/chat.js"
export type { ZAIImageOptions } from "../protocols/zai-images.js"

export const id = ProviderID.make("zai")

/** Connection settings for Z.AI's media models. Language models come from `zai`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export const media = (input: Config = {}) => {
  const deployment = MediaRoute.deployment(input, AuthOptions.bearer(input, "ZAI_API_KEY"))
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    ZAIImages.model({ ...deployment, id: modelID, providerOptions })
  return { id, image }
}

export const image = media().image

export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).image(modelID, input.providerOptions)
}

export * as ZAI from "./zai.js"
