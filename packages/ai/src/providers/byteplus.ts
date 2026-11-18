import type { ProviderPackage } from "../provider-package.js"
import { SeedanceVideo } from "../protocols/seedance-video.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import { toConfig } from "./settings.js"

export const id = ProviderID.make("byteplus")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

export type { SeedanceVideoOptions } from "../protocols/seedance-video.js"

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "BYTEPLUS_API_KEY")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    video: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      SeedanceVideo.byteplus.model({ ...media, id: modelID, providerOptions }),
    configure,
  }
}

export const provider = configure()
export const videoModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).video(modelID, input.providerOptions)
}
export const video = provider.video
