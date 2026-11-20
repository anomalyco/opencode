import type { ProviderPackage } from "../provider-package.js"
import { SeedanceVideo } from "../protocols/seedance-video.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type TransportOptions } from "../schema/index.js"
import { toConfig } from "./settings.js"

export const id = ProviderID.make("volcengine")

export type Config = TransportOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

export type { SeedanceVideoOptions } from "../protocols/seedance-video.js"

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "ARK_API_KEY")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    video: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      SeedanceVideo.volcengine.model({ ...media, id: modelID, providerOptions }),
    configure,
  }
}

export const provider = configure()
export const videoModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).video(modelID, input.providerOptions)
}
export const video = provider.video
