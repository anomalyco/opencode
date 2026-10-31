import type { ProviderPackage } from "../provider-package.js"
import { NvidiaGenAIImages, type NvidiaImageOptions } from "../protocols/nvidia-genai-images.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"

export const id = ProviderID.make("nvidia")

export type Config = ProviderAuthOption<"optional"> & {
  /** `https://ai.api.nvidia.com/v1/genai` by default; a URL that does not end in `/genai` is one model's invoke URL. */
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

export type Settings = ProviderPackage.Settings &
  NvidiaImageOptions & {
    readonly apiKey?: string
    readonly baseURL?: string
  }

export type { NvidiaImageOptions }

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, AuthOptions.bearer(input, "NVIDIA_API_KEY"))
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    NvidiaGenAIImages.model({ ...media, id: modelID, providerOptions })
  return { id, image, configure }
}

export const provider = configure()
export const image = provider.image

export const imageModel = (modelID: string, settings: Settings = {}) => {
  const { apiKey, baseURL, body, headers, ...providerOptions } = settings
  return configure({ apiKey, baseURL, headers, http: body === undefined ? undefined : { body } }).image(
    modelID,
    providerOptions,
  )
}

export * as Nvidia from "./nvidia.js"
