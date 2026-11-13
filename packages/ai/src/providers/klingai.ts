import type { ProviderPackage } from "../provider-package.js"
import { KlingVideo } from "../protocols/klingai-video.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { toConfig } from "./settings.js"

export type { KlingContent, KlingEndpoint, KlingVideoOptions } from "../protocols/klingai-video.js"

export const id = ProviderID.make("klingai")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "KLINGAI_API_KEY")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    video: (modelID: string | ModelID) => KlingVideo.model({ ...media, id: modelID }),
    configure,
  }
}

export const provider = configure()
export const videoModel = (modelID: string, settings?: Settings) => configure(toConfig(settings)).video(modelID)
export const video = provider.video
